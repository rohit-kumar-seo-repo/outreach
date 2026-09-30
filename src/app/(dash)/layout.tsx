import { Sidebar } from '@/components/Sidebar';
import { requireSession } from '@/lib/auth/session';
import { one } from '@/lib/db';
import { env } from '@/lib/env';
import { needsReplyCount } from '@/lib/metrics/inbox';
import { needsReplyCount as waNeedsReplyCount } from '@/lib/whatsapp/inbox';

export const dynamic = 'force-dynamic';

export default async function DashLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const [counts, needsReply, waNeedsReply] = await Promise.all([
    one<{ due: number; errors: number; alerts: number }>(
      `select
         (select count(*)::int from leads where status = 'followup_due') as due,
         (select count(*)::int from integration_errors where resolved_at is null and severity = 'error') as errors,
         (select count(*)::int from alerts where resolved_at is null and acknowledged_at is null) as alerts`,
    ),
    needsReplyCount(),
    waNeedsReplyCount(),
  ]);
  return (
    <div className="lg:flex lg:h-screen lg:overflow-hidden">
      <Sidebar
        email={session.email}
        attention={{ '/alerts': counts?.alerts ?? 0, '/inbox': needsReply, '/leads': counts?.due ?? 0, '/integrations': counts?.errors ?? 0, '/whatsapp': waNeedsReply }}
      />
      <div className="min-w-0 lg:flex lg:flex-1 lg:flex-col lg:overflow-y-auto">
        {env.previewMode && (
          <div className="sticky top-0 z-40 bg-amber-400 px-6 py-1.5 text-center text-[13px] font-semibold text-amber-950" role="status">
            PREVIEW — SAMPLE DATA for layout review. Nothing here is real.
          </div>
        )}
        {/* Pages marked data-fullbleed (the inbox) use the whole width and height. */}
        <main className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8 has-[[data-fullbleed]]:max-w-none has-[[data-fullbleed]]:p-0 lg:has-[[data-fullbleed]]:min-h-0 lg:has-[[data-fullbleed]]:flex-1">{children}</main>
      </div>
    </div>
  );
}
