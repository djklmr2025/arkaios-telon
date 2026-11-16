export const LIMITS = Object.freeze({
  title: 80,
  name: 60,
  short: 400,
  long: 4000,
  message: 2000,
  model: 100,
  maxCharacters: 6,
});

export const ENGINE_NAMES = Object.freeze(['ollama', 'openai']);
export const SESSION_MODES = Object.freeze(['episode', 'chat']);

const CHARACTER_ID = /^[\w-]{1,40}$/;

export class ValidationError extends Error {}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireRecord(value, what) {
  if (!isRecord(value)) throw new ValidationError(`${what} no tiene un formato válido.`);
  return value;
}

function text(value, field, max, { required = true } = {}) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string') throw new ValidationError(`"${field}" debe ser texto.`);
  const trimmed = value.trim();
  if (!trimmed && required) throw new ValidationError(`Falta el campo "${field}".`);
  if (trimmed.length > max) {
    throw new ValidationError(`"${field}" supera los ${max} caracteres.`);
  }
  return trimmed;
}

function parseCharacter(input, index) {
  const raw = requireRecord(input, `El personaje ${index + 1}`);
  const label = `personaje ${index + 1}`;
  return {
    id: typeof raw.id === 'string' && CHARACTER_ID.test(raw.id) ? raw.id : crypto.randomUUID(),
    name: text(raw.name, `nombre del ${label}`, LIMITS.name),
    personality: text(raw.personality, `personalidad del ${label}`, LIMITS.short),
  };
}

export function parseEpisode(input) {
  const raw = requireRecord(input, 'El episodio');
  if (!Array.isArray(raw.characters) || raw.characters.length === 0) {
    throw new ValidationError('El episodio necesita al menos un personaje.');
  }
  if (raw.characters.length > LIMITS.maxCharacters) {
    throw new ValidationError(`Máximo ${LIMITS.maxCharacters} personajes por episodio.`);
  }
  return {
    title: text(raw.title, 'título', LIMITS.title),
    synopsis: text(raw.synopsis, 'sinopsis', LIMITS.short),
    setting: text(raw.setting, 'mundo', LIMITS.long),
    role: text(raw.role, 'papel del protagonista', LIMITS.short),
    opening: text(raw.opening, 'escena inicial', LIMITS.long),
    goal: text(raw.goal, 'meta', LIMITS.short, { required: false }),
    tone: text(raw.tone, 'tono', LIMITS.name, { required: false }),
    characters: raw.characters.map(parseCharacter),
  };
}

export function parseProfile(input) {
  const raw = requireRecord(input, 'El perfil');
  return {
    name: text(raw.name, 'nombre', LIMITS.name, { required: false }),
    description: text(raw.description, 'descripción', LIMITS.short, { required: false }),
  };
}

function parseBaseUrl(value) {
  const raw = text(value, 'URL del motor', LIMITS.short);
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new ValidationError('La URL del motor no es válida.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new ValidationError('La URL del motor debe empezar por http:// o https://.');
  }
  return raw.replace(/\/+$/, '');
}

export function parseSettings(input) {
  const raw = requireRecord(input, 'La configuración');
  if (!ENGINE_NAMES.includes(raw.engine)) {
    throw new ValidationError(`Motor desconocido. Usa uno de: ${ENGINE_NAMES.join(', ')}.`);
  }
  return {
    engine: raw.engine,
    model: text(raw.model, 'modelo', LIMITS.model),
    baseUrl: parseBaseUrl(raw.baseUrl),
  };
}

export function parseMessageText(value) {
  return text(value, 'mensaje', LIMITS.message);
}

const MODEL_NAME = /^[\w.:/-]+$/;
const MAX_REPLY_MESSAGES = 40;
const MAX_STORED_MESSAGE = 8000;
const MESSAGE_ROLES = Object.freeze(['user', 'assistant']);

function parseHistory(value) {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_REPLY_MESSAGES) {
    throw new ValidationError('El historial de la partida no es válido.');
  }
  const messages = value.map((item) => {
    const raw = requireRecord(item, 'Un mensaje del historial');
    if (!MESSAGE_ROLES.includes(raw.role)) throw new ValidationError('Un mensaje tiene un autor desconocido.');
    return { role: raw.role, text: text(raw.text, 'mensaje', MAX_STORED_MESSAGE) };
  });
  if (messages.at(-1).role !== 'user') {
    throw new ValidationError('No hay ningún mensaje pendiente de respuesta.');
  }
  return messages;
}

export function parseModelName(value) {
  const model = text(value, 'modelo', LIMITS.model);
  if (!MODEL_NAME.test(model)) throw new ValidationError('El nombre del modelo no es válido.');
  return model;
}

export function parseReplyRequest(input) {
  const raw = requireRecord(input, 'La petición');
  if (!SESSION_MODES.includes(raw.mode)) throw new ValidationError('Modo de partida desconocido.');
  const episode = parseEpisode(raw.episode);
  const isChat = raw.mode === 'chat';
  if (isChat && !episode.characters.some((character) => character.id === raw.characterId)) {
    throw new ValidationError('Ese personaje no pertenece al episodio.');
  }
  return {
    session: {
      mode: raw.mode,
      episode,
      characterId: isChat ? raw.characterId : null,
      messages: parseHistory(raw.messages),
    },
    profile: parseProfile(raw.profile ?? {}),
    model: parseModelName(raw.model),
  };
}
