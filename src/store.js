import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export class StoreError extends Error {}

export function createStore(dataDir, defaults) {
  let queue = Promise.resolve();

  function fileFor(name) {
    if (!Object.hasOwn(defaults, name)) throw new StoreError(`Colección desconocida: ${name}`);
    return path.join(dataDir, `${name}.json`);
  }

  async function read(name) {
    const file = fileFor(name);
    let raw;
    try {
      raw = await readFile(file, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return structuredClone(defaults[name]);
      throw err;
    }
    try {
      return JSON.parse(raw);
    } catch {
      throw new StoreError(`El archivo ${file} está dañado; corrígelo o bórralo.`);
    }
  }

  async function write(name, value) {
    const file = fileFor(name);
    await mkdir(dataDir, { recursive: true });
    const temp = `${file}.tmp`;
    await writeFile(temp, JSON.stringify(value, null, 2), 'utf8');
    await rename(temp, file);
  }

  function update(name, change) {
    const run = queue.then(async () => {
      const next = await change(await read(name));
      await write(name, next);
      return next;
    });
    queue = run.catch(() => {});
    return run;
  }

  return { read, update };
}
