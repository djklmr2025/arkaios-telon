import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.js';
import { createRateLimiter } from '../src/rate-limit.js';
import { seedEpisodes, storeDefaults } from '../src/seed.js';
import { buildSession, byRecent, isAwaitingReply, newMessage, summarize, withMessage } from '../src/session.js';
import { createStore } from '../src/store.js';
import { ValidationError, parseReplyRequest } from '../src/validate.js';
import { PROVIDERS } from '../src/web-routes.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const KEY = { 'x-telon-key': 'clave-del-visitante-123' };

const echoEngine = {
  status: async () => ({ ok: true, detail: 'Clave aceptada.', models: ['gemini-a'] }),
  chat: async (messages, { onToken }) => {
    onToken('Eco');
    return `Eco: ${messages.at(-1).content}`;
  },
};

async function startWeb(t, options = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'telon-web-'));
  const seenSettings = [];
  const seenPrompts = [];
  const app = createApp({
    store: createStore(dir, storeDefaults()),
    publicDir: path.join(ROOT, 'public'),
    sharedDir: path.join(ROOT, 'src'),
    mode: 'web',
    env: { TELON_API_KEY: 'clave-del-servidor' },
    engineFor: (settings) => {
      seenSettings.push(settings);
      return { ...echoEngine, chat: (messages, opts) => (seenPrompts.push(messages), echoEngine.chat(messages, opts)) };
    },
    logger: () => {},
    ...options,
  });
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  async function call(method, route, body, headers = {}) {
    const response = await fetch(base + route, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const raw = await response.text();
    const contentType = response.headers.get('content-type');
    const isJson = contentType.includes('application/json');
    const isStream = contentType.includes('ndjson');
    const events = isStream ? raw.split('\n').filter(Boolean).map((line) => JSON.parse(line)) : [];
    return { status: response.status, json: isJson ? JSON.parse(raw) : null, events, raw, response };
  }

  return { base, call, seenSettings, seenPrompts };
}

function replyBody(overrides = {}) {
  const [episode] = seedEpisodes();
  return {
    mode: 'episode',
    episode,
    characterId: null,
    messages: [
      { role: 'assistant', text: episode.opening },
      { role: 'user', text: 'Subo al faro.' },
    ],
    profile: { name: 'Saul', description: '' },
    provider: 'gemini',
    model: 'gemini-3.8-flash',
    ...overrides,
  };
}

test('la configuración anuncia el modo web y el proveedor sin su URL interna', async (t) => {
  const { call } = await startWeb(t);

  const { json } = await call('GET', '/api/config');

  assert.equal(json.data.mode, 'web');
  assert.deepEqual(json.data.providers, [
    {
      id: 'gemini',
      label: 'Google Gemini',
      defaultModel: PROVIDERS.gemini.defaultModel,
      keyUrl: 'https://aistudio.google.com/apikey',
    },
  ]);
});

test('sirve los módulos compartidos y los episodios de muestra', async (t) => {
  const { call } = await startWeb(t);

  const shared = await call('GET', '/shared/session.js');
  const data = await call('GET', '/data.js');
  const episodes = await call('GET', '/api/episodes');

  assert.equal(shared.status, 200);
  assert.match(shared.raw, /export function buildSession/);
  assert.equal(data.status, 200);
  assert.equal(episodes.json.data.length, 3);
});

test('en modo web no existen las rutas que guardan datos en el servidor', async (t) => {
  const { call } = await startWeb(t);

  assert.equal((await call('GET', '/api/sessions')).status, 404);
  assert.equal((await call('PUT', '/api/settings', { engine: 'ollama' })).status, 404);
  assert.equal((await call('POST', '/api/episodes', {})).status, 405);
  assert.equal((await call('GET', '/api/profile')).status, 404);
});

test('responde en flujo con la clave del visitante y la URL fija del proveedor', async (t) => {
  const { call, seenSettings, seenPrompts } = await startWeb(t);

  const { status, events } = await call('POST', '/api/reply', replyBody(), KEY);

  assert.equal(status, 200);
  assert.equal(events.at(-1).type, 'done');
  assert.equal(events.at(-1).message.text, 'Eco: Subo al faro.');
  assert.deepEqual(seenSettings[0], {
    engine: 'openai',
    baseUrl: PROVIDERS.gemini.baseUrl,
    model: 'gemini-3.8-flash',
    apiKey: KEY['x-telon-key'],
  });
  assert.match(seenPrompts[0][0].content, /Saul/);
  assert.equal(seenPrompts[0][1].role, 'user');
});

test('una charla en modo web usa la voz del personaje', async (t) => {
  const { call, seenPrompts } = await startWeb(t);
  const body = replyBody({ mode: 'chat', characterId: 'tomas', messages: [{ role: 'user', text: 'Hola.' }] });

  const { events } = await call('POST', '/api/reply', body, KEY);

  assert.equal(events.at(-1).type, 'done');
  assert.match(seenPrompts[0][0].content, /^Eres Tomás/);
});

test('rechaza peticiones sin clave, con proveedor ajeno o mal formadas', async (t) => {
  const { call, seenSettings } = await startWeb(t);

  const noKey = await call('POST', '/api/reply', replyBody());
  const badKey = await call('POST', '/api/reply', replyBody(), { 'x-telon-key': 'corta' });
  const badProvider = await call('POST', '/api/reply', replyBody({ provider: 'http://evil.example' }), KEY);
  const protoProvider = await call('POST', '/api/reply', replyBody({ provider: 'constructor' }), KEY);
  const badModel = await call('POST', '/api/reply', replyBody({ model: 'x y?z' }), KEY);
  const noPending = await call('POST', '/api/reply', replyBody({ messages: [{ role: 'assistant', text: 'a' }] }), KEY);
  const badRole = await call('POST', '/api/reply', replyBody({ messages: [{ role: 'system', text: 'a' }] }), KEY);
  const badCharacter = await call('POST', '/api/reply', replyBody({ mode: 'chat', characterId: 'nadie' }), KEY);
  const badMode = await call('POST', '/api/reply', replyBody({ mode: 'otro' }), KEY);

  assert.equal(noKey.status, 401);
  assert.equal(badKey.status, 401);
  assert.equal(badProvider.status, 400);
  assert.equal(protoProvider.status, 400);
  assert.equal(badModel.status, 400);
  assert.equal(noPending.status, 400);
  assert.equal(badRole.status, 400);
  assert.equal(badCharacter.status, 400);
  assert.equal(badMode.status, 400);
  assert.equal(seenSettings.length, 0);
});

test('comprueba la clave del visitante contra el proveedor', async (t) => {
  const { call } = await startWeb(t);

  const ok = await call('POST', '/api/engine/check', { provider: 'gemini', model: 'gemini-a' }, KEY);
  const noKey = await call('POST', '/api/engine/check', { provider: 'gemini', model: 'gemini-a' });

  assert.deepEqual(ok.json.data.models, ['gemini-a']);
  assert.equal(noKey.status, 401);
});

test('limita las peticiones por visitante en modo web', async (t) => {
  const { call } = await startWeb(t, { rateLimiter: createRateLimiter(2, 60000) });
  const from = (ip) => ({ ...KEY, 'x-forwarded-for': `${ip}, 10.0.0.1` });

  const first = await call('POST', '/api/reply', replyBody(), from('203.0.113.5'));
  const second = await call('POST', '/api/reply', replyBody(), from('203.0.113.5'));
  const third = await call('POST', '/api/reply', replyBody(), from('203.0.113.5'));
  const other = await call('POST', '/api/reply', replyBody(), from('203.0.113.9'));

  assert.deepEqual([first.status, second.status, third.status, other.status], [200, 200, 429, 200]);
});

test('el limitador abre una ventana nueva cuando pasa el tiempo', () => {
  let time = 0;
  const limiter = createRateLimiter(1, 1000, () => time);

  const first = limiter.allow('a');
  const blocked = limiter.allow('a');
  time = 1000;
  const afterWindow = limiter.allow('a');

  assert.deepEqual([first, blocked, afterWindow], [true, false, true]);
});

test('las sesiones compartidas se construyen y resumen igual en servidor y navegador', () => {
  const [episode] = seedEpisodes();

  const story = buildSession(episode, 'episode');
  const chat = buildSession(episode, 'chat', 'irene');
  const answered = withMessage(chat, newMessage('user', 'Hola, Irene.'));

  assert.equal(story.messages[0].text, episode.opening);
  assert.equal(chat.title, 'Charla con Irene Vela');
  assert.equal(isAwaitingReply(story), false);
  assert.equal(isAwaitingReply(answered), true);
  assert.equal(chat.messages.length, 0);
  assert.equal(summarize(answered).preview, 'Hola, Irene.');
  assert.equal(summarize(chat).preview, '');
  assert.equal(byRecent([{ updatedAt: '2026-01-01' }, { updatedAt: '2026-02-01' }])[0].updatedAt, '2026-02-01');
  assert.throws(() => buildSession(episode, 'otro'), ValidationError);
  assert.throws(() => buildSession(episode, 'chat', 'nadie'), ValidationError);
});

test('parseReplyRequest limita el tamaño del historial', () => {
  const tooMany = Array.from({ length: 41 }, () => ({ role: 'user', text: 'x' }));

  assert.throws(() => parseReplyRequest(replyBody({ messages: tooMany })), /historial/);
  assert.throws(() => parseReplyRequest(replyBody({ messages: [] })), /historial/);
  assert.throws(() => parseReplyRequest(replyBody({ messages: ['x'] })), ValidationError);
  assert.equal(parseReplyRequest(replyBody()).session.messages.length, 2);
});

test('la entrada de Vercel sirve la app en modo web y acepta cuerpos ya leídos por el host', async (t) => {
  const { default: handler } = await import('../api/index.js');
  const { readJsonBody } = await import('../src/http.js');
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  const config = await fetch(`${base}/api/config`).then((r) => r.json());
  const shared = await fetch(`${base}/shared/validate.js`);
  const noKey = await fetch(`${base}/api/reply`, { method: 'POST', body: '{}' });

  assert.equal(config.data.mode, 'web');
  assert.equal(shared.status, 200);
  assert.equal(noKey.status, 400);
  assert.deepEqual(await readJsonBody({ body: { a: 1 } }), { a: 1 });
  assert.deepEqual(await readJsonBody({ body: '{"a":2}' }), { a: 2 });
  await assert.rejects(readJsonBody({ body: '{roto' }), /JSON válido/);
  await assert.rejects(readJsonBody({ body: [1] }), /objeto/);
  await assert.rejects(readJsonBody({ body: { big: 'x'.repeat(300 * 1024) } }), /demasiado grande/);
  await assert.rejects(readJsonBody({ get body() { throw new Error('mal'); } }), /JSON válido/);
});
