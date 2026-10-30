import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const python = join(root, 'backend', '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const manage = join(root, 'backend/manage.py');
const args = process.argv.slice(2);
const portIndex = args.indexOf('--port');
const port = Number(portIndex >= 0 ? args[portIndex + 1] : process.env.PORT || 4173);
if (!Number.isInteger(port) || port < 1024 || port > 65535) { console.error('Укажите свободный порт от 1024 до 65535.'); process.exit(1); }
if (!existsSync(python)) { console.error('Сначала подготовьте Django по инструкции backend/README.md (виртуальное окружение и requirements.txt).'); process.exit(1); }
const migrate = spawn(python, [manage, 'migrate', '--noinput'], { cwd: root, stdio: 'inherit' });
migrate.on('error', error => { console.error(error.message); process.exitCode = 1; });
migrate.on('exit', code => {
  if (code !== 0) { process.exitCode = code || 1; return; }
  const server = spawn(python, [manage, 'runserver', `127.0.0.1:${port}`], { cwd: root, stdio: 'inherit' });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.kill(signal));
  server.on('error', error => { console.error(error.message); process.exitCode = 1; });
  server.on('exit', status => { process.exitCode = status || 0; });
});
