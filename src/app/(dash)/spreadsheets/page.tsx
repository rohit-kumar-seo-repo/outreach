import { Card, EmptyState, fmt, Notice, PageHeader, Pill, Tip } from '@/components/ui';
import { capacity } from '@/lib/metrics/capacity';
import { registry } from '@/lib/registry';
import { formatDateTime } from '@/lib/time';

export const metadata = { title: 'Spreadsheets' };

export default async function SpreadsheetsPage() {
  const rows = await capacity();
  const reg = registry();
  return (
    <>
      <PageHeader title="Spreadsheet capacity" subtitle="How many usable leads each connected sheet has left, using each sheet's real columns and status values." />
      <div className="mb-4">
        <Notice title="How “remaining” is calculated">
          Remaining = rows currently in the sheet that have <b>never been contacted</b> and are still usable: <i>Ready</i> + <i>Queued</i> + <i>Awaiting approval</i> +{' '}
          <i>Needs draft</i> + <i>Failed (never accepted)</i>. Duplicates, invalid addresses, excluded rows and unsubscribed / bounced contacts are not remaining. A lead only
          counts as <b>contacted</b> when an accepted send event is linked to it; the split shows whether that event was verified (n8n execution, push event or Sent-folder copy)
          or is known only from the sheet&apos;s own status column.
        </Notice>
      </div>
      {rows.length === 0 ? (
        <Card>
          <EmptyState title="No spreadsheets connected">Connect the n8n Data Bridge on the Integrations page to load the sheets.</EmptyState>
        </Card>
      ) : (
        <div className="space-y-4">
          {rows.map((r) => {
            const def = reg.sources.find((s) => s.key === r.key);
            const expected = def ? [def.columns.status, ...(def.columns.email ?? []).slice(0, 1), ...(def.columns.phone ?? []).slice(0, 1)] : [];
            const missing = r.columns ? expected.filter((c) => !r.columns!.includes(c)) : [];
            return (
              <Card
                key={r.key}
                title={
                  r.url ? (
                    <a href={r.url} target="_blank" rel="noopener noreferrer" className="link">
                      {r.name}
                    </a>
                  ) : (
                    r.name
                  )
                }
                subtitle={`${r.campaigns.join(', ') || 'No campaign yet'} · ${r.lastSuccessAt ? `synced ${formatDateTime(r.lastSuccessAt)}` : 'not synced yet'}`}
                actions={r.lastError ? <Pill tone="critical">Sync error</Pill> : r.lastSuccessAt ? <Pill tone="good">Synced</Pill> : <Pill>Not synced</Pill>}
              >
                {r.lastError && <p className="mb-3 text-[12.5px] text-critical">{r.lastError}</p>}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
                  {[
                    ['Total rows', r.totalRows, 'Rows currently present in the sheet.'],
                    ['Remaining', r.remaining, 'Uncontacted and usable (see the definition above).'],
                    ['Queued', r.queued, 'Approved with a send date/time.'],
                    ['Contacted', r.contacted, 'Accepted send event linked to the lead.'],
                    ['Duplicates', r.duplicates, 'Same address earlier in the same campaign.'],
                    ['Invalid', r.invalid, 'No valid email address / WhatsApp number.'],
                    ['Excluded / opted out', r.excluded + r.optedOut, 'Excluded by sheet status, or on the suppression list.'],
                    ['Bounced', r.bounced, 'A bounce report matched the address.'],
                  ].map(([label, v, tip]) => (
                    <div key={String(label)} className="rounded-lg bg-slate-50 px-3 py-2">
                      <div className="flex items-center gap-1 text-[11.5px] text-ink-2">
                        {label} <Tip text={String(tip)} />
                      </div>
                      <div className="text-lg font-semibold tabular">{fmt(Number(v))}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-3 grid grid-cols-1 gap-4 text-[12.5px] lg:grid-cols-3">
                  <div>
                    <div className="mb-1 font-medium text-ink">Remaining breakdown</div>
                    <ul className="space-y-0.5 text-ink-2">
                      <li>Ready: {fmt(r.ready)}</li>
                      <li>Queued: {fmt(r.queued)}</li>
                      <li>Awaiting approval: {fmt(r.awaitingApproval)}</li>
                      <li>Needs draft: {fmt(r.needsDraft)}</li>
                      <li>Failed, never accepted: {fmt(r.failed)}</li>
                    </ul>
                  </div>
                  <div>
                    <div className="mb-1 font-medium text-ink">Contacted — evidence</div>
                    <ul className="space-y-0.5 text-ink-2">
                      <li>Verified send event: {fmt(r.contactedVerified)}</li>
                      <li>Sheet status only: {fmt(r.contactedSheetOnly)}</li>
                      <li>Rows removed from sheet (history kept): {fmt(r.removedFromSheet)}</li>
                    </ul>
                  </div>
                  <div>
                    <div className="mb-1 font-medium text-ink">Status values in the sheet (top 15)</div>
                    <ul className="flex flex-wrap gap-1">
                      {r.statusValues.map((s) => (
                        <li key={s.value}>
                          <Pill>
                            {s.value} · {s.n}
                          </Pill>
                        </li>
                      ))}
                      {r.statusValues.length === 0 && <li className="text-ink-3">—</li>}
                    </ul>
                  </div>
                </div>
                {r.columns && (
                  <details className="mt-3 text-[12px] text-ink-2">
                    <summary className="cursor-pointer">Columns read from the sheet ({r.columns.length})</summary>
                    <p className="mt-1">{r.columns.join(' · ')}</p>
                    {missing.length > 0 && <p className="mt-1 text-critical">Expected but missing: {missing.join(', ')}</p>}
                  </details>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
