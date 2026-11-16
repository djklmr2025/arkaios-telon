import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.js';
import {
  IMAGE_ORIGIN,
  MAX_COVER_CHARS,
  coverPrompt,
  coverSource,
  driverUrl,
  imageUrl,
  isValidCover,
  scenePrompt,
  seedOf,
} from '../src/art.js';
import { buildCrossoverMessages, parseCrossoverDraft } from '../src/crossover.js';
import { seedEpisodes, storeDefaults } from '../src/seed.js';
import { buildSession } from '../src/session.js';
import { createStore } from '../src/store.js';
import { LIMITS, ValidationError, parseEpisode } from '../src/validate.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TINY_JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
const KEY = { 'x-telon-key': 'clave-del-visitante-123' };
const DRAFT = {
  title: 'Niebla en órbita',
  tone: 'Misterio espacial',
  synopsis: 'Dos mundos se tocan.',
  setting: 'Un faro que flota junto a una estación.',
  role: 'Quien llega de fuera.',
  opening: 'La niebla entra por la esclusa.',
  goal: 'Cerrar la grieta.',
  characters: [{ name: 'Irene Vela', personality: 'Seca y práctica.' }],
};

async function start(t, mode) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'telon-extras-'));
  const seenPrompts = [];
  const engine = {
    chat: async (messages, { onToken }) => {
      seenPrompts.push(messages);
      onToken('{');
      return JSON.stringify(DRAFT);
    },
  };
  const app = createApp({
    store: createStore(dir, storeDefaults()),
    publicDir: path.join(ROOT, 'public'),
    sharedDir: path.join(ROOT, 'src'),
    mode,
    env: {},
    engineFor: () => engine,
    logger: () => {},
  });
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  async function post(route, body, headers = {}) {
    const response = await fetch(base + route, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    const raw = await response.text();
    const lines = raw.split('\n').filter(Boolean).map((line) => JSON.parse(line));
    return { status: response.status, lines };
  }

  return { base, post, seenPrompts };
}

test('acepta portadas vacías, de muestra o subidas, y rechaza lo demás', () => {
  assert.equal(isValidCover(''), true);
  assert.equal(isValidCover('/covers/faro-punta-niebla.svg'), true);
  assert.equal(isValidCover(TINY_JPEG), true);
  assert.equal(isValidCover('https://ejemplo.test/foto.jpg'), false);
  assert.equal(isValidCover('/covers/../server.js'), false);
  assert.equal(isValidCover('data:image/svg+xml;base64,AAAA'), false);
  assert.equal(isValidCover(`data:image/jpeg;base64,${'A'.repeat(MAX_COVER_CHARS)}`), false);
  assert.equal(isValidCover(42), false);
});

test('la portada sale de la propia imagen, de la muestra, del generador o de ninguna', () => {
  const own = { id: 'x', title: 'Propio', setting: 'Un valle.', cover: TINY_JPEG };
  const sample = { id: 'faro-punta-niebla', title: 'Faro', setting: 'Mar.' };
  const plain = { id: 'x', title: 'Propio', tone: 'Épico', setting: 'Un valle.' };

  assert.equal(coverSource(own, true), TINY_JPEG);
  assert.equal(coverSource(sample, false), '/covers/faro-punta-niebla.svg');
  assert.equal(coverSource(plain, false), null);
  assert.equal(coverSource(plain, true), imageUrl(coverPrompt(plain)));
});

test('las direcciones de imagen son estables, van al generador y escapan el texto', () => {
  const url = new URL(imageUrl('un faro & "niebla"?'));

  assert.equal(url.origin, IMAGE_ORIGIN);
  assert.equal(decodeURIComponent(url.pathname), '/prompt/un faro & "niebla"?');
  assert.equal(url.searchParams.get('seed'), String(seedOf('un faro & "niebla"?')));
  assert.equal(imageUrl('a'), imageUrl('a'));
  assert.notEqual(imageUrl('a'), imageUrl('b'));
  assert.equal(new URL(driverUrl('gato azul')).searchParams.get('prompt'), 'gato azul');
});

test('las descripciones para imagen recortan textos largos', () => {
  const episode = { title: 'T', tone: '', setting: 'm'.repeat(5000) };

  assert.ok(coverPrompt(episode).length < 600);
  assert.ok(scenePrompt(episode, 'e'.repeat(5000)).length < 600);
  assert.match(scenePrompt(episode, 'La puerta cede.'), /La puerta cede\./);
});

test('un episodio guarda su portada y las partidas no la copian', () => {
  const [seed] = seedEpisodes();
  const episode = { ...parseEpisode({ ...seed, cover: TINY_JPEG }), id: 'e1' };

  assert.equal(episode.cover, TINY_JPEG);
  assert.equal(parseEpisode(seed).cover, '');
  assert.equal(buildSession(episode, 'episode').episode.cover, '');
  assert.throws(() => parseEpisode({ ...seed, cover: 'javascript:alert(1)' }), ValidationError);
});

test('el encargo de cruce incluye los dos mundos y pide JSON', () => {
  const [first, second] = seedEpisodes();

  const [system, user] = buildCrossoverMessages(first, second);

  assert.equal(system.role, 'system');
  assert.match(system.content, /JSON/);
  assert.match(user.content, new RegExp(first.title));
  assert.match(user.content, new RegExp(second.characters[0].name));
});

test('el borrador de cruce tolera texto alrededor y recorta los excesos', () => {
  const wordy = { ...DRAFT, title: 't'.repeat(500), characters: [...Array(9)].map((_, i) => ({ name: `P${i}`, personality: 'x' })) };

  const draft = parseCrossoverDraft(`Aquí tienes:\n\`\`\`json\n${JSON.stringify(wordy)}\n\`\`\``);

  assert.equal(draft.title.length, LIMITS.title);
  assert.equal(draft.characters.length, LIMITS.maxCharacters);
  assert.equal(draft.synopsis, DRAFT.synopsis);
  assert.deepEqual(parseCrossoverDraft('{"title":"Solo título"}').characters, [{}]);
  assert.throws(() => parseCrossoverDraft('No puedo ayudarte.'), ValidationError);
  assert.throws(() => parseCrossoverDraft('[1,2]'), ValidationError);
});

test('sirve las portadas de muestra y permite imágenes solo del generador', async (t) => {
  const { base } = await start(t, 'local');

  const cover = await fetch(`${base}/covers/estacion-kepler-9.svg`);
  const page = await fetch(`${base}/`);
  const helper = await fetch(`${base}/pictures.js`);

  assert.equal(cover.status, 200);
  assert.equal(cover.headers.get('content-type'), 'image/svg+xml');
  assert.match(await cover.text(), /^<svg/);
  assert.match(page.headers.get('content-security-policy'), new RegExp(`img-src 'self' data: blob: ${IMAGE_ORIGIN}`));
  assert.equal(helper.status, 200);
  assert.equal((await fetch(`${base}/covers/otra.svg`)).status, 404);
});

test('en local cruza dos episodios guardados con el motor configurado', async (t) => {
  const { post, seenPrompts } = await start(t, 'local');

  const ok = await post('/api/crossover', { episodeIds: ['faro-punta-niebla', 'estacion-kepler-9'] });
  const one = await post('/api/crossover', { episodeIds: ['faro-punta-niebla'] });
  const missing = await post('/api/crossover', { episodeIds: ['faro-punta-niebla', 'no-existe'] });

  assert.equal(ok.status, 200);
  assert.equal(parseCrossoverDraft(ok.lines.at(-1).message.text).title, DRAFT.title);
  assert.match(seenPrompts[0][1].content, /Kepler/);
  assert.equal(one.status, 400);
  assert.equal(missing.status, 404);
});

test('en web cruza los episodios que envía el visitante y exige su clave', async (t) => {
  const { post } = await start(t, 'web');
  const episodes = seedEpisodes().slice(0, 2);
  const body = { provider: 'gemini', model: 'gemini-3.8-flash', episodes };

  const ok = await post('/api/crossover', body, KEY);
  const noKey = await post('/api/crossover', body);
  const one = await post('/api/crossover', { ...body, episodes: episodes.slice(0, 1) }, KEY);

  assert.equal(ok.status, 200);
  assert.equal(ok.lines.at(-1).type, 'done');
  assert.equal(noKey.status, 401);
  assert.equal(one.status, 400);
});
