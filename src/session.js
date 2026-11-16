// Shared with the browser (served as /shared/session.js): no Node-only imports here.
import { findCharacter } from './prompt.js';
import { SESSION_MODES, ValidationError } from './validate.js';

export { SESSION_MODES };


const PREVIEW_LENGTH = 140;

const now = () => new Date().toISOString();

export function newMessage(role, text) {
  return { id: crypto.randomUUID(), role, text, at: now() };
}

export function buildSession(episode, mode, characterId) {
  if (!SESSION_MODES.includes(mode)) throw new ValidationError('Modo de partida desconocido.');
  const stamp = now();
  const base = { id: crypto.randomUUID(), mode, episode, createdAt: stamp, updatedAt: stamp };
  if (mode === 'episode') {
    const opening = newMessage('assistant', episode.opening);
    return { ...base, characterId: null, title: episode.title, messages: [opening] };
  }
  const character = findCharacter(episode, characterId);
  if (!character) throw new ValidationError('Ese personaje no pertenece al episodio.');
  return { ...base, characterId: character.id, title: `Charla con ${character.name}`, messages: [] };
}

export function withMessage(session, message) {
  return { ...session, messages: [...session.messages, message], updatedAt: message.at };
}

export function isAwaitingReply(session) {
  return session.messages.at(-1)?.role === 'user';
}

export function summarize(session) {
  const last = session.messages.at(-1);
  return {
    id: session.id,
    mode: session.mode,
    title: session.title,
    episodeTitle: session.episode.title,
    messageCount: session.messages.length,
    preview: last ? last.text.slice(0, PREVIEW_LENGTH) : '',
    updatedAt: session.updatedAt,
  };
}

export function byRecent(sessions) {
  return sessions.toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
