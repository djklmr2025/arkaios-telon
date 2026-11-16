// Vercel entry point: the same app as server.js, always in stateless web mode.
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.js';
import { storeDefaults } from '../src/seed.js';
import { createStore } from '../src/store.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export default createApp({
  store: createStore(path.join(os.tmpdir(), 'telon-data'), storeDefaults()),
  publicDir: path.join(ROOT, 'public'),
  sharedDir: path.join(ROOT, 'src'),
  mode: 'web',
});
