import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './src/app.js';
import { storeDefaults } from './src/seed.js';
import { createStore } from './src/store.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PORT = 4500;
const LOOPBACK = '127.0.0.1';
const LOOPBACK_HOSTS = [LOOPBACK, 'localhost', '::1'];

try {
  process.loadEnvFile(path.join(ROOT, '.env'));
} catch (err) {
  if (err.code !== 'ENOENT') throw err;
}

const portFlag = process.argv.find((arg) => arg.startsWith('--port='))?.slice('--port='.length);
const isWeb = process.env.TELON_MODE === 'web' || process.argv.includes('--web') || Boolean(process.env.VERCEL);
const mode = isWeb ? 'web' : 'local';
const port = Number(portFlag ?? process.env.TELON_PORT ?? process.env.PORT ?? DEFAULT_PORT);
const host = process.env.TELON_HOST ?? (mode === 'web' ? '0.0.0.0' : LOOPBACK);
const dataDir = process.env.TELON_DATA_DIR ?? path.join(ROOT, 'data');

const app = createApp({
  store: createStore(dataDir, storeDefaults()),
  publicDir: path.join(ROOT, 'public'),
  sharedDir: path.join(ROOT, 'src'),
  mode,
  allowAnyHost: mode === 'web' || !LOOPBACK_HOSTS.includes(host),
});

createServer(app).listen(port, host, () => {
  process.stdout.write(`Telón (${mode}) abierto en http://${LOOPBACK_HOSTS.includes(host) ? 'localhost' : host}:${port}\n`);
});
