import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, request } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.js';
import { EngineError } from '../src/engines.js';
import { storeDefaults } from '../src/seed.js';
import { createStore } from '../src/store.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const SHARED_DIR = path.join(ROOT, 'src');

const echoEngine = {
  status: async () => ({ ok: true, detail: 'listo', models: [] }),
  chat: async (messages, { onToken }) => {
    onToken('Eco: ');
    onToken(messages.at(-1).content);
    return `Eco: ${messages.at(-1).content}`;
  },
};

async function startApp(t, { engine = echoEngine, ...options } = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'telon-app-'));
  const seenPrompts = [];
  const seenSettings = [];
  const errors = [];
  const app = createApp({
    store: createStore(dir, storeDefaults()),
    publicDir: PUBLIC_DIR,
    sharedDir: SHARED_DIR,
    env: {},
    engineFor: (settings) => {
      seenSettings.push(settings);
      return wrapped;
    },
    logger: (err) => errors.push(err),
    ...options,
  });
  const wrapped = {
    ...{
      ...engine,
      chat: (messages, opts) => {
        seenPrompts.push(messages);
        return engine.chat(messages, opts);
      },
    },
  };
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  async function api(method, route, body, headers = {}) {
    const response = await fetch(base + route, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, json: await response.json() };
  }

  async function streamPost(route, body, headers = {}) {
    const response = await fetch(base + route, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    if (!response.ok) return { status: response.status, events: [], json: await response.json() };
    const events = (await response.text()).split('\n').filter(Boolean).map((line) => JSON.parse(line));
    return { status: response.status, events };
  }

  const send = (sessionId, body) => streamPost(`/api/sessions/${sessionId}/messages`, body);

  function statusWithHost(host) {
    return new Promise((resolve, reject) => {
      const req = request(`${base}/api/episodes`, { headers: { host } }, (res) => {
        res.resume();
        resolve(res.statusCode);
      });
      req.on('error', reject);
      req.end();
    });
  }

  return { base, api, send, streamPost, statusWithHost, seenPrompts, seenSettings, errors };
}

const newEpisode = () => ({
  title: 'Episodio propio',
  synopsis: 'Sinopsis.',
  setting: 'Mundo.',
  role: 'Papel.',
  opening: 'Arranque.',
  characters: [{ name: 'Lía', personality: 'Valiente.' }],
});

test('sirve la interfaz con cabeceras de seguridad y oculta otros archivos', async (t) => {
  const { base } = await startApp(t);

  const page = await fetch(`${base}/`);
  const missing = await fetch(`${base}/../server.js`);

  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);
  assert.match(await page.text(), /<title>/);
  assert.equal(missing.status, 404);
});

test('la biblioteca arranca con los episodios de muestra', async (t) => {
  const { api } = await startApp(t);

  const { status, json } = await api('GET', '/api/episodes');

  assert.equal(status, 200);
  assert.equal(json.success, true);
  assert.equal(json.data.length, 3);
});

test('crea, edita y borra un episodio propio', async (t) => {
  const { api } = await startApp(t);

  const created = await api('POST', '/api/episodes', newEpisode());
  const id = created.json.data.id;
  const edited = await api('PUT', `/api/episodes/${id}`, { ...newEpisode(), title: 'Otro título' });
  const fetched = await api('GET', `/api/episodes/${id}`);
  const removed = await api('DELETE', `/api/episodes/${id}`);
  const gone = await api('GET', `/api/episodes/${id}`);

  assert.equal(created.status, 201);
  assert.equal(edited.json.data.title, 'Otro título');
  assert.equal(fetched.json.data.title, 'Otro título');
  assert.equal(removed.status, 200);
  assert.equal(gone.status, 404);
});

test('rechaza episodios inválidos y peticiones mal formadas', async (t) => {
  const { api, base } = await startApp(t);

  const invalid = await api('POST', '/api/episodes', { ...newEpisode(), title: '' });
  const missing = await api('PUT', '/api/episodes/no-existe', newEpisode());
  const missingDelete = await api('DELETE', '/api/episodes/no-existe');
  const notJson = await fetch(`${base}/api/episodes`, { method: 'POST', body: '{roto' });
  const notObject = await api('POST', '/api/episodes', [1]);
  const tooBig = await api('PUT', '/api/profile', { name: 'x'.repeat(300 * 1024) });

  assert.equal(invalid.status, 400);
  assert.equal(invalid.json.success, false);
  assert.match(invalid.json.error, /título/);
  assert.equal(missing.status, 404);
  assert.equal(missingDelete.status, 404);
  assert.equal(notJson.status, 400);
  assert.equal(notObject.status, 400);
  assert.equal(tooBig.status, 413);
});

test('responde 404 y 405 en rutas o métodos desconocidos', async (t) => {
  const { api } = await startApp(t);

  assert.equal((await api('GET', '/api/nada')).status, 404);
  assert.equal((await api('DELETE', '/api/profile')).status, 405);
});

test('bloquea hosts ajenos y orígenes cruzados', async (t) => {
  const { api, statusWithHost } = await startApp(t);

  const rebinding = await statusWithHost('evil.example');
  const crossSite = await api('PUT', '/api/profile', { name: 'x' }, { origin: 'https://evil.example' });
  const badOrigin = await api('PUT', '/api/profile', { name: 'x' }, { origin: 'no-es-url' });

  assert.equal(rebinding, 403);
  assert.equal(crossSite.status, 403);
  assert.equal(badOrigin.status, 403);
});

test('en modo red local acepta otros hosts pero sigue exigiendo el mismo origen', async (t) => {
  const { api, base, statusWithHost } = await startApp(t, { allowAnyHost: true });

  const lan = await statusWithHost('portatil.lan:4500');
  const sameOrigin = await api('PUT', '/api/profile', { name: 'x' }, { origin: base });

  assert.equal(lan, 200);
  assert.equal(sameOrigin.status, 200);
});

test('guarda el perfil y la configuración sin exponer la clave', async (t) => {
  const { api } = await startApp(t);

  const profile = await api('PUT', '/api/profile', { name: 'Saul', description: 'Curioso.' });
  const settings = await api('PUT', '/api/settings', {
    engine: 'openai',
    model: 'modelo',
    baseUrl: 'https://api.example.com/v1/',
  });
  const badSettings = await api('PUT', '/api/settings', { engine: 'x', model: 'm', baseUrl: 'http://a' });
  const status = await api('GET', '/api/engine/status');

  assert.deepEqual((await api('GET', '/api/profile')).json.data, profile.json.data);
  assert.equal(settings.json.data.baseUrl, 'https://api.example.com/v1');
  assert.equal(settings.json.data.hasApiKey, false);
  assert.equal((await api('GET', '/api/settings')).json.data.engine, 'openai');
  assert.equal(badSettings.status, 400);
  assert.equal(status.json.data.ok, true);
});

test('una partida de episodio abre con la escena inicial y responde en flujo', async (t) => {
  const { api, send, seenPrompts } = await startApp(t);
  await api('PUT', '/api/profile', { name: 'Saul', description: '' });

  const session = (await api('POST', '/api/sessions', { mode: 'episode', episodeId: 'estacion-kepler-9' })).json.data;
  const { status, events } = await send(session.id, { text: 'Miro las cápsulas vacías.' });
  const saved = (await api('GET', `/api/sessions/${session.id}`)).json.data;

  assert.equal(session.messages.length, 1);
  assert.equal(status, 200);
  assert.deepEqual(events.slice(0, 2).map((e) => e.type), ['token', 'token']);
  assert.equal(events.at(-1).type, 'done');
  assert.equal(events.at(-1).message.text, 'Eco: Miro las cápsulas vacías.');
  assert.deepEqual(saved.messages.map((m) => m.role), ['assistant', 'user', 'assistant']);
  assert.match(seenPrompts[0][0].content, /Saul/);
  assert.equal(seenPrompts[0][1].role, 'user');
});

test('una charla 1:1 usa la voz del personaje y aparece en la lista de partidas', async (t) => {
  const { api, send, seenPrompts } = await startApp(t);

  const created = await api('POST', '/api/sessions', {
    mode: 'chat',
    episodeId: 'mercado-mil-lamparas',
    characterId: 'brasa',
  });
  await send(created.json.data.id, { text: 'Hola, zorro.' });
  const list = (await api('GET', '/api/sessions')).json.data;

  assert.equal(created.json.data.title, 'Charla con Brasa');
  assert.match(seenPrompts[0][0].content, /^Eres Brasa/);
  assert.equal(list.length, 1);
  assert.equal(list[0].messageCount, 2);
  assert.match(list[0].preview, /Eco/);
});

test('la partida conserva su episodio aunque se borre de la biblioteca', async (t) => {
  const { api, send } = await startApp(t);
  const session = (await api('POST', '/api/sessions', { mode: 'episode', episodeId: 'faro-punta-niebla' })).json.data;

  await api('DELETE', '/api/episodes/faro-punta-niebla');
  const { events } = await send(session.id, { text: 'Sigo.' });

  assert.equal(events.at(-1).type, 'done');
});

test('rechaza partidas y mensajes inválidos', async (t) => {
  const { api, send } = await startApp(t);
  const session = (await api('POST', '/api/sessions', { mode: 'episode', episodeId: 'faro-punta-niebla' })).json.data;

  const badMode = await api('POST', '/api/sessions', { mode: 'otro', episodeId: 'faro-punta-niebla' });
  const badEpisode = await api('POST', '/api/sessions', { mode: 'episode', episodeId: 'nada' });
  const badCharacter = await api('POST', '/api/sessions', { mode: 'chat', episodeId: 'faro-punta-niebla', characterId: 'x' });
  const empty = await api('POST', `/api/sessions/${session.id}/messages`, { text: '  ' });
  const noSession = await api('POST', '/api/sessions/nada/messages', { text: 'hola' });
  const nothingPending = await api('POST', `/api/sessions/${session.id}/messages`, { retry: true });
  const retryMissing = await api('POST', '/api/sessions/nada/messages', { retry: true });
  const { events } = await send(session.id, { text: 'ok' });

  assert.equal(badMode.status, 400);
  assert.equal(badEpisode.status, 404);
  assert.equal(badCharacter.status, 400);
  assert.equal(empty.status, 400);
  assert.equal(noSession.status, 404);
  assert.equal(nothingPending.status, 409);
  assert.equal(retryMissing.status, 404);
  assert.equal(events.at(-1).type, 'done');
});

test('si el motor falla se avisa, se conserva el mensaje y se puede reintentar', async (t) => {
  let attempts = 0;
  const flaky = {
    ...echoEngine,
    chat: async (messages, options) => {
      attempts += 1;
      if (attempts === 1) throw new EngineError('Ollama no responde.');
      return echoEngine.chat(messages, options);
    },
  };
  const { api, send } = await startApp(t, { engine: flaky });
  const session = (await api('POST', '/api/sessions', { mode: 'episode', episodeId: 'faro-punta-niebla' })).json.data;

  const failed = await send(session.id, { text: 'Subo al faro.' });
  const afterFailure = (await api('GET', `/api/sessions/${session.id}`)).json.data;
  const retried = await send(session.id, { retry: true });
  const afterRetry = (await api('GET', `/api/sessions/${session.id}`)).json.data;

  assert.deepEqual(failed.events, [{ type: 'error', error: 'Ollama no responde.' }]);
  assert.equal(afterFailure.messages.at(-1).role, 'user');
  assert.equal(retried.events.at(-1).type, 'done');
  assert.deepEqual(afterRetry.messages.map((m) => m.role), ['assistant', 'user', 'assistant']);
});

test('un fallo inesperado del motor no filtra detalles y queda registrado', async (t) => {
  const broken = { ...echoEngine, chat: async () => { throw new Error('detalle interno'); } };
  const { api, send, errors } = await startApp(t, { engine: broken });
  const session = (await api('POST', '/api/sessions', { mode: 'episode', episodeId: 'faro-punta-niebla' })).json.data;

  const { events } = await send(session.id, { text: 'Hola.' });

  assert.deepEqual(events, [{ type: 'error', error: 'Error inesperado del motor.' }]);
  assert.equal(errors.length, 1);
});

test('no genera dos respuestas a la vez para la misma partida', async (t) => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const slow = { ...echoEngine, chat: async (messages, options) => { await gate; return echoEngine.chat(messages, options); } };
  const { api, send, seenPrompts } = await startApp(t, { engine: slow });
  const session = (await api('POST', '/api/sessions', { mode: 'episode', episodeId: 'faro-punta-niebla' })).json.data;

  const first = send(session.id, { text: 'Primera.' });
  while (seenPrompts.length === 0) await new Promise((resolve) => setTimeout(resolve, 5));
  const second = await api('POST', `/api/sessions/${session.id}/messages`, { retry: true });
  release();
  const { events } = await first;
  const saved = (await api('GET', `/api/sessions/${session.id}`)).json.data;

  assert.equal(second.status, 409);
  assert.equal(events.at(-1).type, 'done');
  assert.deepEqual(saved.messages.map((m) => m.role), ['assistant', 'user', 'assistant']);
});

test('el motor no se puede cambiar desde otro equipo de la red', async (t) => {
  const { api } = await startApp(t, { allowAnyHost: true, isLocalRequest: () => false });

  const changed = await api('PUT', '/api/settings', { engine: 'openai', model: 'm', baseUrl: 'http://otro:9999' });
  const settings = (await api('GET', '/api/settings')).json.data;

  assert.equal(changed.status, 403);
  assert.equal(settings.engine, 'ollama');
});

test('borra una partida', async (t) => {
  const { api } = await startApp(t);
  const session = (await api('POST', '/api/sessions', { mode: 'episode', episodeId: 'faro-punta-niebla' })).json.data;

  const removed = await api('DELETE', `/api/sessions/${session.id}`);
  const again = await api('DELETE', `/api/sessions/${session.id}`);

  assert.equal(removed.status, 200);
  assert.equal(again.status, 404);
  assert.deepEqual((await api('GET', '/api/sessions')).json.data, []);
});
