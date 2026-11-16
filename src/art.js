// Shared with the browser (served as /shared/art.js): no Node-only imports here.
export const IMAGE_ORIGIN = 'https://image.pollinations.ai';
export const COVER_SIZE = Object.freeze({ width: 768, height: 432 });
export const MAX_COVER_CHARS = 150_000;

const SAMPLE_COVER_IDS = Object.freeze(['faro-punta-niebla', 'estacion-kepler-9', 'mercado-mil-lamparas']);
const UPLOADED_COVER = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/;
const SAMPLE_COVER = /^\/covers\/[\w-]+\.svg$/;
const PROMPT_EXCERPT = 320;
const STYLE = 'digital painting, cinematic lighting, detailed environment, no text, no letters, no watermark';
const DRIVER_URL = 'https://perchance.org/arkaios';

function excerpt(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, PROMPT_EXCERPT);
}

export function isValidCover(value) {
  if (value === '') return true;
  if (typeof value !== 'string' || value.length > MAX_COVER_CHARS) return false;
  return SAMPLE_COVER.test(value) || UPLOADED_COVER.test(value);
}

/** Stable 31-bit seed so the same text always asks for the same picture. */
export function seedOf(text) {
  let hash = 0;
  for (const char of String(text)) hash = (hash * 31 + char.codePointAt(0)) % 2147483647;
  return hash;
}

export function coverPrompt(episode) {
  return [`Cover art for the story "${excerpt(episode.title)}"`, excerpt(episode.tone), excerpt(episode.setting), STYLE]
    .filter(Boolean)
    .join('. ');
}

export function scenePrompt(episode, sceneText) {
  return [`Scene illustration, ${excerpt(episode.tone) || 'story'}`, excerpt(sceneText), STYLE].join('. ');
}

export function imageUrl(prompt, seed = seedOf(prompt)) {
  const query = `width=${COVER_SIZE.width}&height=${COVER_SIZE.height}&seed=${seed}&nologo=true`;
  return `${IMAGE_ORIGIN}/prompt/${encodeURIComponent(prompt)}?${query}`;
}

/** Link the visitor opens to draw the picture themself in Perchance. */
export function driverUrl(prompt) {
  return `${DRIVER_URL}?mcp=1&prompt=${encodeURIComponent(prompt)}`;
}

/**
 * Where an episode's cover comes from: its own picture, a bundled one, a generated one or none.
 * @param {{ id?: string, cover?: string, title: string }} episode
 * @param {boolean} generate whether generated pictures are switched on
 * @returns {string | null}
 */
export function coverSource(episode, generate) {
  if (episode.cover) return episode.cover;
  if (SAMPLE_COVER_IDS.includes(episode.id)) return `/covers/${episode.id}.svg`;
  return generate ? imageUrl(coverPrompt(episode)) : null;
}
