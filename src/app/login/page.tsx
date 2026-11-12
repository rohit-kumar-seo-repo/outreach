import { redirect } from 'next/navigation';
import { Reveal } from '@/components/motion';
import { getSession } from '@/lib/auth/session';
import { env } from '@/lib/env';
import { LoginForm } from './LoginForm';

export const metadata = { title: 'Sign in' };
export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  if (await getSession()) redirect('/');
  return (
    <div className="flex min-h-screen items-center justify-center bg-[radial-gradient(1200px_600px_at_50%_-10%,#dbe6ff_0%,#f6f7f9_55%)] px-4 py-10">
      <div className="w-full max-w-sm">
        <Reveal className="mb-7 flex flex-col items-center text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-brand to-indigo-600 text-[20px] font-bold text-white shadow-lg shadow-indigo-600/25">RK</span>
          <h1 className="mt-4 text-[22px] font-bold tracking-tight text-ink">Outreach</h1>
          <p className="text-[13.5px] text-ink-3">Rohit Kumar SEO · private workspace</p>
        </Reveal>
        <Reveal delay={0.08} className="card p-6 shadow-[var(--shadow-pop)]">
          <LoginForm totp={!!env.totpSecret} />
        </Reveal>
        <Reveal delay={0.16}>
          <p className="mt-4 text-center text-[12px] text-ink-3">Access is restricted to the account owner. Every sign-in is logged.</p>
        </Reveal>
      </div>
    </div>
  );
}
