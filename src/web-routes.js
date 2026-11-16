import { buildCrossoverMessages } from './crossover.js';
import { HttpError } from './http.js';
import { buildMessages } from './prompt.js';
import { streamChat } from './stream.js';
import { parseEpisode, parseModelName, parseReplyRequest } from './validate.js';

const WEB = 'web';
const ANY = 'any';
const KEY_HEADER = 'x-telon-key';
const KEY_PATTERN = /^[\x21-\x7e]{8,300}$/;

export const PROVIDERS = Object.freeze({
  gemini: Object.freeze({
    id: 'gemini',
    label: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-3.8-flash',
    keyUrl: 'https://aistudio.google.com/apikey',
  }),
});

function publicProvider({ id, label, defaultModel, keyUrl }) {
  return { id, label, defaultModel, keyUrl };
}

function readKey(req) {
  const key = req.headers[KEY_HEADER];
  if (typeof key !== 'string' || !KEY_PATTERN.test(key)) {
    throw new HttpError(401, 'Falta tu clave de IA. Ponla en Ajustes para jugar.');
  }
  return key;
}

function findProvider(id) {
  if (typeof id !== 'string' || !Object.hasOwn(PROVIDERS, id)) {
    throw new HttpError(400, 'Proveedor de IA desconocido.');
  }
  return PROVIDERS[id];
}

function engineOf({ engineFor, req }, provider, model) {
  return engineFor({ engine: 'openai', baseUrl: provider.baseUrl, model, apiKey: readKey(req) });
}

async function getConfig({ mode }) {
  const providers = mode === WEB ? Object.values(PROVIDERS).map(publicProvider) : [];
  return { data: { mode, providers } };
}

async function checkEngine(ctx) {
  const body = await ctx.readBody();
  const provider = findProvider(body.provider);
  return { data: await engineOf(ctx, provider, parseModelName(body.model)).status() };
}

async function reply(ctx) {
  const body = await ctx.readBody();
  const provider = findProvider(body.provider);
  const { session, profile, model } = parseReplyRequest(body);
  await streamChat(ctx, engineOf(ctx, provider, model), buildMessages(session, profile));
}

async function crossover(ctx) {
  const body = await ctx.readBody();
  const provider = findProvider(body.provider);
  if (!Array.isArray(body.episodes) || body.episodes.length !== 2) {
    throw new HttpError(400, 'Elige dos episodios para cruzar.');
  }
  const [first, second] = body.episodes.map(parseEpisode);
  const engine = engineOf(ctx, provider, parseModelName(body.model));
  await streamChat(ctx, engine, buildCrossoverMessages(first, second));
}

export const WEB_ROUTES = Object.freeze([
  [ANY, 'GET', /^\/api\/config$/, getConfig],
  [WEB, 'POST', /^\/api\/engine\/check$/, checkEngine],
  [WEB, 'POST', /^\/api\/reply$/, reply],
  [WEB, 'POST', /^\/api\/crossover$/, crossover],
]);
