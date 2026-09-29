import { Sidebar } from '@/components/Sidebar';
import { requireSession } from '@/lib/auth/session';
import { one } from '@/lib/db';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';

export default async function DashLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const counts = await one<{ unmatched: number; due: number; errors: number }>(
    `select
       (select count(distinct thread_key)::int from mail_messages where direction = 'inbound' and kind = 'message' and lead_id is null
          and coalesce(match_method, '') <> 'manual_none' and sent_at > now() - interval '30 days' and folder !~* '(spam|junk|trash)') as unmatched,
       (select count(*)::int from leads where status = 'followup_due') as due,
       (select count(*)::int from integration_errors where resolved_at is null and severity = 'error') as errors`,
  );
  return (
    <div className="lg:flex lg:h-screen lg:overflow-hidden">
      <Sidebar email={session.email} attention={{ '/inbox': counts?.unmatched ?? 0, '/leads': counts?.due ?? 0, '/integrations': counts?.errors ?? 0 }} />
      <div className="min-w-0 lg:flex lg:flex-1 lg:flex-col lg:overflow-y-auto">
        {env.previewMode && (
          <div className="sticky top-0 z-40 bg-amber-400 px-6 py-1.5 text-center text-[13px] font-semibold text-amber-950" role="status">
            PREVIEW — SAMPLE DATA for layout review. Nothing here is real.
          </div>
        )}
        <main className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
