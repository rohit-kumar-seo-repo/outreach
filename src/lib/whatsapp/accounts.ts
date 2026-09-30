// WAHA session lifecycle: start/stop/restart/logout an existing session, or add a new one and
// scan it in. Every call carries the server-side WAHA_API_KEY; the browser never sees it —
// the QR code itself is proxied through /api/whatsapp/accounts/[session]/qr.
import { env } from '../env';
import { fetchJson, HttpError } from '../sync/http';

function headers(): Record<string, string> {
  return { 'X-Api-Key': env.wahaApiKey, accept: 'application/json' };
}

export function wahaConfigured(): boolean {
  return !!env.wahaBaseUrl && !!env.wahaApiKey;
}

export interface SessionLiveDetail {
  status: string | null;
  engine: string | null;
  webhooks: { url: string; events: string[] }[];
  error: string | null;
}

/** Live detail straight from WAHA (webhooks, engine) — not stored anywhere, so the Accounts page
 *  always shows what WAHA actually has configured right now rather than a stale copy. */
export async function sessionLiveDetail(name: string): Promise<SessionLiveDetail> {
  try {
    const d = await fetchJson<{ status?: string; engine?: { engine?: string }; config?: { webhooks?: { url?: string; events?: string[] }[] } }>(
      `${env.wahaBaseUrl}/api/sessions/${encodeURIComponent(name)}`,
      { headers: headers(), retries: 0, timeoutMs: 10_000 },
    );
    return {
      status: d.status ?? null,
      engine: d.engine?.engine ?? null,
      webhooks: (d.config?.webhooks ?? []).map((w) => ({ url: w.url ?? '', events: w.events ?? [] })),
      error: null,
    };
  } catch (err) {
    return { status: null, engine: null, webhooks: [], error: err instanceof HttpError ? `HTTP ${err.status}` : (err as Error).message };
  }
}

export type SessionAction = 'start' | 'stop' | 'restart' | 'logout';

/** Best-effort: WAHA's CORE tier supports start/stop/logout; restart may 404 on some builds,
 *  in which case the error is returned as plain text rather than guessed away. */
export async function controlSession(name: string, action: SessionAction): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await fetchJson(`${env.wahaBaseUrl}/api/sessions/${encodeURIComponent(name)}/${action}`, {
      method: 'POST',
      headers: headers(),
      retries: 0,
      timeoutMs: 20_000,
    });
    return { ok: true };
  } catch (err) {
    if (err instanceof HttpError) return { ok: false, error: `WAHA returned HTTP ${err.status}${action === 'restart' && err.status === 404 ? ' — this WAHA version has no restart endpoint; stop it and start it again instead.' : ''}: ${err.body.slice(0, 300)}` };
    return { ok: false, error: (err as Error).message };
  }
}

/** Creates a new session and points its webhook at the same inbound n8n workflow the others use,
 *  so its messages start flowing into the dashboard immediately once it is scanned in. */
export async function createSession(name: string, webhookUrl: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await fetchJson(`${env.wahaBaseUrl}/api/sessions`, {
      method: 'POST',
      headers: { ...headers(), 'content-type': 'application/json' },
      body: JSON.stringify({
        name,
        start: true,
        config: webhookUrl ? { webhooks: [{ url: webhookUrl, events: ['message'] }] } : undefined,
      }),
      retries: 0,
      timeoutMs: 20_000,
    });
    return { ok: true };
  } catch (err) {
    if (err instanceof HttpError) return { ok: false, error: `WAHA returned HTTP ${err.status}: ${err.body.slice(0, 300)}` };
    return { ok: false, error: (err as Error).message };
  }
}

export async function deleteSession(name: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await fetchJson(`${env.wahaBaseUrl}/api/sessions/${encodeURIComponent(name)}`, { method: 'DELETE', headers: headers(), retries: 0, timeoutMs: 20_000 });
    return { ok: true };
  } catch (err) {
    if (err instanceof HttpError) return { ok: false, error: `WAHA returned HTTP ${err.status}: ${err.body.slice(0, 300)}` };
    return { ok: false, error: (err as Error).message };
  }
}

/** Streams the session's QR code (PNG bytes) straight from WAHA. Only meaningful while the
 *  session's status is SCAN_QR_CODE; any other response is passed through as an error. */
export async function fetchQrImage(name: string): Promise<{ ok: true; bytes: ArrayBuffer; contentType: string } | { ok: false; error: string; status: number }> {
  const res = await fetch(`${env.wahaBaseUrl}/api/${encodeURIComponent(name)}/auth/qr?format=image`, {
    headers: { 'X-Api-Key': env.wahaApiKey, accept: 'image/png' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return { ok: false, error: (await res.text()).slice(0, 300), status: res.status };
  return { ok: true, bytes: await res.arrayBuffer(), contentType: res.headers.get('content-type') ?? 'image/png' };
}
