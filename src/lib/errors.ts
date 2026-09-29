import crypto from 'node:crypto';
import { q } from './db';

/**
 * Record an integration problem so it shows on the Integrations page instead of being
 * silently dropped. Repeats of the same (source, message) are folded into one open row.
 */
export async function recordIntegrationError(
  sourceKey: string,
  message: string,
  context: Record<string, unknown> = {},
  severity: 'warning' | 'error' = 'error',
): Promise<void> {
  const clean = redact(message).slice(0, 2000);
  const fingerprint = crypto.createHash('sha1').update(`${sourceKey}|${clean.replace(/\d+/g, '#')}`).digest('hex');
  await q(
    `insert into integration_errors (source_key, severity, message, context, fingerprint)
     values ($1,$2,$3,$4,$5)
     on conflict (fingerprint) where resolved_at is null
     do update set occurrences = integration_errors.occurrences + 1, last_seen_at = now(),
                   context = excluded.context, message = excluded.message`,
    [sourceKey, severity, clean, JSON.stringify(redactObject(context)), fingerprint],
  );
}

export async function resolveIntegrationErrors(sourceKey: string): Promise<void> {
  await q(`update integration_errors set resolved_at = now() where source_key = $1 and resolved_at is null`, [sourceKey]);
}

// Bearer tokens first, so "Authorization: Bearer <token>" loses the token itself.
const BEARER = /Bearer\s+[A-Za-z0-9._~+/=-]+/gi;
const KEY_VALUE = /(authorization|x-api-key|x-n8n-api-key|x-outreach-bridge-key|api[_-]?key|token|password|secret)(["'\s:=]+)([^\s"',}]+)/gi;

/** Strip anything that looks like a credential before it is stored or logged. */
export function redact(s: string): string {
  return s.replace(BEARER, 'Bearer [redacted]').replace(KEY_VALUE, (_m, key: string, sep: string, value: string) =>
    value === 'Bearer' || value === '[redacted]' ? `${key}${sep}${value}` : `${key}${sep}[redacted]`,
  );
}

function redactObject(o: unknown, depth = 0): unknown {
  if (depth > 4) return '[truncated]';
  if (typeof o === 'string') return redact(o).slice(0, 1000);
  if (Array.isArray(o)) return o.slice(0, 20).map((v) => redactObject(v, depth + 1));
  if (o && typeof o === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(o)) {
      out[k] = /key|token|secret|password|authorization/i.test(k) ? '[redacted]' : redactObject(v, depth + 1);
    }
    return out;
  }
  return o;
}
