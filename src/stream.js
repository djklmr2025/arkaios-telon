import { EngineError } from './engines.js';
import { newMessage } from './session.js';

/**
 * Streams one engine reply to the client as NDJSON events: token*, then done or error.
 * @param {{ res: import('node:http').ServerResponse, logger: Function }} ctx
 * @param {{ chat: Function }} engine
 * @param {Array<{ role: string, content: string }>} messages
 * @param {(reply: object) => Promise<unknown>} [saveReply]
 */
export async function streamChat({ res, logger }, engine, messages, saveReply) {
  const abort = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) abort.abort();
  });
  res.writeHead(200, {
    'content-type': 'application/x-ndjson; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  const emit = (event) => res.write(`${JSON.stringify(event)}\n`);
  try {
    const text = await engine.chat(messages, {
      onToken: (piece) => emit({ type: 'token', text: piece }),
      signal: abort.signal,
    });
    const reply = newMessage('assistant', text);
    await saveReply?.(reply);
    emit({ type: 'done', message: reply });
  } catch (err) {
    if (abort.signal.aborted) return;
    if (!(err instanceof EngineError)) logger(err);
    emit({ type: 'error', error: err instanceof EngineError ? err.message : 'Error inesperado del motor.' });
  } finally {
    res.end();
  }
}
