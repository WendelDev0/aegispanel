import fs from 'fs';
import path from 'path';
import { CONFIG } from '../config.js';
import { resolveSafePath } from '../utils/safe-path.js';

export interface FileItem {
  name: string;
  path: string;
  isDirectory: boolean;
  sizeBytes: number;
  modifiedAt: string;
  extension?: string;
}

export class FileService {
  private static rootDir = path.resolve(CONFIG.DATA_DIR);

  // Delegates to the shared checker, which compares path segments and resolves
  // symlinks instead of doing a string prefix test.
  private static resolveSafePath(relPath: string = ''): string {
    return resolveSafePath(this.rootDir, relPath);
  }

  static listFiles(relPath: string = ''): FileItem[] {
    const targetDir = this.resolveSafePath(relPath);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const items = fs.readdirSync(targetDir, { withFileTypes: true });
    return items.map((item) => {
      const fullItemPath = path.join(targetDir, item.name);
      let sizeBytes = 0;
      let modifiedAt = new Date().toISOString();

      try {
        const stats = fs.statSync(fullItemPath);
        sizeBytes = stats.size;
        modifiedAt = stats.mtime.toISOString();
      } catch {
        // ignore
      }

      const relative = path.relative(this.rootDir, fullItemPath).replace(/\\/g, '/');

      return {
        name: item.name,
        path: relative,
        isDirectory: item.isDirectory(),
        sizeBytes: item.isDirectory() ? 0 : sizeBytes,
        modifiedAt,
        extension: item.isDirectory() ? undefined : path.extname(item.name).replace('.', ''),
      };
    });
  }

  static readFile(relPath: string): string {
    const filePath = this.resolveSafePath(relPath);
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      throw new Error('Arquivo não encontrado ou é um diretório.');
    }
    return fs.readFileSync(filePath, 'utf-8');
  }

  static writeFile(relPath: string, content: string): boolean {
    const filePath = this.resolveSafePath(relPath);
    const parent = path.dirname(filePath);
    if (!fs.existsSync(parent)) {
      fs.mkdirSync(parent, { recursive: true });
    }
    fs.writeFileSync(filePath, content, 'utf-8');
    return true;
  }

  static uploadBase64(relPath: string, base64Content: string): boolean {
    const filePath = this.resolveSafePath(relPath);
    const parent = path.dirname(filePath);
    if (!fs.existsSync(parent)) {
      fs.mkdirSync(parent, { recursive: true });
    }
    const buffer = Buffer.from(base64Content, 'base64');
    fs.writeFileSync(filePath, buffer);
    return true;
  }

  static createDirectory(relPath: string): boolean {
    const dirPath = this.resolveSafePath(relPath);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
    return true;
  }

  static deleteItem(relPath: string): boolean {
    const targetPath = this.resolveSafePath(relPath);
    if (targetPath === this.rootDir) {
      throw new Error('Não é permitido deletar o diretório raiz.');
    }
    if (fs.existsSync(targetPath)) {
      fs.rmSync(targetPath, { recursive: true, force: true });
      return true;
    }
    return false;
  }

  static getSafeAbsolutePath(relPath: string): string {
    return this.resolveSafePath(relPath);
  }
}
