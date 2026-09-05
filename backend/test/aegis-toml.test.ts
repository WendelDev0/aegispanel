import './setup.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAegisToml } from '../src/utils/aegis-toml.js';

test('parses the documented aegis.toml subset', () => {
  const parsed = parseAegisToml(`
[build]
runtime = "python"
version = "3.12"
root = "services/api"
install = "uv sync --frozen"
start = "uvicorn app.main:app --host 0.0.0.0 --port 8000"

[processes.worker]
command = "celery -A app worker -l info"
replicas = 1

[processes.beat]
type = "cron"
schedule = "*/5 * * * *"
command = "python manage.py send_digest"

[release]
command = "python manage.py migrate --noinput"

[deploy]
strategy = "blue-green"
on_tag = "v*"
`);
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.value.build?.runtime, 'python');
  assert.equal(parsed.value.build?.rootDir, 'services/api');
  assert.equal(parsed.value.processes?.length, 3);
  assert.equal(parsed.value.release?.command, 'python manage.py migrate --noinput');
  assert.equal(parsed.value.deploy?.onTag, 'v*');
});

test('names the line of a bad value', () => {
  const parsed = parseAegisToml('runtime = python\n');
  assert.equal(parsed.ok, false);
  if (parsed.ok) return;
  assert.match(parsed.error, /Linha 1/);
});

test('rejects an unknown runtime', () => {
  const parsed = parseAegisToml('[build]\nruntime = "cobol"\n');
  assert.equal(parsed.ok, false);
});
