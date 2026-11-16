export const API_KEY_ENV = 'TELON_API_KEY';

const MAX_REPLY_TOKENS = 400;
const TEMPERATURE = 0.8;
const CHAT_TIMEOUT_MS = 10 * 60 * 1000;
const STATUS_TIMEOUT_MS = 5000;
const ERROR_BODY_LIMIT = 300;

export class EngineError extends Error {}

function withTimeout(signal, ms) {
  const timeout = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function errorDetail(body) {
  let detail = body;
  try {
    const parsed = JSON.parse(body);
    const found = [parsed].flat()[0]?.error;
    detail = found?.message ?? (typeof found === 'string' ? found : body);
  } catch {
    detail = body;
  }
  return String(detail).slice(0, ERROR_BODY_LIMIT);
}

async function request(fetchImpl, url, init, label) {
  let response;
  try {
    response = await fetchImpl(url, init);
  } catch (err) {
    if (err.name === 'TimeoutError') throw new EngineError(`${label} tardó demasiado en responder.`);
    if (err.name === 'AbortError') throw err;
    throw new EngineError(`No se pudo conectar con ${label} (${url}).`);
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new EngineError(`${label} respondió ${response.status}. ${errorDetail(body)}`.trim());
  }
  return response;
}

export async function* readLines(body) {
  const decoder = new TextDecoder();
  let pending = '';
  for await (const chunk of body) {
    pending += decoder.decode(chunk, { stream: true });
    const lines = pending.split('\n');
    pending = lines.pop();
    yield* lines;
  }
  pending += decoder.decode();
  if (pending) yield pending;
}

function parseChunk(raw, label) {
  try {
    return JSON.parse(raw);
  } catch {
    throw new EngineError(`${label} envió una respuesta que no se pudo leer.`);
  }
}

async function collect(lines, pieceOf, onToken, label) {
  let full = '';
  for await (const line of lines) {
    const piece = pieceOf(line.trim());
    if (!piece) continue;
    full += piece;
    onToken?.(piece);
  }
  if (!full.trim()) throw new EngineError(`${label} devolvió una respuesta vacía.`);
  return full.trim();
}

export function createOllamaEngine({ baseUrl, model, fetchImpl = fetch }) {
  const label = 'Ollama';

  function pieceOf(line) {
    if (!line) return '';
    const chunk = parseChunk(line, label);
    if (chunk.error) throw new EngineError(`${label}: ${chunk.error}`);
    return chunk.message?.content ?? '';
  }

  return {
    name: 'ollama',
    async chat(messages, { onToken, signal } = {}) {
      const response = await request(
        fetchImpl,
        `${baseUrl}/api/chat`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            model,
            messages,
            stream: true,
            options: { num_predict: MAX_REPLY_TOKENS, temperature: TEMPERATURE },
          }),
          signal: withTimeout(signal, CHAT_TIMEOUT_MS),
        },
        label,
      );
      return collect(readLines(response.body), pieceOf, onToken, label);
    },
    async status() {
      try {
        const response = await request(
          fetchImpl,
          `${baseUrl}/api/tags`,
          { signal: withTimeout(undefined, STATUS_TIMEOUT_MS) },
          label,
        );
        const models = ((await response.json()).models ?? []).map((m) => m.name);
        const ready = models.includes(model);
        const detail = ready
          ? `Ollama en línea con ${model}.`
          : `Ollama en línea, pero falta el modelo ${model} (ollama pull ${model}).`;
        return { ok: ready, detail, models };
      } catch (err) {
        if (!(err instanceof EngineError)) throw err;
        return { ok: false, detail: `${err.message} ¿Está abierto Ollama?`, models: [] };
      }
    },
  };
}

export function createOpenAiEngine({ baseUrl, model, apiKey, fetchImpl = fetch }) {
  const label = 'El proveedor';
  const missingKey = `Falta la clave: define ${API_KEY_ENV} en el archivo .env.`;

  function pieceOf(line) {
    if (!line.startsWith('data:')) return '';
    const payload = line.slice('data:'.length).trim();
    if (!payload || payload === '[DONE]') return '';
    const chunk = parseChunk(payload, label);
    if (chunk.error) throw new EngineError(`${label}: ${chunk.error.message ?? 'error'}`);
    return chunk.choices?.[0]?.delta?.content ?? '';
  }

  return {
    name: 'openai',
    async chat(messages, { onToken, signal } = {}) {
      if (!apiKey) throw new EngineError(missingKey);
      const response = await request(
        fetchImpl,
        `${baseUrl}/chat/completions`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model,
            messages,
            stream: true,
            max_tokens: MAX_REPLY_TOKENS,
            temperature: TEMPERATURE,
          }),
          signal: withTimeout(signal, CHAT_TIMEOUT_MS),
        },
        label,
      );
      return collect(readLines(response.body), pieceOf, onToken, label);
    },
    async status() {
      if (!apiKey) return { ok: false, detail: missingKey, models: [] };
      try {
        const response = await request(
          fetchImpl,
          `${baseUrl}/models`,
          { headers: { authorization: `Bearer ${apiKey}` }, signal: withTimeout(undefined, STATUS_TIMEOUT_MS) },
          label,
        );
        const listed = (await response.json().catch(() => ({}))).data ?? [];
        const models = listed.map((entry) => String(entry.id ?? '').replace(/^models\//, '')).filter(Boolean);
        return { ok: true, detail: `Clave aceptada. Se usará el modelo ${model}.`, models };
      } catch (err) {
        if (!(err instanceof EngineError)) throw err;
        return { ok: false, detail: err.message, models: [] };
      }
    },
  };
}

export function createEngine(settings, env = process.env, fetchImpl = fetch) {
  const options = { baseUrl: settings.baseUrl, model: settings.model, fetchImpl };
  if (settings.engine === 'openai') {
    return createOpenAiEngine({ ...options, apiKey: settings.apiKey ?? env[API_KEY_ENV] });
  }
  return createOllamaEngine(options);
}
