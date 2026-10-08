import { AlertTriangle, CheckCircle2, CircleSlash, XCircle } from 'lucide-react';
import { saveSendLimit } from '@/app/actions/data';
import { AnimatedBar } from '@/components/motion';
import { Card, EmptyState, fmt, KpiCard, Notice, PageHeader, Pill, Tip } from '@/components/ui';
import { dailyVolumes, UNKNOWN_SENDER, type VolumeRow } from '@/lib/metrics/sending';
import { formatDate } from '@/lib/time';

export const metadata = { title: 'Sending volume' };

function StatePill({ row }: { row: VolumeRow }) {
  if (row.state === 'over')
    return (
      <Pill tone="critical">
        <XCircle size={12} aria-hidden /> Over limit
      </Pill>
    );
  if (row.state === 'near')
    return (
      <Pill tone="warn">
        <AlertTriangle size={12} aria-hidden /> Near limit
      </Pill>
    );
  if (row.state === 'ok')
    return (
      <Pill tone="good">
        <CheckCircle2 size={12} aria-hidden /> Within limit
      </Pill>
    );
  return (
    <Pill>
      <CircleSlash size={12} aria-hidden /> No limit set
    </Pill>
  );
}

function Usage({ row }: { row: VolumeRow }) {
  if (!row.limit) return null;
  const pctUsed = Math.round((row.today.total / row.limit.dailyLimit) * 100);
  const bar = row.state === 'over' ? 'bg-critical' : row.state === 'near' ? 'bg-warn' : 'bg-brand';
  return (
    <div className="min-w-28">
      <AnimatedBar pct={pctUsed} className={bar} />
      <div className="mt-1 text-[11.5px] tabular text-ink-2">
        {fmt(row.today.total)} / {fmt(row.limit.dailyLimit)} ({pctUsed}%)
      </div>
    </div>
  );
}

function LimitForm({ row }: { row: VolumeRow }) {
  if (row.key === UNKNOWN_SENDER) return <span className="text-[11.5px] text-ink-3">Sender not recorded</span>;
  return (
    <form action={saveSendLimit} className="flex items-center gap-1">
      <input type="hidden" name="scope" value={row.scope} />
      <input type="hidden" name="key" value={row.key} />
      <label className="sr-only" htmlFor={`l-${row.scope}-${row.key}`}>
        Daily limit for {row.key}
      </label>
      <input
        id={`l-${row.scope}-${row.key}`}
        name="dailyLimit"
        type="number"
        min={0}
        max={100000}
        placeholder="None"
        defaultValue={row.limit?.dailyLimit ?? ''}
        className="field w-20 py-1 text-[12.5px]"
      />
      <label className="sr-only" htmlFor={`w-${row.scope}-${row.key}`}>
        Warn at percent
      </label>
      <input
        id={`w-${row.scope}-${row.key}`}
        name="warnPct"
        type="number"
        min={1}
        max={100}
        defaultValue={row.limit?.warnPct ?? 80}
        className="field w-14 py-1 text-[12.5px]"
        title="Warn at this % of the limit"
      />
      <span className="text-[11px] text-ink-3">%</span>
      <button className="btn btn-sm">Save</button>
    </form>
  );
}

function VolumeTable({ rows, days, label }: { rows: VolumeRow[]; days: string[]; label: string }) {
  const shown = days.slice(-7);
  return (
    // relative: keeps the absolutely positioned screen-reader labels inside the scroll area
    <div className="relative overflow-x-auto">
      <table className="table-compact w-full min-w-[980px]">
        <thead>
          <tr>
            <th>
              {label} <span className="font-normal normal-case tracking-normal text-ink-3">· last 7 days by date</span>
            </th>
            {shown.map((d, i) => (
              <th key={d} className="whitespace-nowrap text-right" title={formatDate(d)}>
                {i === shown.length - 1 ? 'Today' : Number(d.slice(8))}
              </th>
            ))}
            <th className="text-right">
              14 days <Tip text="Total over the last 14 days, including today." />
            </th>
            <th>Today vs limit</th>
            <th>
              Daily limit · warn at <Tip text="Leave empty (or 0) and save to remove the limit. Alerts fire at the warning level and when the limit is exceeded." />
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const byDay = r.days.slice(-7);
            return (
              <tr key={`${r.scope}:${r.key}`}>
                <td className="max-w-64">
                  <div className="truncate font-medium">{r.key}</div>
                  {r.scope === 'domain' && <div className="text-[11px] text-ink-3">{r.mailboxes} mailbox(es)</div>}
                </td>
                {byDay.map((d) => (
                  <td
                    key={d.day}
                    className={`text-right tabular ${d.total === 0 ? 'text-ink-3' : ''}`}
                    title={`${d.outreach} outreach${d.outreachDateOnly ? ` (${d.outreachDateOnly} dated from a sheet only)` : ''} + ${d.other} other sent mail`}
                  >
                    {fmt(d.total)}
                    {d.outreachDateOnly > 0 && <span className="text-ink-3">*</span>}
                  </td>
                ))}
                <td className="text-right tabular text-ink-2">{fmt(r.days.reduce((n, d) => n + d.total, 0))}</td>
                <td>
                  <div className="space-y-1">
                    <StatePill row={r} />
                    <Usage row={r} />
                  </div>
                </td>
                <td>
                  <LimitForm row={r} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default async function SendingPage() {
  const { mailboxes, domains, dayList } = await dailyVolumes(14);
  const all = [...domains, ...mailboxes];
  const todayTotal = domains.reduce((n, d) => n + d.today.total, 0);
  const todayOutreach = domains.reduce((n, d) => n + d.today.outreach, 0);
  const over = all.filter((r) => r.state === 'over').length;
  const near = all.filter((r) => r.state === 'near').length;
  const noLimit = mailboxes.filter((m) => !m.limit && m.key !== UNKNOWN_SENDER && m.days.some((d) => d.total > 0)).length;
  const busiest = mailboxes.filter((m) => m.key !== UNKNOWN_SENDER)[0];
  return (
    <>
      <PageHeader
        title="Sending volume"
        subtitle="Email sent per domain and per mailbox each day (local time), with the daily limits you set. The dashboard only watches volume; it never pauses sending."
      />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Sent today" value={fmt(todayTotal)} sub={`${fmt(todayOutreach)} outreach + ${fmt(todayTotal - todayOutreach)} other sent mail`} />
        <KpiCard label="Busiest mailbox today" value={busiest && busiest.today.total > 0 ? fmt(busiest.today.total) : '—'} sub={busiest && busiest.today.total > 0 ? busiest.key : 'Nothing sent yet today'} />
        <KpiCard label="Over limit" value={fmt(over)} tone={over ? 'critical' : 'default'} icon={<XCircle size={15} aria-hidden />} sub="Domains + mailboxes today" />
        <KpiCard
          label="Near limit"
          value={fmt(near)}
          tone={near ? 'warn' : 'default'}
          icon={<AlertTriangle size={15} aria-hidden />}
          sub={noLimit ? `${noLimit} active mailbox(es) have no limit` : 'Domains + mailboxes today'}
        />
      </div>
      <div className="mb-4">
        <Notice title="How the totals are counted">
          Daily total = outreach sends (deduplicated, from n8n runs, sheets and Sent folders) + other mail in the mailbox&rsquo;s Sent folders that is not an outreach send (manual
          replies, digests). Providers limit all outgoing mail, so both count. Sends with no known date are left out; <span className="text-ink">*</span> marks days that include sends
          dated from a sheet only. SMTP sends only appear when n8n or a sheet records them, because SMTP leaves no Sent-folder copy. WhatsApp is not included.
        </Notice>
      </div>
      <div className="space-y-4">
        <Card title="By domain" subtitle="All mailboxes on the domain together. A domain limit protects the domain's reputation." pad={false}>
          {domains.length ? <VolumeTable rows={domains} days={dayList} label="Domain" /> : <EmptyState title="No sending data yet" />}
        </Card>
        <Card title="By mailbox" pad={false}>
          {mailboxes.length ? <VolumeTable rows={mailboxes} days={dayList} label="Mailbox" /> : <EmptyState title="No sending data yet" />}
        </Card>
      </div>
    </>
  );
}
