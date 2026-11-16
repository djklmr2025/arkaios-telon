import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { HISTORY_LIMIT, buildMessages, buildSystemPrompt } from '../src/prompt.js';
import { seedEpisodes, storeDefaults } from '../src/seed.js';
import { StoreError, createStore } from '../src/store.js';
import {
  LIMITS,
  ValidationError,
  parseEpisode,
  parseMessageText,
  parseProfile,
  parseSettings,
} from '../src/validate.js';

const validEpisode = () => ({
  title: '  Prueba  ',
  synopsis: 'Una sinopsis.',
  setting: 'Un mundo.',
  role: 'Viajera.',
  opening: 'Empieza aquí.',
  characters: [{ id: 'ana', name: 'Ana', personality: 'Curiosa.' }],
});

async function tempStore(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'telon-store-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return { dir, store: createStore(dir, storeDefaults()) };
}

test('parseEpisode recorta textos y rellena campos opcionales', () => {
  const episode = parseEpisode(validEpisode());

  assert.equal(episode.title, 'Prueba');
  assert.equal(episode.goal, '');
  assert.deepEqual(episode.characters, [{ id: 'ana', name: 'Ana', personality: 'Curiosa.' }]);
});

test('parseEpisode genera un id cuando el del personaje no es seguro', () => {
  const input = { ...validEpisode(), characters: [{ id: '../x', name: 'Ana', personality: 'Curiosa.' }] };

  const [character] = parseEpisode(input).characters;

  assert.match(character.id, /^[\w-]{36}$/);
});

test('parseEpisode rechaza episodios incompletos o desbordados', () => {
  const tooMany = Array.from({ length: LIMITS.maxCharacters + 1 }, () => ({ name: 'A', personality: 'B' }));

  assert.throws(() => parseEpisode(null), ValidationError);
  assert.throws(() => parseEpisode({ ...validEpisode(), title: '' }), /título/);
  assert.throws(() => parseEpisode({ ...validEpisode(), title: 7 }), /debe ser texto/);
  assert.throws(() => parseEpisode({ ...validEpisode(), title: 'x'.repeat(LIMITS.title + 1) }), /supera/);
  assert.throws(() => parseEpisode({ ...validEpisode(), characters: [] }), /al menos un personaje/);
  assert.throws(() => parseEpisode({ ...validEpisode(), characters: tooMany }), /Máximo/);
  assert.throws(() => parseEpisode({ ...validEpisode(), characters: ['x'] }), ValidationError);
});

test('parseProfile acepta un perfil vacío', () => {
  assert.deepEqual(parseProfile({}), { name: '', description: '' });
});

test('parseSettings normaliza la URL y rechaza motores o URLs inválidos', () => {
  const settings = parseSettings({ engine: 'openai', model: 'm', baseUrl: 'https://api.example.com/v1/' });

  assert.equal(settings.baseUrl, 'https://api.example.com/v1');
  assert.throws(() => parseSettings({ engine: 'otro', model: 'm', baseUrl: 'http://a' }), /Motor desconocido/);
  assert.throws(() => parseSettings({ engine: 'ollama', model: 'm', baseUrl: 'no es url' }), /no es válida/);
  assert.throws(() => parseSettings({ engine: 'ollama', model: 'm', baseUrl: 'file:///c:/x' }), /http/);
});

test('parseMessageText rechaza mensajes vacíos o demasiado largos', () => {
  assert.equal(parseMessageText(' hola '), 'hola');
  assert.throws(() => parseMessageText('   '), ValidationError);
  assert.throws(() => parseMessageText('x'.repeat(LIMITS.message + 1)), ValidationError);
});

test('el prompt de episodio incluye mundo, reparto y nombre del jugador', () => {
  const [episode] = seedEpisodes();
  const session = { mode: 'episode', episode, messages: [] };

  const prompt = buildSystemPrompt(session, { name: 'Saul', description: 'Marinero retirado.' });

  assert.match(prompt, /El faro de Punta Niebla/);
  assert.match(prompt, /Irene Vela/);
  assert.match(prompt, /Nunca hables, pienses ni decidas por Saul/);
  assert.match(prompt, /Marinero retirado/);
});

test('el prompt de charla habla como el personaje y usa un nombre por defecto', () => {
  const [episode] = seedEpisodes();
  const session = { mode: 'chat', episode, characterId: 'tomas', messages: [] };

  const prompt = buildSystemPrompt(session, { name: '', description: '' });

  assert.match(prompt, /^Eres Tomás/);
  assert.match(prompt, /Protagonista/);
});

test('buildMessages recorta el historial y nunca empieza por el asistente', () => {
  const [episode] = seedEpisodes();
  const turns = Array.from({ length: HISTORY_LIMIT + 5 }, (_, i) => ({
    role: i % 2 === 0 ? 'assistant' : 'user',
    text: `m${i}`,
  }));

  const messages = buildMessages({ mode: 'episode', episode, messages: turns }, {});
  const onlyOpening = buildMessages({ mode: 'episode', episode, messages: turns.slice(0, 1) }, {});

  assert.equal(messages[0].role, 'system');
  assert.equal(messages[1].role, 'user');
  assert.ok(messages.length <= HISTORY_LIMIT + 1);
  assert.equal(messages.at(-1).content, `m${turns.length - 1}`);
  assert.equal(onlyOpening.length, 1);
});

test('el almacén devuelve los valores por defecto y persiste los cambios', async (t) => {
  const { dir, store } = await tempStore(t);

  const seeded = await store.read('episodes');
  await store.update('profile', () => ({ name: 'Saul', description: '' }));
  const reopened = createStore(dir, storeDefaults());

  assert.equal(seeded.length, 3);
  assert.deepEqual(await reopened.read('profile'), { name: 'Saul', description: '' });
});

test('el almacén serializa las actualizaciones concurrentes', async (t) => {
  const { store } = await tempStore(t);

  await Promise.all(
    [1, 2, 3, 4, 5].map((n) => store.update('sessions', (sessions) => [...sessions, { id: `s${n}` }])),
  );

  assert.equal((await store.read('sessions')).length, 5);
});

test('el almacén sigue funcionando después de una actualización fallida', async (t) => {
  const { store } = await tempStore(t);

  await assert.rejects(store.update('sessions', () => Promise.reject(new Error('boom'))), /boom/);
  await store.update('sessions', () => [{ id: 'ok' }]);

  assert.deepEqual(await store.read('sessions'), [{ id: 'ok' }]);
});

test('el almacén avisa de archivos dañados y de colecciones desconocidas', async (t) => {
  const { dir, store } = await tempStore(t);
  await writeFile(path.join(dir, 'profile.json'), '{roto', 'utf8');

  await assert.rejects(store.read('profile'), StoreError);
  await assert.rejects(store.read('../secreto'), StoreError);
});
