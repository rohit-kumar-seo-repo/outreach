import { BottomNav, Sidebar } from '@/components/Sidebar';
import { PageTransition } from '@/components/motion';
import { requireSession } from '@/lib/auth/session';
import { attentionSql } from '@/lib/crm/attention';
import { one } from '@/lib/db';
import { env } from '@/lib/env';
import { needsReplyCount } from '@/lib/metrics/inbox';
import { needsReplyCount as waNeedsReplyCount } from '@/lib/whatsapp/inbox';

export const dynamic = 'force-dynamic';

export default async function DashLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const [counts, needsReply, waNeedsReply] = await Promise.all([
    one<{ needsYou: number; errors: number; alerts: number }>(
      `select
         (select count(*)::int from leads l where (l.last_reply_at is not null or l.manual_followup_at is not null) and ${attentionSql()} in ('reply', 'due')) as "needsYou",
         (select count(*)::int from integration_errors where resolved_at is null and severity = 'error') as errors,
         (select count(*)::int from alerts where resolved_at is null and acknowledged_at is null) as alerts`,
    ),
    needsReplyCount(),
    waNeedsReplyCount(),
  ]);
  const attention = {
    // Today carries the one number that matters: people waiting on you plus reminders due.
    '/': counts?.needsYou ?? 0,
    '/alerts': counts?.alerts ?? 0,
    '/inbox': needsReply,
    '/integrations': counts?.errors ?? 0,
    '/whatsapp': waNeedsReply,
  };
  return (
    <div className="lg:flex lg:h-screen lg:overflow-hidden">
      <Sidebar email={session.email} attention={attention} />
      <div className="min-w-0 lg:flex lg:flex-1 lg:flex-col lg:overflow-y-auto">
        {env.previewMode && (
          <div className="sticky top-0 z-30 bg-amber-300 px-4 py-1 text-center text-[12px] font-semibold text-amber-950" role="status">
            Preview: sample data only
          </div>
        )}
        {/* Pages marked data-fullbleed (the inboxes) use the whole width and height. */}
        <main className="mx-auto w-full max-w-[1320px] px-4 pb-28 pt-5 sm:px-6 lg:px-8 lg:pb-10 lg:pt-7 has-[[data-fullbleed]]:max-w-none has-[[data-fullbleed]]:p-0 has-[[data-fullbleed]]:pb-20 lg:has-[[data-fullbleed]]:min-h-0 lg:has-[[data-fullbleed]]:flex-1 lg:has-[[data-fullbleed]]:pb-0">
          <PageTransition>{children}</PageTransition>
        </main>
      </div>
      <BottomNav attention={attention} />
    </div>
  );
}
