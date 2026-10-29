import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
await rm(`${root}dist`, { recursive: true, force: true });
await mkdir(`${root}dist`, { recursive: true });
for (const item of ['index.html', 'src', 'public']) await cp(`${root}${item}`, `${root}dist/${item}`, { recursive: true });
console.log('Сайт собран в dist/');
