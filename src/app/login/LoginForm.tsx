'use client';

import { useActionState } from 'react';
import { login, type LoginState } from '@/app/actions/auth';

export function LoginForm({ totp }: { totp: boolean }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(login, { error: null });
  return (
    <form action={action} className="space-y-4">
      <label className="block text-sm font-medium text-ink">
        Email
        <input name="email" type="email" autoComplete="username" required className="field mt-1 w-full" />
      </label>
      <label className="block text-sm font-medium text-ink">
        Password
        <input name="password" type="password" autoComplete="current-password" required className="field mt-1 w-full" />
      </label>
      {totp && (
        <label className="block text-sm font-medium text-ink">
          Authenticator code
          <input name="code" inputMode="numeric" pattern="[0-9 ]{6,7}" autoComplete="one-time-code" required className="field mt-1 w-full tracking-widest" />
        </label>
      )}
      {state.error && (
        <p className="rounded-md bg-critical-50 px-3 py-2 text-sm text-critical" role="alert">
          {state.error}
        </p>
      )}
      <button type="submit" className="btn btn-primary w-full justify-center" disabled={pending}>
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
