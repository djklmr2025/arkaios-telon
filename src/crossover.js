// Shared with the browser (served as /shared/crossover.js): no Node-only imports here.
import { LIMITS, ValidationError } from './validate.js';

const TEXT_FIELDS = Object.freeze({
  title: LIMITS.title,
  tone: LIMITS.name,
  synopsis: LIMITS.short,
  setting: LIMITS.long,
  role: LIMITS.short,
  opening: LIMITS.long,
  goal: LIMITS.short,
});

function describe(episode) {
  const cast = episode.characters.map((c) => `  - ${c.name}: ${c.personality}`).join('\n');
  return [
    `Título: ${episode.title}`,
    episode.tone && `Tono: ${episode.tone}`,
    `Mundo: ${episode.setting}`,
    `Personajes:\n${cast}`,
  ]
    .filter(Boolean)
    .join('\n');
}

export function buildCrossoverMessages(first, second) {
  const system = [
    'Eres guionista de historias interactivas. Escribes siempre en español.',
    'Te doy dos episodios. Escribe un episodio nuevo donde sus dos mundos se cruzan de forma coherente.',
    `Reutiliza entre 2 y ${LIMITS.maxCharacters} personajes de los originales, con al menos uno de cada episodio, conservando su nombre y su carácter.`,
    'Devuelve solo un objeto JSON, sin texto antes ni después, con estas claves:',
    '"title" (máx. 80 caracteres), "tone" (máx. 60), "synopsis" (máx. 400), "setting" (el mundo combinado), "role" (el papel del jugador, máx. 400), "opening" (la primera escena, en segunda persona, 1 o 2 párrafos), "goal" (máx. 400) y "characters" (lista de objetos con "name" y "personality").',
  ].join('\n');
  const user = `EPISODIO A\n${describe(first)}\n\nEPISODIO B\n${describe(second)}`;
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

function clip(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function draftCharacter(raw) {
  return { name: clip(raw?.name, LIMITS.name), personality: clip(raw?.personality, LIMITS.short) };
}

/**
 * Turns the model's answer into an editor draft. The author still reviews and saves it.
 * @param {string} text
 */
export function parseCrossoverDraft(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  let raw = null;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    raw = null;
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ValidationError('La IA no devolvió un episodio válido. Inténtalo de nuevo.');
  }
  const characters = (Array.isArray(raw.characters) ? raw.characters : [])
    .map(draftCharacter)
    .filter((character) => character.name)
    .slice(0, LIMITS.maxCharacters);
  const fields = Object.entries(TEXT_FIELDS).map(([key, max]) => [key, clip(raw[key], max)]);
  return { ...Object.fromEntries(fields), characters: characters.length ? characters : [{}] };
}
