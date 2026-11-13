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
    <div className="hero flex min-h-screen items-center justify-center !rounded-none px-4 py-10">
      <span className="hero-blob left-[8%] top-[10%] h-64 w-64 bg-indigo-500" aria-hidden />
      <span className="hero-blob bottom-[8%] right-[6%] h-56 w-56 bg-fuchsia-500 [animation-delay:-8s]" aria-hidden />
      <div className="w-full max-w-sm">
        <Reveal className="mb-7 flex flex-col items-center text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 via-violet-500 to-fuchsia-500 text-[20px] font-bold text-white shadow-[0_12px_30px_-10px_rgba(168,85,247,0.9)] ring-1 ring-white/25">RK</span>
          <h1 className="mt-4 text-[24px] font-bold tracking-tight text-white">
            <span className="text-aurora">Outreach</span>
          </h1>
          <p className="text-[13.5px] text-indigo-100/75">Rohit Kumar SEO · private workspace</p>
        </Reveal>
        <Reveal delay={0.08} className="card p-6 text-ink shadow-[var(--shadow-pop)]">
          <LoginForm totp={!!env.totpSecret} />
        </Reveal>
        <Reveal delay={0.16}>
          <p className="mt-4 text-center text-[12px] text-indigo-100/60">Access is restricted to the account owner. Every sign-in is logged.</p>
        </Reveal>
      </div>
    </div>
  );
}
