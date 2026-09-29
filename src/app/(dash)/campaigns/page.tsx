import Link from 'next/link';
import { CampaignStatus } from '@/components/status';
import { Card, EmptyState, fmt, Notice, PageHeader, RateCell, Tip } from '@/components/ui';
import { campaignStats } from '@/lib/metrics/campaigns';
import { addDays, formatDate, localDate } from '@/lib/time';

export const metadata = { title: 'Campaigns' };

const PERIODS = [
  { key: 'all', label: 'All time' },
  { key: '30', label: 'First contacted in last 30 days' },
  { key: '90', label: 'First contacted in last 90 days' },
];

export default async function CampaignsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const period = PERIODS.some((p) => p.key === sp.period) ? sp.period! : 'all';
  const today = localDate();
  const stats = await campaignStats(period === 'all' ? {} : { from: addDays(today, -(Number(period) - 1)), to: today });
  const email = stats.filter((s) => s.channel === 'email');
  const wa = stats.filter((s) => s.channel === 'whatsapp');
  const best = [...stats].filter((s) => s.contacted >= 10).sort((a, b) => b.repliedLeads / b.contacted - a.repliedLeads / a.contacted)[0];
  // Business results beat replies: rank by meetings booked, then wins, when any are recorded.
  const bestResults = [...stats].filter((s) => s.meetingLeads + s.wonLeads > 0).sort((a, b) => b.wonLeads - a.wonLeads || b.meetingLeads - a.meetingLeads)[0];
  const anyOutcomes = stats.some((s) => s.qualifiedLeads + s.meetingLeads + s.wonLeads + s.lostLeads > 0);
  const money = (c: (typeof stats)[number]) =>
    c.wonValue > 0 ? `${c.wonCurrencies.length === 1 ? `${c.wonCurrencies[0]} ` : ''}${Math.round(c.wonValue).toLocaleString('en-IN')}${c.wonCurrencies.length > 1 ? ' (mixed currencies)' : ''}` : null;

  const table = (rows: typeof stats) => (
    <div className="overflow-x-auto">
      <table className="table-compact w-full min-w-[1240px]">
        <thead>
          <tr>
            <th>Campaign</th>
            <th>Status</th>
            <th className="text-right">Loaded</th>
            <th className="text-right">Contacted</th>
            <th className="text-right">Remaining</th>
            <th className="text-right">Originals</th>
            <th className="text-right">Follow-ups</th>
            <th className="text-right">
              Reply rate <Tip text="Unique leads who replied ÷ unique leads contacted (at least one accepted send)." />
            </th>
            <th className="text-right">
              Positive rate <Tip text="Unique leads whose reply you marked Positive ÷ unique leads contacted. Only as complete as your reply classification." />
            </th>
            <th className="text-right">
              Meetings <Tip text="Contacted leads with an outcome of Meeting booked or Won ÷ unique leads contacted. Outcomes are recorded on the lead page." />
            </th>
            <th className="text-right">
              Won <Tip text="Contacted leads whose latest outcome is Won, with the total deal value recorded." />
            </th>
            <th className="text-right">
              Bounce rate <Tip text="Unique contacted leads with a bounce report ÷ unique leads contacted." />
            </th>
            <th className="text-right">Failed</th>
            <th>Last send</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.slug}>
              <td className="max-w-72">
                <Link href={`/campaigns/${c.slug}${period !== 'all' ? `?period=${period}` : ''}`} className="link font-medium">
                  {c.name}
                </Link>
                <div className="text-[11.5px] text-ink-3">{c.brand}</div>
              </td>
              <td>
                <CampaignStatus status={c.status} />
              </td>
              <td className="text-right tabular">{fmt(c.leadsLoaded)}</td>
              <td className="text-right tabular">{fmt(c.contacted)}</td>
              <td className="text-right tabular">{fmt(c.remaining)}</td>
              <td className="text-right tabular">{fmt(c.originalsSent)}</td>
              <td className="text-right tabular">{fmt(c.followupsSent)}</td>
              <td className="text-right">
                <RateCell num={c.repliedLeads} den={c.contacted} label="Replied leads ÷ contacted leads" />
              </td>
              <td className="text-right">
                <RateCell num={c.positiveLeads} den={c.contacted} label="Positive leads ÷ contacted leads" />
              </td>
              <td className="text-right">
                <RateCell num={c.meetingLeads} den={c.contacted} label="Meetings booked ÷ contacted leads" />
              </td>
              <td className="text-right tabular">
                {fmt(c.wonLeads)}
                {money(c) && <div className="text-[11px] text-ink-3">{money(c)}</div>}
              </td>
              <td className="text-right">
                <RateCell num={c.bouncedLeads} den={c.contacted} label="Bounced leads ÷ contacted leads" />
              </td>
              <td className="text-right tabular">{fmt(c.failedNeverAccepted)}</td>
              <td className="whitespace-nowrap text-ink-2">{c.lastSendAt ? formatDate(c.lastSendAt) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <>
      <PageHeader
        title="Campaigns"
        subtitle="Compare campaigns on meetings, wins and replies, never opens. Every rate uses the same denominator: unique leads contacted."
        actions={
          <div className="flex rounded-lg border border-line-strong bg-white p-0.5 text-xs">
            {PERIODS.map((p) => (
              <Link key={p.key} href={p.key === 'all' ? '/campaigns' : `/campaigns?period=${p.key}`} className={`rounded-md px-2.5 py-1.5 ${period === p.key ? 'bg-brand text-white' : 'text-ink-2 hover:bg-slate-50'}`}>
                {p.label}
              </Link>
            ))}
          </div>
        }
      />
      {period !== 'all' && (
        <div className="mb-4">
          <Notice>
            Cohort view: only leads whose first accepted send falls in the period are counted, and their replies at any time afterwards. Sends with no reliable date
            (sheet-status only) are excluded here but included in &ldquo;All time&rdquo;.
          </Notice>
        </div>
      )}
      {bestResults ? (
        <div className="mb-4">
          <Notice tone="good" title="Best business results so far">
            {bestResults.name}: {bestResults.wonLeads} won, {bestResults.meetingLeads} meeting(s) booked from {bestResults.contacted} contacted leads.
            {best && best.slug !== bestResults.slug ? ` Highest reply rate: ${best.name} (${best.repliedLeads} of ${best.contacted}).` : ''}
          </Notice>
        </div>
      ) : (
        best && (
          <div className="mb-4">
            <Notice tone="good" title="Highest reply rate (campaigns with ≥ 10 contacted leads)">
              {best.name}: {best.repliedLeads} of {best.contacted} contacted leads replied.
            </Notice>
          </div>
        )
      )}
      {!anyOutcomes && (
        <div className="mb-4">
          <Notice title="Add business results">
            Replies show interest, not business. Record Qualified lead, Meeting booked, Won or Lost on a lead&rsquo;s page, and campaigns are compared on meetings and wins
            here.
          </Notice>
        </div>
      )}
      <div className="space-y-5">
        <Card title="Email campaigns" subtitle="Open tracking is not used; opens are not a success signal." pad={false}>
          {email.length ? table(email) : <EmptyState title="No email campaigns configured" />}
        </Card>
        <Card title="WhatsApp campaigns" subtitle="Replies are inbound WhatsApp messages from the contacted number after the first outreach message." pad={false}>
          {wa.length ? table(wa) : <EmptyState title="No WhatsApp campaigns configured" />}
        </Card>
      </div>
    </>
  );
}
