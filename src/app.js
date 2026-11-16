import { createEngine } from './engines.js';
import {
  HttpError,
  checkOrigin,
  clientAddress,
  isLoopbackRequest,
  readJsonBody,
  sendError,
  sendJson,
  serveStatic,
} from './http.js';
import { createRateLimiter } from './rate-limit.js';
import { HANDLED, ROUTES } from './routes.js';

const WEB = 'web';
const POSTS_PER_MINUTE = 30;
const MINUTE_MS = 60 * 1000;

function findRoute(mode, method, pathname) {
  const candidates = ROUTES.filter(
    ([scope, , pattern]) => (scope === 'any' || scope === mode) && pattern.test(pathname),
  );
  if (candidates.length === 0) throw new HttpError(404, 'Ruta no encontrada.');
  const route = candidates.find(([, routeMethod]) => routeMethod === method);
  if (!route) throw new HttpError(405, 'Método no permitido.');
  const [, , pattern, handler] = route;
  return { handler, params: pattern.exec(pathname).groups ?? {} };
}

/**
 * @param {{ store: object, publicDir: string, sharedDir: string, mode?: 'local' | 'web',
 *           env?: object, engineFor?: Function, allowAnyHost?: boolean, logger?: Function,
 *           isLocalRequest?: Function, rateLimiter?: { allow: Function } }} options
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<void>}
 */
export function createApp({
  store,
  publicDir,
  sharedDir,
  mode = 'local',
  env = process.env,
  engineFor = (settings) => createEngine(settings, env),
  allowAnyHost = mode === WEB,
  logger = console.error,
  isLocalRequest = isLoopbackRequest,
  rateLimiter = createRateLimiter(POSTS_PER_MINUTE, MINUTE_MS),
}) {
  const streaming = new Set();
  const trustProxy = mode === WEB;

  function checkRate(req) {
    if (mode !== WEB || req.method !== 'POST') return;
    if (!rateLimiter.allow(clientAddress(req, trustProxy))) {
      throw new HttpError(429, 'Demasiadas peticiones. Espera un momento y vuelve a intentarlo.');
    }
  }

  return async function handle(req, res) {
    try {
      checkOrigin(req, allowAnyHost);
      const { pathname } = new URL(req.url, 'http://local');
      if (!pathname.startsWith('/api/')) {
        await serveStatic(req, res, pathname, { public: publicDir, shared: sharedDir });
        return;
      }
      const { handler, params } = findRoute(mode, req.method, pathname);
      checkRate(req);
      const result = await handler({
        store,
        env,
        mode,
        engineFor,
        logger,
        params,
        req,
        res,
        streaming,
        isLocal: isLocalRequest(req),
        readBody: () => readJsonBody(req),
      });
      if (result === HANDLED) return;
      sendJson(res, result.status ?? 200, { success: true, data: result.data, error: null });
    } catch (err) {
      sendError(res, err, logger);
    }
  };
}
