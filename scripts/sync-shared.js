// Copies the modules the browser imports from /shared into public/shared, for hosts
// that bundle src/ and leave no source files on disk at runtime (Vercel).
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHARED_MODULES = ['validate.js', 'prompt.js', 'session.js'];
const target = path.join(ROOT, 'public', 'shared');

await mkdir(target, { recursive: true });
await Promise.all(SHARED_MODULES.map((file) => copyFile(path.join(ROOT, 'src', file), path.join(target, file))));
process.stdout.write(`Copiados ${SHARED_MODULES.length} módulos a public/shared\n`);
