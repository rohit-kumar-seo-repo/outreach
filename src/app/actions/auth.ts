'use server';

import { redirect } from 'next/navigation';
import { verifyPassword } from '@/lib/auth/password';
import { loginBlocked, recordLoginAttempt } from '@/lib/auth/ratelimit';
import { assertSameOrigin, clientInfo, createSession, destroySession, getSession } from '@/lib/auth/session';
import { verifyTotp } from '@/lib/auth/totp';
import { q } from '@/lib/db';
import { env } from '@/lib/env';

export interface LoginState {
  error: string | null;
}

// A valid scrypt hash of a random value, used so failed logins take the same time as real checks.
const DUMMY_HASH = 'scrypt:32768:8:1:AAAAAAAAAAAAAAAAAAAAAA:uSp1dLyhS3lJd7dAKQ7B9pGhBjzRRAmRZ4Mb0zO4h1xWb7KqS7c1Yh0vM9rPp8xk6o7m7g2O5l0l4d8b3p2Q3A';

export async function login(_prev: LoginState, form: FormData): Promise<LoginState> {
  await assertSameOrigin();
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  const password = String(form.get('password') ?? '');
  const code = String(form.get('code') ?? '');
  if (!env.adminEmail || !env.adminPasswordHash) {
    return { error: 'Login is not configured on the server yet (ADMIN_EMAIL and ADMIN_PASSWORD_HASH are missing).' };
  }
  const { ip, userAgent } = await clientInfo();
  if (await loginBlocked(ip, email)) {
    return { error: 'Too many failed attempts. Wait 15 minutes and try again.' };
  }
  const emailOk = email === env.adminEmail;
  const passOk = await verifyPassword(password, emailOk ? env.adminPasswordHash : DUMMY_HASH).catch(() => false);
  const codeOk = !env.totpSecret || verifyTotp(env.totpSecret, code);
  const ok = emailOk && passOk && codeOk;
  await recordLoginAttempt(ip, email, ok);
  if (!ok) {
    await new Promise((r) => setTimeout(r, 400 + Math.random() * 400));
    return { error: env.totpSecret ? 'Incorrect email, password or authenticator code.' : 'Incorrect email or password.' };
  }
  await createSession(email, ip, userAgent);
  await q(`insert into audit_log (actor, action, detail) values ($1, 'login', $2)`, [email, JSON.stringify({ ip })]);
  redirect('/');
}

export async function logout(): Promise<void> {
  await assertSameOrigin();
  const s = await getSession();
  await destroySession();
  if (s) await q(`insert into audit_log (actor, action) values ($1, 'logout')`, [s.email]);
  redirect('/login');
}
