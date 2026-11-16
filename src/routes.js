import { randomUUID } from 'node:crypto';
import { API_KEY_ENV } from './engines.js';
import { HttpError } from './http.js';
import { buildMessages } from './prompt.js';
import { buildSession, byRecent, isAwaitingReply, newMessage, summarize, withMessage } from './session.js';
import { streamChat } from './stream.js';
import { parseEpisode, parseMessageText, parseProfile, parseSettings } from './validate.js';
import { WEB_ROUTES } from './web-routes.js';

export const HANDLED = Symbol('handled');

const LOCAL = 'local';
const ANY = 'any';

const now = () => new Date().toISOString();

async function findEpisode(store, id) {
  const episode = (await store.read('episodes')).find((e) => e.id === id);
  if (!episode) throw new HttpError(404, 'Episodio no encontrado.');
  return episode;
}

async function findSession(store, id) {
  const session = (await store.read('sessions')).find((s) => s.id === id);
  if (!session) throw new HttpError(404, 'Partida no encontrada.');
  return session;
}

async function listEpisodes({ store }) {
  return { data: await store.read('episodes') };
}

async function getEpisode({ store, params }) {
  return { data: await findEpisode(store, params.id) };
}

async function createEpisode({ store, readBody }) {
  const stamp = now();
  const episode = { id: randomUUID(), ...parseEpisode(await readBody()), createdAt: stamp, updatedAt: stamp };
  await store.update('episodes', (episodes) => [...episodes, episode]);
  return { status: 201, data: episode };
}

async function updateEpisode({ store, params, readBody }) {
  const changes = parseEpisode(await readBody());
  let updated = null;
  await store.update('episodes', (episodes) =>
    episodes.map((episode) => {
      if (episode.id !== params.id) return episode;
      updated = { ...episode, ...changes, updatedAt: now() };
      return updated;
    }),
  );
  if (!updated) throw new HttpError(404, 'Episodio no encontrado.');
  return { data: updated };
}

async function removeFrom(store, collection, id, missing) {
  let found = false;
  await store.update(collection, (items) =>
    items.filter((item) => {
      if (item.id !== id) return true;
      found = true;
      return false;
    }),
  );
  if (!found) throw new HttpError(404, missing);
  return { data: { id } };
}

function deleteEpisode({ store, params }) {
  return removeFrom(store, 'episodes', params.id, 'Episodio no encontrado.');
}

function deleteSession({ store, params }) {
  return removeFrom(store, 'sessions', params.id, 'Partida no encontrada.');
}

async function getProfile({ store }) {
  return { data: await store.read('profile') };
}

async function putProfile({ store, readBody }) {
  const profile = parseProfile(await readBody());
  return { data: await store.update('profile', () => profile) };
}

function describeSettings(settings, env) {
  return { ...settings, hasApiKey: Boolean(env[API_KEY_ENV]), apiKeyEnv: API_KEY_ENV };
}

async function getSettings({ store, env }) {
  return { data: describeSettings(await store.read('settings'), env) };
}

async function putSettings({ store, env, readBody, isLocal }) {
  if (!isLocal) throw new HttpError(403, 'El motor solo se puede cambiar desde el equipo donde corre Telón.');
  const settings = parseSettings(await readBody());
  return { data: describeSettings(await store.update('settings', () => settings), env) };
}

async function engineStatus({ store, engineFor }) {
  return { data: await engineFor(await store.read('settings')).status() };
}

async function listSessions({ store }) {
  return { data: byRecent(await store.read('sessions')).map(summarize) };
}

async function getSession({ store, params }) {
  return { data: await findSession(store, params.id) };
}

async function createSession({ store, readBody }) {
  const body = await readBody();
  const episode = await findEpisode(store, body.episodeId);
  const session = buildSession(structuredClone(episode), body.mode, body.characterId);
  await store.update('sessions', (sessions) => [...sessions, session]);
  return { status: 201, data: session };
}

async function appendMessage(store, sessionId, message) {
  let updated = null;
  await store.update('sessions', (sessions) =>
    sessions.map((session) => {
      if (session.id !== sessionId) return session;
      updated = withMessage(session, message);
      return updated;
    }),
  );
  if (!updated) throw new HttpError(404, 'Partida no encontrada.');
  return updated;
}

async function sessionAwaitingReply(store, sessionId) {
  const session = await findSession(store, sessionId);
  if (!isAwaitingReply(session)) throw new HttpError(409, 'No hay ningún mensaje pendiente de respuesta.');
  return session;
}

async function postMessage(ctx) {
  const { store, streaming, params } = ctx;
  const body = await ctx.readBody();
  if (streaming.has(params.id)) throw new HttpError(409, 'Esta partida ya está esperando una respuesta.');
  streaming.add(params.id);
  try {
    const session =
      body.retry === true
        ? await sessionAwaitingReply(store, params.id)
        : await appendMessage(store, params.id, newMessage('user', parseMessageText(body.text)));
    const [profile, settings] = await Promise.all([store.read('profile'), store.read('settings')]);
    await streamChat(ctx, ctx.engineFor(settings), buildMessages(session, profile), (reply) =>
      appendMessage(store, session.id, reply),
    );
  } finally {
    streaming.delete(params.id);
  }
  return HANDLED;
}

const ID = '(?<id>[\\w-]{1,64})';

export const ROUTES = Object.freeze([
  [ANY, 'GET', /^\/api\/episodes$/, listEpisodes],
  [LOCAL, 'POST', /^\/api\/episodes$/, createEpisode],
  [LOCAL, 'GET', new RegExp(`^/api/episodes/${ID}$`), getEpisode],
  [LOCAL, 'PUT', new RegExp(`^/api/episodes/${ID}$`), updateEpisode],
  [LOCAL, 'DELETE', new RegExp(`^/api/episodes/${ID}$`), deleteEpisode],
  [LOCAL, 'GET', /^\/api\/profile$/, getProfile],
  [LOCAL, 'PUT', /^\/api\/profile$/, putProfile],
  [LOCAL, 'GET', /^\/api\/settings$/, getSettings],
  [LOCAL, 'PUT', /^\/api\/settings$/, putSettings],
  [LOCAL, 'GET', /^\/api\/engine\/status$/, engineStatus],
  [LOCAL, 'GET', /^\/api\/sessions$/, listSessions],
  [LOCAL, 'POST', /^\/api\/sessions$/, createSession],
  [LOCAL, 'GET', new RegExp(`^/api/sessions/${ID}$`), getSession],
  [LOCAL, 'DELETE', new RegExp(`^/api/sessions/${ID}$`), deleteSession],
  [LOCAL, 'POST', new RegExp(`^/api/sessions/${ID}/messages$`), postMessage],
  ...WEB_ROUTES.map((route) => [...route.slice(0, -1), async (ctx) => (await route.at(-1)(ctx)) ?? HANDLED]),
]);
