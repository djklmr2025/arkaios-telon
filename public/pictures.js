import { h } from '/dom.js';
import {
  COVER_SIZE,
  IMAGE_ORIGIN,
  MAX_COVER_CHARS,
  coverPrompt,
  coverSource,
  driverUrl,
  imageUrl,
  scenePrompt,
} from '/shared/art.js';

const PREF_KEY = 'telon:images';
const SCENES_KEY = 'telon:scenes';
const JPEG_QUALITIES = [0.82, 0.6, 0.4];
const SECOND_MS = 1000;
const MAX_ATTEMPTS = 4;
const RETRY_MS = 46 * SECOND_MS;
let queue = Promise.resolve();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Reads a finished picture from the browser cache. The service refuses fetch() over the network
 * (403), but a real picture is cacheable while its 'busy' notice is not, so success means it is real.
 */
async function drawnPicture(url) {
  const response = await fetch(url, { referrerPolicy: 'no-referrer' }).catch(() => null);
  return response?.ok ? URL.createObjectURL(await response.blob()) : null;
}

/** Only an image element makes the service draw. When it is busy it sends a notice picture instead. */
function askToDraw(url) {
  return new Promise((resolve) => {
    const probe = new Image();
    probe.referrerPolicy = 'no-referrer';
    probe.onload = resolve;
    probe.onerror = resolve;
    probe.src = url;
  });
}

/** The free service draws one new picture every 45 s, so a refused request waits and tries again. */
async function fetchPicture(url) {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const ready = await drawnPicture(url);
    if (ready) return ready;
    if (attempt > 0) await sleep(RETRY_MS);
    await askToDraw(url);
  }
  const ready = await drawnPicture(url);
  if (ready) return ready;
  throw new Error('El generador de imágenes no respondió.');
}

const loaded = new Map();

function generated(url) {
  if (loaded.has(url)) return loaded.get(url);
  const job = queue.then(() => fetchPicture(url));
  queue = job.catch(() => undefined);
  loaded.set(url, job);
  job.catch(() => loaded.delete(url));
  return job;
}

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    throw new Error('No se pudo guardar en este navegador (¿almacenamiento lleno o bloqueado?).');
  }
}

/** Generated pictures send the episode text to the image service, so local mode starts with them off. */
export function imagesEnabled(mode) {
  return read(PREF_KEY, mode === 'web') === true;
}

export function setImagesEnabled(enabled) {
  write(PREF_KEY, enabled);
}

function placeholder(title) {
  const initial = (title ?? '').trim().charAt(0).toUpperCase() || '✦';
  return h('div', { class: 'cover placeholder', 'aria-hidden': 'true' }, initial);
}

function picture(src, alt, fallback) {
  const img = h('img', {
    class: 'cover',
    src,
    alt,
    width: COVER_SIZE.width,
    height: COVER_SIZE.height,
    loading: 'lazy',
    decoding: 'async',
    referrerpolicy: 'no-referrer',
  });
  img.addEventListener('error', () => img.replaceWith(fallback()), { once: true });
  return img;
}

function generatedPicture(url, alt, fallback) {
  const waiting = h('div', { class: 'cover placeholder waiting', role: 'status' }, 'Dibujando…');
  generated(url).then(
    (objectUrl) => waiting.replaceWith(picture(objectUrl, alt, fallback)),
    () => waiting.replaceWith(fallback()),
  );
  return waiting;
}

function anyPicture(src, alt, fallback) {
  return src.startsWith(IMAGE_ORIGIN) ? generatedPicture(src, alt, fallback) : picture(src, alt, fallback);
}

export function coverNode(episode, generate) {
  const src = coverSource(episode, generate);
  const fallback = () => placeholder(episode.title);
  return src ? anyPicture(src, `Portada de ${episode.title}`, fallback) : fallback();
}

async function fileToCover(file) {
  const bitmap = await createImageBitmap(file).catch(() => {
    throw new Error('Ese archivo no es una imagen que se pueda abrir.');
  });
  const { width, height } = COVER_SIZE;
  const canvas = h('canvas', { width, height });
  const scale = Math.max(width / bitmap.width, height / bitmap.height);
  const drawn = { width: bitmap.width * scale, height: bitmap.height * scale };
  canvas
    .getContext('2d')
    .drawImage(bitmap, (width - drawn.width) / 2, (height - drawn.height) / 2, drawn.width, drawn.height);
  const cover = JPEG_QUALITIES.map((quality) => canvas.toDataURL('image/jpeg', quality)).find(
    (candidate) => candidate.length <= MAX_COVER_CHARS,
  );
  if (!cover) throw new Error('La imagen pesa demasiado incluso reducida. Prueba con otra.');
  return cover;
}

/**
 * Cover controls for the episode editor.
 * @param {object} episode episode being edited (may be a blank draft)
 * @param {() => object} readDraft current form values, used to word the Perchance prompt
 * @param {{ generate: boolean, onError: (err: Error) => void }} options
 */
export function coverEditor(episode, readDraft, { generate, onError }) {
  let cover = episode.cover ?? '';
  const frame = h('div', { class: 'cover-frame' });
  const refresh = () => {
    const shown = { ...episode, cover };
    frame.replaceChildren(shown.id || cover ? coverNode(shown, generate) : placeholder(readDraft().title));
  };
  const upload = h('input', { type: 'file', accept: 'image/*', class: 'visually-hidden' });
  upload.addEventListener('change', async () => {
    const [file] = upload.files;
    upload.value = '';
    if (!file) return;
    try {
      cover = await fileToCover(file);
      refresh();
    } catch (err) {
      onError(err);
    }
  });
  const openDriver = () => {
    const draft = readDraft();
    if (!draft.title || !draft.setting) return onError(new Error('Escribe antes el título y el mundo.'));
    window.open(driverUrl(coverPrompt(draft)), '_blank', 'noopener,noreferrer');
  };
  const clear = () => {
    cover = '';
    refresh();
  };
  refresh();
  const hint = generate
    ? 'Sin imagen propia, Telón pide una portada a Pollinations a partir del mundo y el tono.'
    : 'Sin imagen propia se muestra la inicial del título. Puedes activar las ilustraciones automáticas en Ajustes.';
  const node = h(
    'fieldset',
    { class: 'cover-editor' },
    h('legend', {}, 'Portada'),
    frame,
    h(
      'div',
      { class: 'actions' },
      h('label', { class: 'button' }, 'Subir imagen', upload),
      h('button', { type: 'button', onclick: openDriver }, 'Crearla en Perchance'),
      h('button', { type: 'button', class: 'quiet', onclick: clear }, 'Quitar imagen'),
    ),
    h('p', { class: 'hint' }, `${hint} «Crearla en Perchance» abre el generador con la descripción ya escrita: descarga la imagen allí y súbela aquí.`),
  );
  return { node, value: () => cover };
}

function savedScenes() {
  return read(SCENES_KEY, {});
}

export function hasScene(sessionId, messageId) {
  return (savedScenes()[sessionId] ?? []).includes(messageId);
}

function setScene(sessionId, messageId, isSaved) {
  const all = savedScenes();
  const others = (all[sessionId] ?? []).filter((id) => id !== messageId);
  write(SCENES_KEY, { ...all, [sessionId]: isSaved ? [...others, messageId] : others });
}

export function forgetScenes(sessionId) {
  const { [sessionId]: _removed, ...rest } = savedScenes();
  write(SCENES_KEY, rest);
}

export function sceneFigure(session, message) {
  const failed = () => {
    setScene(session.id, message.id, false);
    return h('p', { class: 'hint status-bad' }, 'No se pudo generar la ilustración. Pulsa «Ilustrar escena» para reintentar.');
  };
  const src = imageUrl(scenePrompt(session.episode, message.text));
  return h('figure', { class: 'scene' }, generatedPicture(src, 'Ilustración de la escena', failed));
}

export function requestScene(session, message) {
  setScene(session.id, message.id, true);
  return sceneFigure(session, message);
}
