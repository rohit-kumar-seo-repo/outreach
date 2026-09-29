import Link from 'next/link';
import { LEAD_STATUS, LeadStatus, OUTCOME, OutcomeBadge } from '@/components/status';
import { Card, EmptyState, fmt, PageHeader } from '@/components/ui';
import { campaignOptions } from '@/lib/metrics/campaigns';
import { listLeads, statusSummary } from '@/lib/metrics/leads';
import { formatDate, formatDateTime } from '@/lib/time';

export const metadata = { title: 'Leads & follow-ups' };

type SP = Record<string, string | undefined>;

function qs(sp: SP, patch: SP) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...sp, ...patch })) if (v) u.set(k, v);
  const s = u.toString();
  return s ? `/leads?${s}` : '/leads';
}

export default async function LeadsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const followup = sp.followup === 'due' || sp.followup === 'today' || sp.followup === 'overdue' ? sp.followup : null;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const [{ rows, total }, summary, campaigns] = await Promise.all([
    listLeads({ campaign: sp.campaign, status: sp.status, outcome: sp.outcome, search: sp.q, followup, page, pageSize: 50 }),
    statusSummary(),
    campaignOptions(),
  ]);
  const tabs = [
    { key: null, label: 'All leads' },
    { key: 'due', label: 'Follow-ups due (today + overdue)' },
    { key: 'today', label: 'Due today' },
    { key: 'overdue', label: 'Overdue' },
  ];
  return (
    <>
      <PageHeader
        title="Leads & follow-ups"
        subtitle="Every lead from every connected sheet, with its outreach history and next follow-up. Nothing here sends a message."
        actions={
          <a className="btn" href={`/api/export/leads${qs(sp, {}).replace('/leads', '')}`}>
            Export CSV
          </a>
        }
      />
      <div className="mb-3 flex flex-wrap gap-1.5">
        {tabs.map((t) => (
          <Link key={t.label} href={qs(sp, { followup: t.key ?? undefined, page: undefined })} className={`rounded-full px-3 py-1 text-[12.5px] ${followup === t.key ? 'bg-brand text-white' : 'bg-white text-ink-2 ring-1 ring-line hover:bg-slate-50'}`}>
            {t.label}
          </Link>
        ))}
      </div>
      <form method="get" className="card mb-4 flex flex-wrap items-end gap-2 px-3 py-3 text-[13px]">
        {followup && <input type="hidden" name="followup" value={followup} />}
        <select name="campaign" defaultValue={sp.campaign ?? ''} className="field" aria-label="Campaign">
          <option value="">All campaigns</option>
          {campaigns.map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.name}
            </option>
          ))}
        </select>
        <select name="status" defaultValue={sp.status ?? ''} className="field" aria-label="Status">
          <option value="">All statuses</option>
          {Object.entries(LEAD_STATUS).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label} ({fmt(summary[k] ?? 0)})
            </option>
          ))}
        </select>
        <select name="outcome" defaultValue={sp.outcome ?? ''} className="field" aria-label="Outcome">
          <option value="">Any outcome</option>
          <option value="any">Has an outcome</option>
          {Object.entries(OUTCOME).map(([k, v]) => (
            <option key={k} value={k}>
              {v.label}
            </option>
          ))}
        </select>
        <input name="q" defaultValue={sp.q ?? ''} placeholder="Search name, email, phone or row key" className="field min-w-64 flex-1" />
        <button className="btn btn-primary">Apply</button>
        <Link href="/leads" className="btn">
          Reset
        </Link>
      </form>
      <Card title={`${fmt(total)} lead${total === 1 ? '' : 's'}`} pad={false}>
        {rows.length === 0 ? (
          <EmptyState title={followup ? 'No follow-ups due' : 'No leads match'}>
            {followup ? 'Nothing is due for the selected filters.' : 'Leads appear here once the spreadsheets are synced through the n8n Data Bridge.'}
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-compact w-full min-w-[1100px]">
              <thead>
                <tr>
                  <th>Lead</th>
                  <th>Contact</th>
                  <th>Campaign · source</th>
                  <th>Status</th>
                  <th>Sheet status</th>
                  <th className="text-right">Sends</th>
                  <th>Last contacted</th>
                  <th>Latest reply</th>
                  <th>Next follow-up</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((l) => (
                  <tr key={l.id}>
                    <td className="max-w-56">
                      <Link href={`/leads/${l.id}`} className="link font-medium">
                        {l.name || l.email || l.phone || `Lead #${l.id}`}
                      </Link>
                    </td>
                    <td className="text-[12px] text-ink-2">
                      {l.email && <div>{l.email}</div>}
                      {l.phone && <div>{l.phone}</div>}
                      {l.waChatId && l.channel === 'whatsapp' && <div className="text-ink-3">WhatsApp {l.waChatId.replace('@c.us', '')}</div>}
                    </td>
                    <td className="text-[12px]">
                      <Link href={`/campaigns/${l.campaignSlug}`} className="link">
                        {l.campaignName}
                      </Link>
                      <div className="text-ink-3">
                        {l.sourceName}
                        {l.rowNumber ? ` · row ${l.rowNumber}` : ''}
                      </div>
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1">
                        <LeadStatus status={l.status} />
                        <OutcomeBadge outcome={l.outcome} />
                      </div>
                    </td>
                    <td className="max-w-48 truncate text-[12px] text-ink-2" title={l.sheetStatus ?? ''}>
                      {l.sheetStatus || '(blank)'}
                    </td>
                    <td className="text-right tabular">
                      {l.sendsAccepted}
                      {l.followupsAccepted > 0 && <span className="text-ink-3"> ({l.followupsAccepted} FU)</span>}
                    </td>
                    <td className="whitespace-nowrap text-[12px]">{l.lastContactedAt ? formatDate(l.lastContactedAt) : '—'}</td>
                    <td className="whitespace-nowrap text-[12px]">{l.lastReplyAt ? formatDateTime(l.lastReplyAt) : '—'}</td>
                    <td className="whitespace-nowrap text-[12px]">{l.nextFollowupAt ? formatDate(l.nextFollowupAt) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {total > 50 && (
          <div className="flex items-center justify-between border-t border-line px-4 py-2 text-xs text-ink-2">
            {page > 1 ? <Link className="link" href={qs(sp, { page: String(page - 1) })}>← Previous</Link> : <span />}
            <span>
              Page {page} of {Math.ceil(total / 50)}
            </span>
            {page * 50 < total ? <Link className="link" href={qs(sp, { page: String(page + 1) })}>Next →</Link> : <span />}
          </div>
        )}
      </Card>
    </>
  );
}
