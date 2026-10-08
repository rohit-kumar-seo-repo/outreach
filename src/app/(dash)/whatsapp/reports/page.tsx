import { AnimatedSegments } from '@/components/motion';
import { Card, EmptyState, fmt, Notice, PageHeader } from '@/components/ui';
import { campaignOptions } from '@/lib/metrics/campaigns';
import { waReport, waSessions } from '@/lib/metrics/whatsapp';
import { addDays, formatShortDay, localDate } from '@/lib/time';

export const metadata = { title: 'WhatsApp reports' };

export default async function WaReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const today = localDate();
  const from = sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? sp.from : addDays(today, -29);
  const to = sp.to && /^\d{4}-\d{2}-\d{2}$/.test(sp.to) ? sp.to : today;
  const campaign = sp.campaign || null;
  const session = sp.account || null;
  const [report, campaigns, sessions] = await Promise.all([
    waReport({ campaign, session, from, to }),
    campaignOptions().then((r) => r.filter((c) => c.channel === 'whatsapp')),
    waSessions(),
  ]);
  const maxDay = Math.max(1, ...report.daily.map((d) => Math.max(d.accepted, d.failed, d.replies)));
  const confirmedAck = report.ackBreakdown.filter((a) => a.ack > 0).reduce((n, a) => n + a.n, 0);
  const pendingAck = report.ackBreakdown.find((a) => a.ack === 0)?.n ?? 0;

  return (
    <>
      <PageHeader title="Reports" subtitle="Filtered by campaign, account and date. Every count here is a real recorded event." />

      <form className="card mb-4 flex flex-wrap items-end gap-3 px-4 py-3" method="get">
        <label className="flex flex-col gap-1 text-[11px] font-medium uppercase tracking-wide text-ink-3">
          Campaign
          <select name="campaign" defaultValue={campaign ?? ''} className="field">
            <option value="">All campaigns</option>
            {campaigns.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[11px] font-medium uppercase tracking-wide text-ink-3">
          Account
          <select name="account" defaultValue={session ?? ''} className="field">
            <option value="">All accounts</option>
            {sessions.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[11px] font-medium uppercase tracking-wide text-ink-3">
          From
          <input type="date" name="from" defaultValue={from} max={today} className="field" />
        </label>
        <label className="flex flex-col gap-1 text-[11px] font-medium uppercase tracking-wide text-ink-3">
          To
          <input type="date" name="to" defaultValue={to} max={today} className="field" />
        </label>
        <button type="submit" className="btn btn-primary">
          Apply
        </button>
      </form>

      {report.warnings.length > 0 && (
        <div className="mb-4 space-y-2">
          {report.warnings.map((w, i) => (
            <Notice key={i} tone={w.level === 'critical' ? 'critical' : 'warn'}>
              {w.text}
            </Notice>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="card p-3">
          <div className="text-xs text-ink-2">Accepted</div>
          <div className="mt-1 text-xl font-semibold tabular">{fmt(report.totals.accepted)}</div>
        </div>
        <div className="card p-3">
          <div className="text-xs text-ink-2">Failed</div>
          <div className="mt-1 text-xl font-semibold tabular">{fmt(report.totals.failed)}</div>
        </div>
        <div className="card p-3">
          <div className="text-xs text-ink-2">Human replies</div>
          <div className="mt-1 text-xl font-semibold tabular">{fmt(report.totals.replies)}</div>
        </div>
        <div className="card p-3">
          <div className="text-xs text-ink-2">Opted out</div>
          <div className="mt-1 text-xl font-semibold tabular">{fmt(report.totals.optedOut)}</div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Daily volume" subtitle="Accepted, failed and human replies per day." pad={false}>
          {report.daily.every((d) => d.accepted + d.failed + d.replies === 0) ? (
            <EmptyState title="No activity in this range" />
          ) : (
            <div className="max-h-[360px] overflow-y-auto p-4">
              <ul className="space-y-1.5">
                {report.daily.map((d) => (
                  <li key={d.day} className="flex items-center gap-2 text-[11.5px]">
                    <span className="w-16 shrink-0 text-ink-3">{formatShortDay(d.day)}</span>
                    <span className="h-4 flex-1">
                      <AnimatedSegments
                        className="h-full bg-slate-100"
                        segments={[
                          { pct: (d.accepted / maxDay) * 100, className: 'bg-brand', title: `${d.accepted} accepted` },
                          { pct: (d.failed / maxDay) * 100, className: 'bg-critical', title: `${d.failed} failed` },
                          { pct: (d.replies / maxDay) * 100, className: 'bg-good', title: `${d.replies} replies` },
                        ]}
                      />
                    </span>
                    <span className="w-24 shrink-0 tabular text-ink-2">
                      {d.accepted}/{d.failed}/{d.replies}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] text-ink-3">
                <span className="mr-3">
                  <span className="mr-1 inline-block h-2 w-2 rounded-sm bg-brand" />
                  Accepted
                </span>
                <span className="mr-3">
                  <span className="mr-1 inline-block h-2 w-2 rounded-sm bg-critical" />
                  Failed
                </span>
                <span>
                  <span className="mr-1 inline-block h-2 w-2 rounded-sm bg-good" />
                  Replies
                </span>
              </p>
            </div>
          )}
        </Card>

        <Card title="Delivered / read status" subtitle="Only counted when WAHA actually reports it — nothing here is estimated.">
          {report.ackBreakdown.length === 0 ? (
            <EmptyState title="No status data yet" />
          ) : (
            <>
              <ul className="space-y-1.5 text-[13px]">
                {report.ackBreakdown.map((a) => (
                  <li key={a.ack} className="flex items-center justify-between">
                    <span>{a.label}</span>
                    <span className="tabular font-medium">{fmt(a.n)}</span>
                  </li>
                ))}
              </ul>
              {pendingAck > 0 && confirmedAck === 0 && (
                <p className="mt-3 text-[12px] text-ink-3">
                  Every outbound message in this range is still "Pending" per WAHA — it has not reported delivered/read status for any of them yet. This is what WAHA returns,
                  not a dashboard limitation; delivered/read will show here the moment it does.
                </p>
              )}
            </>
          )}
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Response time" subtitle="Time from first accepted send to a lead's first human reply.">
          {report.responseTimeHours.sampleSize === 0 ? (
            <EmptyState title="No replies with a known send time yet" />
          ) : (
            <div className="text-[13px]">
              <div className="text-2xl font-semibold tabular">
                {report.responseTimeHours.median !== null ? `${report.responseTimeHours.median.toFixed(1)}h` : '—'}
              </div>
              <div className="text-ink-2">Median, from {fmt(report.responseTimeHours.sampleSize)} replied lead(s).</div>
            </div>
          )}
        </Card>
        <Card title="Business outcomes" subtitle="Recorded on lead pages; not inferred from replies.">
          <dl className="grid grid-cols-2 gap-y-1.5 text-[13px]">
            <dt>Qualified</dt>
            <dd className="text-right tabular">{fmt(report.outcomes.qualified)}</dd>
            <dt>Meeting booked</dt>
            <dd className="text-right tabular">{fmt(report.outcomes.meeting)}</dd>
            <dt>Won</dt>
            <dd className="text-right tabular">{fmt(report.outcomes.won)}</dd>
            <dt>Lost</dt>
            <dd className="text-right tabular">{fmt(report.outcomes.lost)}</dd>
          </dl>
        </Card>
      </div>

      <div className="mt-4">
        <Notice>
          Scaling advice is advisory only: nothing on this page raises a daily limit, changes a schedule, or starts a campaign automatically. Daily limits shown across
          WhatsApp are settings you configured here, not a rule WhatsApp itself publishes or enforces.
        </Notice>
      </div>
    </>
  );
}
