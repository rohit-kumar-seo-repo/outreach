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
    <div className="flex min-h-screen items-center justify-center bg-navy-900 px-4">
      <div className="w-full max-w-sm">
        <Reveal className="mb-6 text-center">
          <div className="text-xl font-semibold text-white">Rohit Kumar SEO</div>
          <div className="text-sm text-navy-300">Outreach dashboard · private</div>
        </Reveal>
        <Reveal delay={0.08} className="rounded-xl bg-white p-6 shadow-xl">
          <LoginForm totp={!!env.totpSecret} />
        </Reveal>
        <Reveal delay={0.16}>
          <p className="mt-4 text-center text-xs text-navy-300">Access is restricted to the account owner. Every sign-in is logged.</p>
        </Reveal>
      </div>
    </div>
  );
}
