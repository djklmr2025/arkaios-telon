import assert from 'node:assert/strict';
import test from 'node:test';
import {
  API_KEY_ENV,
  EngineError,
  createEngine,
  createOllamaEngine,
  createOpenAiEngine,
  readLines,
} from '../src/engines.js';

const MESSAGES = [{ role: 'user', content: 'hola' }];

function fakeFetch(body, { status = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return new Response(body, { status });
  };
  return { fetchImpl, calls };
}

function ollama(fetchImpl) {
  return createOllamaEngine({ baseUrl: 'http://ollama.test', model: 'gemma3:4b', fetchImpl });
}

function openai(fetchImpl, apiKey = 'clave-de-prueba') {
  return createOpenAiEngine({ baseUrl: 'https://api.test/v1', model: 'm', apiKey, fetchImpl });
}

test('readLines une líneas partidas entre fragmentos', async () => {
  const encoder = new TextEncoder();
  const body = [encoder.encode('uno\ndo'), encoder.encode('s\ntres')];

  const lines = [];
  for await (const line of readLines(body)) lines.push(line);

  assert.deepEqual(lines, ['uno', 'dos', 'tres']);
});

test('Ollama: junta los fragmentos y los emite uno a uno', async () => {
  const stream = [
    { message: { content: 'Hola' } },
    { message: { content: ', viajero.' } },
    { done: true },
  ]
    .map((chunk) => JSON.stringify(chunk))
    .join('\n');
  const { fetchImpl, calls } = fakeFetch(stream);
  const tokens = [];

  const reply = await ollama(fetchImpl).chat(MESSAGES, { onToken: (t) => tokens.push(t) });

  assert.equal(reply, 'Hola, viajero.');
  assert.deepEqual(tokens, ['Hola', ', viajero.']);
  assert.equal(calls[0].url, 'http://ollama.test/api/chat');
  assert.equal(JSON.parse(calls[0].init.body).model, 'gemma3:4b');
});

test('Ollama: convierte fallos en EngineError legibles', async () => {
  const offline = async () => {
    throw new TypeError('fetch failed');
  };
  const timeout = async () => {
    throw new DOMException('timeout', 'TimeoutError');
  };

  await assert.rejects(ollama(offline).chat(MESSAGES), /No se pudo conectar con Ollama/);
  await assert.rejects(ollama(timeout).chat(MESSAGES), /tardó demasiado/);
  await assert.rejects(ollama(fakeFetch('nope', { status: 404 }).fetchImpl).chat(MESSAGES), /respondió 404/);
  await assert.rejects(ollama(fakeFetch('{"error":"sin memoria"}').fetchImpl).chat(MESSAGES), /sin memoria/);
  await assert.rejects(ollama(fakeFetch('no-json').fetchImpl).chat(MESSAGES), /no se pudo leer/);
  await assert.rejects(ollama(fakeFetch('{"done":true}').fetchImpl).chat(MESSAGES), /vacía/);
});

test('Ollama: una cancelación no se disfraza de error del motor', async () => {
  const aborted = async () => {
    throw new DOMException('aborted', 'AbortError');
  };

  await assert.rejects(ollama(aborted).chat(MESSAGES), (err) => !(err instanceof EngineError));
});

test('Ollama: el estado indica si el modelo está instalado', async () => {
  const withModel = fakeFetch(JSON.stringify({ models: [{ name: 'gemma3:4b' }] })).fetchImpl;
  const withoutModel = fakeFetch(JSON.stringify({ models: [{ name: 'otro:1b' }] })).fetchImpl;
  const offline = async () => {
    throw new TypeError('fetch failed');
  };

  assert.equal((await ollama(withModel).status()).ok, true);
  assert.match((await ollama(withoutModel).status()).detail, /ollama pull gemma3:4b/);
  assert.deepEqual((await ollama(offline).status()).models, []);
  assert.equal((await ollama(offline).status()).ok, false);
});

test('proveedor compatible: lee el flujo SSE y envía la clave', async () => {
  const stream = [
    'data: {"choices":[{"delta":{"content":"Bue"}}]}',
    '',
    ': comentario',
    'data: {"choices":[{"delta":{"content":"nas."}}]}',
    'data: [DONE]',
    '',
  ].join('\n');
  const { fetchImpl, calls } = fakeFetch(stream);

  const reply = await openai(fetchImpl).chat(MESSAGES);

  assert.equal(reply, 'Buenas.');
  assert.equal(calls[0].url, 'https://api.test/v1/chat/completions');
  assert.equal(calls[0].init.headers.authorization, 'Bearer clave-de-prueba');
});

test('proveedor compatible: sin clave no llama a la red', async () => {
  const { fetchImpl, calls } = fakeFetch('');
  const engine = openai(fetchImpl, '');

  await assert.rejects(engine.chat(MESSAGES), new RegExp(API_KEY_ENV));
  assert.equal((await engine.status()).ok, false);
  assert.equal(calls.length, 0);
});

test('proveedor compatible: propaga el error que devuelve el flujo', async () => {
  const { fetchImpl } = fakeFetch('data: {"error":{"message":"cuota agotada"}}\n');

  await assert.rejects(openai(fetchImpl).chat(MESSAGES), /cuota agotada/);
});

test('proveedor compatible: el estado valida la clave y lista los modelos', async () => {
  const listing = JSON.stringify({ data: [{ id: 'models/gemini-a' }, { id: 'gemini-b' }, {}] });
  const { fetchImpl, calls } = fakeFetch(listing);
  const rejected = fakeFetch('{"error":{"code":400,"message":"Please pass a valid API key"}}', { status: 400 }).fetchImpl;
  const wrapped = fakeFetch('[{"error":"sin cuota"}]', { status: 429 }).fetchImpl;

  const status = await openai(fetchImpl).status();
  const bad = await openai(rejected).status();

  assert.equal(status.ok, true);
  assert.deepEqual(status.models, ['gemini-a', 'gemini-b']);
  assert.equal(calls[0].url, 'https://api.test/v1/models');
  assert.equal(calls[0].init.headers.authorization, 'Bearer clave-de-prueba');
  assert.equal(bad.ok, false);
  assert.equal(bad.detail, 'El proveedor respondió 400. Please pass a valid API key');
  assert.equal((await openai(wrapped).status()).detail, 'El proveedor respondió 429. sin cuota');
});

test('createEngine prefiere la clave de la petición a la del entorno', async () => {
  const { fetchImpl, calls } = fakeFetch('data: {"choices":[{"delta":{"content":"ok"}}]}\n');
  const settings = { engine: 'openai', model: 'm', baseUrl: 'https://api.test/v1', apiKey: 'del-visitante' };

  await createEngine(settings, { [API_KEY_ENV]: 'del-servidor' }, fetchImpl).chat(MESSAGES);

  assert.equal(calls[0].init.headers.authorization, 'Bearer del-visitante');
});

test('createEngine elige el motor según la configuración', () => {
  const base = { model: 'm', baseUrl: 'http://x' };

  assert.equal(createEngine({ ...base, engine: 'ollama' }, {}).name, 'ollama');
  assert.equal(createEngine({ ...base, engine: 'openai' }, { [API_KEY_ENV]: 'k' }).name, 'openai');
});
