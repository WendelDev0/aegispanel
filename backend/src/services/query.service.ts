import { dbStorage } from '../db/storage.js';
import { dockerService } from './docker.service.js';
import { EncryptionService } from '../utils/crypto.js';

export interface QueryResult {
  columns: string[];
  rows: any[];
  executionTimeMs: number;
  rowCount: number;
  rawOutput?: string;
}

const QUERY_TIMEOUT_MS = 30_000;

/**
 * Parses RFC 4180 CSV, which is what `psql --csv` emits.
 * A naive split on commas corrupts any value containing a comma or a newline.
 */
function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch !== '\r') {
      field += ch;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((r) => r.length > 1 || r[0] !== '');
}

function toObjects(columns: string[], dataRows: string[][]): any[] {
  return dataRows.map((vals) => {
    const obj: Record<string, any> = {};
    columns.forEach((col, idx) => {
      obj[col] = vals[idx] ?? null;
    });
    return obj;
  });
}

export class QueryService {
  /**
   * Executes a query inside the database container.
   *
   * The statement is passed as a single argv element to the Docker API, never
   * interpolated into a shell string, so backticks and $( ) in user input are
   * inert. When the container is unreachable the call fails loudly: an earlier
   * version returned invented rows here, which is indistinguishable from real
   * data at the UI and is worse than an error.
   */
  static async executeQuery(databaseId: string, sqlQuery: string): Promise<QueryResult> {
    const startTime = Date.now();
    const db = dbStorage.getDatabaseById(databaseId);
    if (!db) throw new Error('Banco de dados não encontrado');

    const cleanSql = sqlQuery.trim();
    if (!cleanSql) {
      throw new Error('Comando SQL não pode ser vazio');
    }

    if (!db.containerId) {
      throw new Error(`O banco "${db.name}" não possui contêiner associado.`);
    }
    if (db.status !== 'running') {
      throw new Error(`O contêiner do banco "${db.name}" está ${db.status}. Inicie-o antes de executar consultas.`);
    }

    const rawPassword = EncryptionService.decrypt(db.dbPassword);

    let columns: string[] = [];
    let rows: any[] = [];
    let rawOutput = '';

    switch (db.type) {
      case 'postgres': {
        const result = await dockerService.execInContainer(
          db.containerId,
          ['psql', '-U', db.dbUser, '-d', db.dbName, '--csv', '-c', cleanSql],
          { env: [`PGPASSWORD=${rawPassword}`], timeoutMs: QUERY_TIMEOUT_MS }
        );
        rawOutput = result.stdout || result.stderr;
        if (result.exitCode !== 0) {
          throw new Error(result.stderr.trim() || 'psql retornou erro sem mensagem.');
        }
        const parsed = parseCsv(result.stdout);
        if (parsed.length > 0) {
          columns = parsed[0];
          rows = toObjects(columns, parsed.slice(1));
        }
        break;
      }

      case 'mysql':
      case 'mariadb': {
        const result = await dockerService.execInContainer(
          db.containerId,
          ['mysql', '-u', db.dbUser, '--batch', '--raw', '-e', cleanSql, db.dbName],
          // MYSQL_PWD keeps the password off the argument list, where it would
          // be readable by any process on the host via ps.
          { env: [`MYSQL_PWD=${rawPassword}`], timeoutMs: QUERY_TIMEOUT_MS }
        );
        rawOutput = result.stdout || result.stderr;
        if (result.exitCode !== 0) {
          throw new Error(result.stderr.trim() || 'mysql retornou erro sem mensagem.');
        }
        const lines = result.stdout.split('\n').filter((l) => l.length > 0);
        if (lines.length > 0) {
          columns = lines[0].split('\t');
          rows = toObjects(
            columns,
            lines.slice(1).map((l) => l.split('\t'))
          );
        }
        break;
      }

      case 'redis': {
        // redis-cli takes the command as separate arguments; splitting on
        // whitespace here is a tokenizer, not a shell, so nothing is evaluated.
        const args = cleanSql.split(/\s+/).filter(Boolean);
        const result = await dockerService.execInContainer(
          db.containerId,
          ['redis-cli', ...args],
          { env: [`REDISCLI_AUTH=${rawPassword}`], timeoutMs: QUERY_TIMEOUT_MS }
        );
        rawOutput = result.stdout || result.stderr;
        if (result.exitCode !== 0) {
          throw new Error(result.stderr.trim() || 'redis-cli retornou erro sem mensagem.');
        }
        columns = ['Result'];
        rows = [{ Result: result.stdout.trim() || 'OK' }];
        break;
      }

      case 'mongodb': {
        const result = await dockerService.execInContainer(
          db.containerId,
          [
            'mongosh',
            '--quiet',
            '-u', db.dbUser,
            '-p', rawPassword,
            '--authenticationDatabase', 'admin',
            db.dbName,
            '--eval', cleanSql,
          ],
          { timeoutMs: QUERY_TIMEOUT_MS }
        );
        rawOutput = result.stdout || result.stderr;
        if (result.exitCode !== 0) {
          throw new Error(result.stderr.trim() || 'mongosh retornou erro sem mensagem.');
        }
        columns = ['Result'];
        rows = [{ Result: result.stdout.trim() }];
        break;
      }

      default:
        throw new Error(`Tipo de banco não suportado para consultas: ${db.type}`);
    }

    return {
      columns,
      rows,
      rowCount: rows.length,
      executionTimeMs: Date.now() - startTime,
      rawOutput,
    };
  }
}
