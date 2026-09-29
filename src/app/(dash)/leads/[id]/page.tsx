import Link from 'next/link';
import { notFound } from 'next/navigation';
import { updateLeadNotes } from '@/app/actions/data';
import { LeadStatus, ResultPill, SOURCE_LABEL, StepLabel, TIME_QUALITY_LABEL } from '@/components/status';
import { Card, EmptyState, Notice, PageHeader, Pill } from '@/components/ui';
import { leadDetail } from '@/lib/metrics/leads';
import { formatDate, formatDateTime, localDate } from '@/lib/time';

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const d = await leadDetail(id);
  if (!d) notFound();
  const { lead, attempts, messages, whatsapp, otherCampaigns } = d;
  const threads = [...new Map(messages.map((m) => [m.threadKey, m])).values()];
  return (
    <>
      <PageHeader
        title={lead.name || lead.email || `Lead #${lead.id}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <LeadStatus status={lead.status} />
            <Link href={`/campaigns/${lead.campaignSlug}`} className="link">
              {lead.campaignName}
            </Link>
            {lead.sourceName && (
              <span className="text-ink-3">
                · {lead.sourceUrl ? (
                  <a className="link" href={lead.sourceUrl} target="_blank" rel="noopener noreferrer">
                    {lead.sourceName}
                  </a>
                ) : (
                  lead.sourceName
                )}
                {lead.rowNumber ? `, row ${lead.rowNumber}` : ''}
              </span>
            )}
          </span>
        }
      />
      {!lead.presentInSource && (
        <div className="mb-4">
          <Notice tone="warn">This row is no longer in the source sheet. Its history is kept.</Notice>
        </div>
      )}
      {lead.suppressed && (
        <div className="mb-4">
          <Notice tone="critical" title="Suppressed">
            This contact is on the suppression list ({lead.suppressionReason}). Do not contact again. The dashboard never sends; make sure the sheet row is not re-approved.
          </Notice>
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="Contact">
          <dl className="grid grid-cols-[110px_1fr] gap-y-1.5 text-[13px]">
            <dt className="text-ink-3">Email</dt>
            <dd>{lead.email ?? '—'}</dd>
            <dt className="text-ink-3">Phone</dt>
            <dd>{lead.phone ?? '—'}</dd>
            <dt className="text-ink-3">WhatsApp</dt>
            <dd>{lead.waChatId ? lead.waChatId.replace('@c.us', '') : '—'}</dd>
            <dt className="text-ink-3">Website</dt>
            <dd className="truncate">{lead.website ?? '—'}</dd>
            <dt className="text-ink-3">Location</dt>
            <dd>{[lead.city, lead.country].filter(Boolean).join(', ') || '—'}</dd>
            <dt className="text-ink-3">Category</dt>
            <dd>{lead.category ?? '—'}</dd>
            <dt className="text-ink-3">Sheet status</dt>
            <dd>{lead.sheetStatus || '(blank)'}</dd>
            <dt className="text-ink-3">Row key</dt>
            <dd className="break-all text-ink-2">{lead.rowKey}</dd>
          </dl>
          {lead.isDuplicate && <p className="mt-3 text-xs text-warn">Duplicate of lead #{lead.duplicateOf} in this campaign.</p>}
          {otherCampaigns.length > 0 && (
            <div className="mt-3 text-xs text-ink-2">
              Also in:{' '}
              {otherCampaigns.map((o, i) => (
                <span key={o.id}>
                  {i > 0 && ', '}
                  <Link className="link" href={`/leads/${o.id}`}>
                    {o.campaignName}
                  </Link>{' '}
                  ({o.status})
                </span>
              ))}
            </div>
          )}
        </Card>
        <Card title="Outreach summary">
          <dl className="grid grid-cols-[150px_1fr] gap-y-1.5 text-[13px]">
            <dt className="text-ink-3">Accepted sends</dt>
            <dd>
              {lead.sendsAccepted} ({lead.followupsAccepted} follow-ups)
            </dd>
            <dt className="text-ink-3">First contacted</dt>
            <dd>{lead.firstContactedAt ? formatDateTime(lead.firstContactedAt) : '—'}</dd>
            <dt className="text-ink-3">Last contacted</dt>
            <dd>{lead.lastContactedAt ? formatDateTime(lead.lastContactedAt) : '—'}</dd>
            <dt className="text-ink-3">Latest reply</dt>
            <dd>{lead.lastReplyAt ? formatDateTime(lead.lastReplyAt) : '—'}</dd>
            <dt className="text-ink-3">Reply classified</dt>
            <dd>{lead.replySentiment ?? '—'}</dd>
            <dt className="text-ink-3">Bounced</dt>
            <dd>{lead.bouncedAt ? formatDateTime(lead.bouncedAt) : 'No'}</dd>
            <dt className="text-ink-3">Next follow-up</dt>
            <dd>{lead.nextFollowupAt ? formatDate(lead.nextFollowupAt) : '—'}</dd>
          </dl>
        </Card>
        <Card title="Notes & manual follow-up">
          <form action={updateLeadNotes} className="space-y-2 text-[13px]">
            <input type="hidden" name="leadId" value={lead.id} />
            <label className="block">
              Follow up on
              <input type="date" name="followup" min={localDate()} defaultValue={lead.manualFollowupAt ? localDate(lead.manualFollowupAt) : ''} className="field mt-1 w-full" />
            </label>
            <textarea name="notes" defaultValue={lead.notes ?? ''} rows={4} className="field w-full" placeholder="Private notes (stored in the dashboard only)" />
            <button className="btn btn-primary">Save</button>
          </form>
        </Card>
      </div>

      <Card className="mt-4" title="Send history" subtitle="Every attempt and its result, from every source" pad={false}>
        {attempts.length === 0 ? (
          <EmptyState title="Never contacted">No send event is linked to this lead, so it is not counted as contacted.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-compact w-full min-w-[900px]">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Step</th>
                  <th>Result</th>
                  <th>From</th>
                  <th>Subject</th>
                  <th>Response / error</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {attempts.map((a) => (
                  <tr key={a.id}>
                    <td className="whitespace-nowrap">
                      {a.occurredAt ? (a.timeQuality === 'date_only' ? formatDate(a.occurredAt) : formatDateTime(a.occurredAt)) : '—'}
                      {TIME_QUALITY_LABEL[a.timeQuality] && <div className="text-[11px] text-ink-3">{TIME_QUALITY_LABEL[a.timeQuality]}</div>}
                    </td>
                    <td>
                      <StepLabel step={a.step} />
                    </td>
                    <td>
                      <ResultPill result={a.result} />
                      {a.waAck !== null && a.waAck >= 2 && <Pill tone="good">{a.waAck >= 3 ? 'Read' : 'Delivered'}</Pill>}
                    </td>
                    <td className="text-ink-2">{a.sender ?? '—'}</td>
                    <td className="max-w-64 truncate text-ink-2" title={a.subject ?? ''}>
                      {a.subject ?? '—'}
                    </td>
                    <td className="max-w-72 text-[12px] text-ink-2">{a.errorMessage ?? a.providerStatus ?? '—'}</td>
                    <td className="whitespace-nowrap text-[12px] text-ink-2">
                      {SOURCE_LABEL[a.source] ?? a.source}
                      {a.executionId && <div className="text-[11px] text-ink-3">exec #{a.executionId}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Email conversations" pad={false}>
          {threads.length === 0 ? (
            <EmptyState title="No emails found in connected mailboxes" />
          ) : (
            <ul className="divide-y divide-line text-[13px]">
              {threads.map((m) => (
                <li key={m.id} className="px-4 py-2.5">
                  <Link href={`/inbox?thread=${encodeURIComponent(m.threadKey ?? '')}`} className="link font-medium">
                    {m.subject || '(no subject)'}
                  </Link>
                  <div className="text-[11.5px] text-ink-3">
                    {m.direction === 'inbound' ? 'Received' : 'Sent'} {formatDateTime(m.sentAt)} · {m.mailbox} · {m.folder}
                    {m.kind !== 'message' ? ` · ${m.kind.replace('_', ' ')}` : ''}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="WhatsApp messages" pad={false}>
          {whatsapp.length === 0 ? (
            <EmptyState title="No WhatsApp messages recorded" />
          ) : (
            <ul className="max-h-96 space-y-2 overflow-y-auto p-4 text-[13px]">
              {whatsapp.map((w) => (
                <li key={w.id} className={`max-w-[85%] rounded-lg px-3 py-2 ${w.fromMe ? 'ml-auto bg-brand-50' : 'bg-slate-100'}`}>
                  <div className="whitespace-pre-wrap">{w.body ?? '(media)'}</div>
                  <div className="mt-1 text-[11px] text-ink-3">
                    {formatDateTime(w.sentAt)} · {w.session}
                    {w.fromMe && w.ack !== null ? ` · ${['pending', 'sent', 'delivered', 'read', 'played'][w.ack] ?? w.ack}` : ''}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <details className="card mt-4 px-4 py-3 text-[13px]">
        <summary className="cursor-pointer font-medium">Raw sheet row</summary>
        <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap text-[12px] text-ink-2">{JSON.stringify(lead.raw, null, 2)}</pre>
      </details>
    </>
  );
}
