// Small fetch wrapper: timeouts, bounded retries on 429/5xx, and errors that never echo secrets.
export class HttpError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: string,
  ) {
    super(message);
  }
}

export async function fetchJson<T>(
  url: string,
  init: RequestInit & { timeoutMs?: number; retries?: number } = {},
): Promise<T> {
  const { timeoutMs = 30_000, retries = 2, ...rest } = init;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...rest, signal: ctrl.signal });
      const text = await res.text();
      if (!res.ok) {
        const safeUrl = url.replace(/([?&](api_?key|token|key)=)[^&]+/gi, '$1[redacted]');
        const err = new HttpError(`HTTP ${res.status} from ${new URL(safeUrl).host}${new URL(safeUrl).pathname}: ${text.slice(0, 300)}`, res.status, text);
        if ((res.status === 429 || res.status >= 500) && attempt < retries) {
          lastErr = err;
          await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
          continue;
        }
        throw err;
      }
      if (res.status === 204 || !text) return {} as T;
      return JSON.parse(text) as T;
    } catch (err) {
      lastErr = err;
      const retryable = err instanceof Error && (err.name === 'AbortError' || /ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch failed/i.test(err.message));
      if (!retryable || attempt >= retries) throw err;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}
