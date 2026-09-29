import Link from 'next/link';
import { CheckCircle2, CircleHelp, CircleDashed } from 'lucide-react';
import { Card, fmt, PageHeader, Pill } from '@/components/ui';
import { coverageGrid, sourceCoverage, type CoverageCell, type CoverageStatus } from '@/lib/metrics/coverage';
import { formatDate, formatDateTime, relativeTime } from '@/lib/time';

export const metadata = { title: 'Data coverage' };

const STATUS: Record<CoverageStatus, { label: string; cell: string; mark: (c: CoverageCell) => string; help: string }> = {
  complete: {
    label: 'Complete',
    cell: 'bg-good-50 text-good-text border-emerald-200',
    mark: (c) => (c.sends ? String(c.sends) : '0'),
    help: 'Every send that day is recorded with its time.',
  },
  approximate: {
    label: 'Approximate',
    cell: 'bg-warn-50 text-warn border-amber-200',
    mark: (c) => `~${c.sends}`,
    help: 'Known only from sheet records; later edits to the sheet can hide sends.',
  },
  unknown: {
    label: 'Unknown',
    cell: 'cov-unknown text-ink-3 border-line',
    mark: () => '?',
    help: 'No source covers this day; a blank does not mean nothing was sent.',
  },
};

function describe(name: string, c: CoverageCell): string {
  const s = STATUS[c.status];
  const via = c.via === 'n8n' ? 'n8n execution history' : c.via === 'mailbox' ? 'Sent folders' : c.via === 'sheet' ? 'sheet records' : 'no source';
  const sends = c.status === 'unknown' ? '' : ` — ${c.sends} send(s)${c.dateOnly ? `, ${c.dateOnly} dated from a sheet only` : ''}`;
  return `${name}, ${formatDate(c.day)}: ${s.label}${sends} (${via})`;
}

export default async function CoveragePage() {
  const [{ dayList, campaigns }, src] = await Promise.all([coverageGrid(45), sourceCoverage()]);
  const monthStarts = new Set(dayList.filter((d, i) => i === 0 || d.endsWith('-01')));
  return (
    <>
      <PageHeader
        title="Data coverage"
        subtitle="How trustworthy each day's numbers are: which dates are complete, which are approximate, and which are unknown."
      />

      <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Card title="n8n execution history">
          <dl className="space-y-1 text-[13px]">
            <div className="flex justify-between gap-2">
              <dt className="text-ink-3">Runs imported</dt>
              <dd className="tabular">{fmt(src.n8n.executions)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-ink-3">Covers from</dt>
              <dd>{src.n8n.earliest ? formatDateTime(src.n8n.earliest) : '—'}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-ink-3">Last sync</dt>
              <dd>{src.n8n.lastSuccess ? relativeTime(src.n8n.lastSuccess) : 'never'}</dd>
            </div>
          </dl>
          <p className="mt-2 text-[11.5px] text-ink-3">
            n8n keeps about 6 days of runs, so exact history starts shortly before the first sync and is kept permanently from then on.
            {!src.n8n.healthy && src.n8n.lastSuccess ? ' The sync is failing: days after the last success are not complete.' : ''}
          </p>
        </Card>
        <Card title="Spreadsheets">
          <dl className="space-y-1 text-[13px]">
            <div className="flex justify-between gap-2">
              <dt className="text-ink-3">Sources syncing</dt>
              <dd className="tabular">
                {src.sheets.ok} of {src.sheets.sources}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-ink-3">Rows imported</dt>
              <dd className="tabular">{fmt(src.sheets.rows)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-ink-3">Sends from sheet status</dt>
              <dd className="tabular">{fmt(src.sheets.exact + src.sheets.dateOnly + src.sheets.undated)}</dd>
            </div>
          </dl>
          <p className="mt-2 text-[11.5px] text-ink-3">
            {fmt(src.sheets.exact)} with a timestamp · {fmt(src.sheets.dateOnly)} with a date only · {fmt(src.sheets.undated)} with no date.
          </p>
        </Card>
        <Card title="Mailboxes">
          <dl className="space-y-1 text-[13px]">
            <div className="flex justify-between gap-2">
              <dt className="text-ink-3">Syncing</dt>
              <dd className="tabular">
                {src.mailboxes.connected} of {src.mailboxes.total}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-ink-3">Messages imported</dt>
              <dd className="tabular">{fmt(src.mailboxes.messages)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-ink-3">Oldest message</dt>
              <dd>{src.mailboxes.earliest ? formatDate(src.mailboxes.earliest) : '—'}</dd>
            </div>
          </dl>
          <p className="mt-2 text-[11.5px] text-ink-3">Headers from Inbox, Sent and Junk over the initial sync window, then everything new.</p>
        </Card>
        <Card title="WhatsApp">
          <dl className="space-y-1 text-[13px]">
            <div className="flex justify-between gap-2">
              <dt className="text-ink-3">Messages imported</dt>
              <dd className="tabular">{fmt(src.whatsapp.messages)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-ink-3">Oldest message</dt>
              <dd>{src.whatsapp.earliest ? formatDate(src.whatsapp.earliest) : '—'}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-ink-3">Last sync</dt>
              <dd>{src.whatsapp.lastSuccess ? relativeTime(src.whatsapp.lastSuccess) : 'never'}</dd>
            </div>
          </dl>
          <p className="mt-2 text-[11.5px] text-ink-3">Chat history of contacted numbers, read from WAHA.</p>
        </Card>
      </div>

      <Card
        title="Coverage by campaign, last 45 days"
        subtitle="Each cell is one day. The number is sends recorded that day."
        actions={
          <ul className="flex flex-wrap gap-2 text-[11.5px]" aria-label="Legend">
            <li>
              <Pill tone="good">
                <CheckCircle2 size={12} aria-hidden /> Complete
              </Pill>
            </li>
            <li>
              <Pill tone="warn">
                <CircleDashed size={12} aria-hidden /> ~ Approximate
              </Pill>
            </li>
            <li>
              <Pill>
                <CircleHelp size={12} aria-hidden /> ? Unknown
              </Pill>
            </li>
          </ul>
        }
        pad={false}
      >
        {/* rtl scroller + ltr table: the view opens scrolled to the most recent days on narrow screens */}
        <div className="overflow-x-auto py-4 pr-4 [direction:rtl]">
          <table className="border-separate border-spacing-[2px] text-[10px] [direction:ltr]" aria-describedby="cov-help">
            <thead>
              <tr>
                <th scope="col" className="sticky left-0 z-10 bg-white pl-4 pr-2 text-left text-[11.5px] font-medium text-ink-2 shadow-[3px_0_0_0_#fff]">
                  Campaign
                </th>
                {dayList.map((d) => (
                  <th key={d} scope="col" className="w-[26px] min-w-[26px] text-center font-normal text-ink-3" title={formatDate(d)}>
                    {monthStarts.has(d) ? (
                      <span className="block text-[9.5px] font-medium text-ink-2">{new Date(`${d}T12:00:00Z`).toLocaleString('en-IN', { month: 'short', timeZone: 'UTC' })}</span>
                    ) : (
                      <span className="block">&nbsp;</span>
                    )}
                    {Number(d.slice(8))}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.slug}>
                  <th scope="row" className="sticky left-0 z-10 max-w-56 truncate bg-white pl-4 pr-2 text-left text-[12px] font-medium text-ink shadow-[3px_0_0_0_#fff]">
                    <Link href={`/campaigns/${c.slug}`} className="hover:underline" title={c.name}>
                      {c.name}
                    </Link>
                  </th>
                  {c.cells.map((cell) => {
                    const s = STATUS[cell.status];
                    const label = describe(c.name, cell);
                    return (
                      <td key={cell.day} className={`h-[22px] w-[26px] rounded-[3px] border text-center tabular ${s.cell}`} title={label} aria-label={label}>
                        {s.mark(cell)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <ul id="cov-help" className="mt-3 space-y-1 pl-4 text-[12px] text-ink-2 [direction:ltr]">
            {(Object.keys(STATUS) as CoverageStatus[]).map((k) => (
              <li key={k}>
                <b className="text-ink">{STATUS[k].label}</b>: {STATUS[k].help}
              </li>
            ))}
          </ul>
        </div>
      </Card>

      <Card title="Summary by campaign" className="mt-4" pad={false}>
        <div className="overflow-x-auto">
          <table className="table-compact w-full min-w-[900px]">
            <thead>
              <tr>
                <th>Campaign</th>
                <th>Complete from</th>
                <th className="text-right">Complete days</th>
                <th className="text-right">Approximate days</th>
                <th className="text-right">Unknown days</th>
                <th className="text-right">Undated sends</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.slug}>
                  <td className="font-medium">{c.name}</td>
                  <td>
                    {c.completeFrom ? (
                      <>
                        {formatDate(c.completeFrom)}
                        <div className="text-[11px] text-ink-3">{c.completeVia}</div>
                      </>
                    ) : (
                      <span className="text-ink-3">Not yet: no n8n history or Sent-folder sync covers this campaign</span>
                    )}
                  </td>
                  <td className="text-right tabular">{c.counts.complete}</td>
                  <td className="text-right tabular">{c.counts.approximate}</td>
                  <td className="text-right tabular">{c.counts.unknown}</td>
                  <td className="text-right tabular" title="Sends recorded without any date (e.g. a sheet status with no date column). Counted in totals, never in daily numbers.">
                    {fmt(c.undated)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
