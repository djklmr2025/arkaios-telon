import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { IMAGE_ORIGIN } from './art.js';
import { StoreError } from './store.js';
import { ValidationError } from './validate.js';

const MAX_BODY_BYTES = 256 * 1024;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const SAFE_METHODS = new Set(['GET', 'HEAD']);
const CONTENT_SECURITY_POLICY =
  `default-src 'self'; img-src 'self' data: blob: ${IMAGE_ORIGIN}; connect-src 'self' ${IMAGE_ORIGIN}; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`;
const SCRIPT = 'text/javascript; charset=utf-8';
const SVG = 'image/svg+xml';
const STATIC_FILES = Object.freeze({
  '/': ['public', 'index.html', 'text/html; charset=utf-8'],
  '/app.js': ['public', 'app.js', SCRIPT],
  '/data.js': ['public', 'data.js', SCRIPT],
  '/dom.js': ['public', 'dom.js', SCRIPT],
  '/pictures.js': ['public', 'pictures.js', SCRIPT],
  '/styles.css': ['public', 'styles.css', 'text/css; charset=utf-8'],
  '/shared/validate.js': ['shared', 'validate.js', SCRIPT],
  '/shared/prompt.js': ['shared', 'prompt.js', SCRIPT],
  '/shared/session.js': ['shared', 'session.js', SCRIPT],
  '/shared/art.js': ['shared', 'art.js', SCRIPT],
  '/shared/crossover.js': ['shared', 'crossover.js', SCRIPT],
  '/covers/faro-punta-niebla.svg': ['public', 'covers/faro-punta-niebla.svg', SVG],
  '/covers/estacion-kepler-9.svg': ['public', 'covers/estacion-kepler-9.svg', SVG],
  '/covers/mercado-mil-lamparas.svg': ['public', 'covers/mercado-mil-lamparas.svg', SVG],
});

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function checkOrigin(req, allowAnyHost) {
  const host = req.headers.host ?? '';
  if (!allowAnyHost && !LOOPBACK_HOSTS.has(host.replace(/:\d+$/, ''))) {
    throw new HttpError(403, 'Host no permitido.');
  }
  const origin = req.headers.origin;
  if (!origin || SAFE_METHODS.has(req.method)) return;
  let originHost = null;
  try {
    originHost = new URL(origin).host;
  } catch {
    originHost = null;
  }
  if (originHost !== host) throw new HttpError(403, 'Origen no permitido.');
}

const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export function isLoopbackRequest(req) {
  return LOOPBACK_ADDRESSES.has(req.socket.remoteAddress);
}

export function clientAddress(req, trustProxy) {
  const forwarded = trustProxy ? req.headers['x-forwarded-for'] : undefined;
  const first = typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : '';
  return first || req.socket.remoteAddress || 'unknown';
}

function requireObject(parsed) {
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new HttpError(400, 'El cuerpo de la petición debe ser un objeto.');
  }
  return parsed;
}

// Some hosts (Vercel) read the body before calling the handler and expose it as req.body.
function preParsedBody(req) {
  let body;
  try {
    body = req.body;
    if (typeof body === 'string' || Buffer.isBuffer(body)) body = JSON.parse(body.toString('utf8'));
  } catch {
    throw new HttpError(400, 'El cuerpo de la petición no es JSON válido.');
  }
  if (body !== undefined && JSON.stringify(body).length > MAX_BODY_BYTES) {
    throw new HttpError(413, 'La petición es demasiado grande.');
  }
  return body;
}

export async function readJsonBody(req) {
  const preParsed = preParsedBody(req);
  if (preParsed !== undefined) return requireObject(preParsed);
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'La petición es demasiado grande.');
    chunks.push(chunk);
  }
  let parsed;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'El cuerpo de la petición no es JSON válido.');
  }
  return requireObject(parsed);
}

export function sendJson(res, status, payload) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify(payload));
}

function describeError(err, logger) {
  if (err instanceof HttpError) return [err.status, err.message];
  if (err instanceof ValidationError) return [400, err.message];
  if (err instanceof StoreError) return [500, err.message];
  logger(err);
  return [500, 'Error interno del servidor.'];
}

export function sendError(res, err, logger) {
  const [status, message] = describeError(err, logger);
  if (res.headersSent) {
    res.end();
    return;
  }
  sendJson(res, status, { success: false, data: null, error: message });
}

export async function serveStatic(req, res, pathname, dirs) {
  const entry = STATIC_FILES[pathname];
  if (!entry || !SAFE_METHODS.has(req.method)) throw new HttpError(404, 'No encontrado.');
  const [dir, file, contentType] = entry;
  const content = await readFile(path.join(dirs[dir], file)).catch((err) => {
    if (err.code !== 'ENOENT' || dir !== 'shared') throw err;
    return readFile(path.join(dirs.public, 'shared', file));
  });
  res.writeHead(200, {
    'content-type': contentType,
    'cache-control': 'no-cache',
    'x-content-type-options': 'nosniff',
    'content-security-policy': CONTENT_SECURITY_POLICY,
    'referrer-policy': 'no-referrer',
    'x-frame-options': 'DENY',
  });
  res.end(req.method === 'HEAD' ? undefined : content);
}
