import crypto from 'node:crypto';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { env } from '../env';
import { one, q } from '../db';

export const SESSION_COOKIE = 'rks_session';

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function createSession(email: string, ip: string | null, userAgent: string | null): Promise<string> {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + env.sessionTtlHours * 3600_000);
  await q('insert into sessions (id, user_email, expires_at, ip, user_agent) values ($1,$2,$3,$4,$5)', [
    hashToken(token),
    email,
    expires,
    ip,
    userAgent?.slice(0, 300) ?? null,
  ]);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: 'lax',
    path: '/',
    expires,
  });
  return token;
}

export interface SessionInfo {
  email: string;
  expiresAt: Date;
}

export async function getSession(): Promise<SessionInfo | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const row = await one<{ user_email: string; expires_at: Date }>(
    `update sessions set last_seen_at = now()
       where id = $1 and revoked_at is null and expires_at > now()
       returning user_email, expires_at`,
    [hashToken(token)],
  );
  // The session must also still belong to the configured admin (email change = logout everywhere).
  if (!row || row.user_email !== env.adminEmail) return null;
  return { email: row.user_email, expiresAt: row.expires_at };
}

/** Use at the top of every protected page / server action. */
export async function requireSession(): Promise<SessionInfo> {
  const s = await getSession();
  if (!s) redirect('/login');
  return s;
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await q('update sessions set revoked_at = now() where id = $1', [hashToken(token)]);
  jar.delete(SESSION_COOKIE);
}

export async function revokeAllSessions(): Promise<number> {
  const rows = await q<{ id: string }>('update sessions set revoked_at = now() where revoked_at is null returning id');
  return rows.length;
}

export async function clientInfo(): Promise<{ ip: string | null; userAgent: string | null }> {
  const h = await headers();
  // Behind Traefik/Caddy the real client IP is the first X-Forwarded-For entry.
  const xff = h.get('x-forwarded-for')?.split(',')[0]?.trim();
  return { ip: xff || h.get('x-real-ip') || null, userAgent: h.get('user-agent') };
}

/** Reject cross-site form posts (defence in depth on top of SameSite cookies). */
export async function assertSameOrigin(): Promise<void> {
  const h = await headers();
  const origin = h.get('origin');
  const host = h.get('x-forwarded-host') ?? h.get('host');
  if (origin && host && new URL(origin).host !== host) {
    throw new Error('Cross-origin request rejected');
  }
}
