import { HISTORY_LIMIT } from '/shared/prompt.js';
import { buildSession, byRecent, isAwaitingReply, newMessage, summarize, withMessage } from '/shared/session.js';
import { parseEpisode, parseMessageText, parseModelName, parseProfile } from '/shared/validate.js';

const STORAGE_PREFIX = 'telon:';
const KEY_HEADER = 'x-telon-key';

function rejected(message) {
  return Object.assign(new Error(message), { rejected: true });
}

export async function api(method, route, body, headers = {}) {
  const response = await fetch(route, {
    method,
    headers: body === undefined ? headers : { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json();
  if (!payload.success) throw new Error(payload.error ?? 'Error desconocido.');
  return payload.data;
}

async function stream(route, body, headers, onToken, signal) {
  const response = await fetch(route, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) throw rejected((await response.json()).error ?? 'No se pudo enviar.');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });
    const lines = pending.split('\n');
    pending = lines.pop();
    for (const line of lines.filter(Boolean)) {
      const event = JSON.parse(line);
      if (event.type === 'token') onToken(event.text);
      if (event.type === 'error') throw new Error(event.error);
      if (event.type === 'done') return event.message;
    }
  }
  throw new Error('La respuesta se cortó antes de terminar.');
}

export function createServerData() {
  return {
    mode: 'local',
    listEpisodes: () => api('GET', '/api/episodes'),
    getEpisode: (id) => api('GET', `/api/episodes/${id}`),
    saveEpisode: (id, episode) =>
      id ? api('PUT', `/api/episodes/${id}`, episode) : api('POST', '/api/episodes', episode),
    deleteEpisode: (id) => api('DELETE', `/api/episodes/${id}`),
    getProfile: () => api('GET', '/api/profile'),
    saveProfile: (profile) => api('PUT', '/api/profile', profile),
    getSettings: () => api('GET', '/api/settings'),
    saveSettings: (settings) => api('PUT', '/api/settings', settings),
    engineStatus: () => api('GET', '/api/engine/status'),
    listSessions: () => api('GET', '/api/sessions'),
    getSession: (id) => api('GET', `/api/sessions/${id}`),
    createSession: (episodeId, mode, characterId) => api('POST', '/api/sessions', { episodeId, mode, characterId }),
    deleteSession: (id) => api('DELETE', `/api/sessions/${id}`),
    reply: (id, body, onToken, signal) => stream(`/api/sessions/${id}/messages`, body, {}, onToken, signal),
    crossover: (firstId, secondId, onToken, signal) =>
      stream('/api/crossover', { episodeIds: [firstId, secondId] }, {}, onToken, signal),
  };
}

function createBox(storage) {
  return {
    load(name, fallback) {
      try {
        const raw = storage.getItem(STORAGE_PREFIX + name);
        return raw === null ? fallback : JSON.parse(raw);
      } catch {
        return fallback;
      }
    },
    save(name, value) {
      try {
        storage.setItem(STORAGE_PREFIX + name, JSON.stringify(value));
      } catch {
        throw new Error('No se pudo guardar en este navegador (¿almacenamiento lleno o bloqueado?).');
      }
      return value;
    },
  };
}

function findOrFail(items, id, message) {
  const item = items.find((candidate) => candidate.id === id);
  if (!item) throw new Error(message);
  return item;
}

export function createBrowserData(config, storage = localStorage) {
  const box = createBox(storage);
  const [provider] = config.providers;
  const stamp = () => new Date().toISOString();

  async function episodes() {
    const stored = box.load('episodes', null);
    return stored ?? box.save('episodes', await api('GET', '/api/episodes'));
  }

  const sessions = () => box.load('sessions', []);
  const profile = () => box.load('profile', { name: '', description: '' });
  const settings = () => ({
    provider: provider.id,
    model: provider.defaultModel,
    apiKey: '',
    ...box.load('settings', {}),
  });

  function putSession(session) {
    const others = sessions().filter((candidate) => candidate.id !== session.id);
    box.save('sessions', [...others, session]);
    return session;
  }

  function pendingSession(id, body) {
    const session = findOrFail(sessions(), id, 'Partida no encontrada.');
    if (body.retry === true) {
      if (!isAwaitingReply(session)) throw rejected('No hay ningún mensaje pendiente de respuesta.');
      return session;
    }
    return withMessage(session, newMessage('user', parseMessageText(body.text)));
  }

  return {
    mode: 'web',
    provider,
    listEpisodes: episodes,
    getEpisode: async (id) => findOrFail(await episodes(), id, 'Episodio no encontrado.'),
    async saveEpisode(id, input) {
      const parsed = parseEpisode(input);
      const list = await episodes();
      const previous = id ? findOrFail(list, id, 'Episodio no encontrado.') : { id: crypto.randomUUID(), createdAt: stamp() };
      const episode = { ...previous, ...parsed, updatedAt: stamp() };
      box.save('episodes', [...list.filter((candidate) => candidate.id !== episode.id), episode]);
      return episode;
    },
    async deleteEpisode(id) {
      box.save('episodes', (await episodes()).filter((candidate) => candidate.id !== id));
    },
    getProfile: async () => profile(),
    saveProfile: async (input) => box.save('profile', parseProfile(input)),
    getSettings: async () => settings(),
    async saveSettings(input) {
      const apiKey = String(input.apiKey ?? '').trim();
      return box.save('settings', { provider: provider.id, model: parseModelName(input.model), apiKey });
    },
    async engineStatus() {
      const current = settings();
      if (!current.apiKey) return { ok: false, detail: 'Todavía no has guardado tu clave.', models: [] };
      const body = { provider: current.provider, model: current.model };
      return api('POST', '/api/engine/check', body, { [KEY_HEADER]: current.apiKey });
    },
    listSessions: async () => byRecent(sessions()).map(summarize),
    getSession: async (id) => findOrFail(sessions(), id, 'Partida no encontrada.'),
    async createSession(episodeId, mode, characterId) {
      const episode = findOrFail(await episodes(), episodeId, 'Episodio no encontrado.');
      return putSession(buildSession(structuredClone(episode), mode, characterId));
    },
    async deleteSession(id) {
      box.save('sessions', sessions().filter((candidate) => candidate.id !== id));
    },
    async crossover(firstId, secondId, onToken, signal) {
      const current = settings();
      if (!current.apiKey) throw rejected('Falta tu clave de IA. Ponla en Ajustes para usar el cruce.');
      const list = await episodes();
      const chosen = [firstId, secondId].map((id) => ({ ...findOrFail(list, id, 'Episodio no encontrado.'), cover: '' }));
      const request = { provider: current.provider, model: current.model, episodes: chosen };
      return stream('/api/crossover', request, { [KEY_HEADER]: current.apiKey }, onToken, signal);
    },
    async reply(id, body, onToken, signal) {
      const current = settings();
      if (!current.apiKey) throw rejected('Falta tu clave de IA. Ponla en Ajustes para jugar.');
      const before = findOrFail(sessions(), id, 'Partida no encontrada.');
      const session = putSession(pendingSession(id, body));
      const request = {
        mode: session.mode,
        episode: session.episode,
        characterId: session.characterId,
        messages: session.messages.slice(-HISTORY_LIMIT).map(({ role, text }) => ({ role, text })),
        profile: profile(),
        provider: current.provider,
        model: current.model,
      };
      try {
        const message = await stream('/api/reply', request, { [KEY_HEADER]: current.apiKey }, onToken, signal);
        putSession(withMessage(session, message));
        return message;
      } catch (err) {
        if (err.rejected) putSession(before);
        throw err;
      }
    },
  };
}

export async function createData() {
  const config = await api('GET', '/api/config');
  return config.mode === 'web' ? createBrowserData(config) : createServerData();
}
