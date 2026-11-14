import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ActivityCharts } from '@/components/ActivityCharts';
import { CampaignStatus, LEAD_STATUS, LeadStatus, ResultPill, SOURCE_LABEL, StepLabel, TIME_QUALITY_LABEL } from '@/components/status';
import { AnimatedNumber, Lift, Stagger } from '@/components/motion';
import { Card, EmptyState, fmt, Notice, PageHeader, RateCell, Tip } from '@/components/ui';
import { q } from '@/lib/db';
import { campaignBySlug, contactHistory, statusCounts } from '@/lib/metrics/campaigns';
import { parseFilters } from '@/lib/metrics/filters';
import { dailyActivity } from '@/lib/metrics/overview';
import { formatDate, formatDateTime } from '@/lib/time';

export default async function CampaignPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const c = await campaignBySlug(slug);
  if (!c) notFound();
  const f = parseFilters({ ...sp, campaign: slug }, 30);
  const [activity, history, statuses, workflows, sources] = await Promise.all([
    dailyActivity(f),
    contactHistory(c.id, 150),
    statusCounts(c.id),
    q<{ id: string; name: string | null; active: boolean | null }>('select id, name, active from n8n_workflows where id = any($1)', [
      ((c.config.workflowIds as string[] | undefined) ?? []) as string[],
    ]),
    q<{ key: string; name: string; external_url: string | null; last_success_at: Date | null }>(
      `select distinct s.key, s.name, s.external_url, s.last_success_at from sources s join leads l on l.source_id = s.id where l.campaign_id = $1`,
      [c.id],
    ),
  ]);
  const followup = c.config.followup as { mode: string; note?: string; cadenceDays?: number[] } | undefined;
  const steps = Object.entries(c.followupsByStep).sort(([a], [b]) => Number(a) - Number(b));

  return (
    <>
      <PageHeader
        title={c.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <CampaignStatus status={c.status} />
            <span>{c.channel === 'email' ? 'Email' : 'WhatsApp'}</span>·<span>Started {c.startedAt ? formatDate(c.startedAt) : 'unknown'}</span>·
            <span>{c.brand}</span>
          </span>
        }
        actions={
          <>
            <Link href={`/leads?campaign=${c.slug}`} className="btn">
              View leads
            </Link>
            <a href={`/api/export/campaign?campaign=${c.slug}`} className="btn">
              Export CSV
            </a>
          </>
        }
      />
      {c.description && <p className="-mt-2 mb-4 max-w-4xl text-sm text-ink-2">{c.description}</p>}

      <Stagger className="grid grid-cols-2 gap-4 md:grid-cols-4 xl:grid-cols-6">
        {[
          ['Leads loaded', c.leadsLoaded, 'Rows currently in the source sheet(s) for this campaign.'],
          ['Eligible', c.eligible, 'Loaded minus invalid, duplicate, excluded and unsubscribed.'],
          ['Queued', c.queued, 'Approved with a scheduled send date/time.'],
          ['Contacted', c.contacted, 'Unique leads with at least one accepted send event.'],
          ['Remaining', c.remaining, 'Usable leads not contacted yet (ready, queued, awaiting approval, needs draft, failed).'],
          ['Duplicates prevented', c.duplicatesPrevented, 'Duplicate rows (same address earlier in this campaign) that were never sent to.'],
        ].map(([label, v, tip]) => (
          <Lift key={String(label)}>
            <div className="card h-full p-3">
              <div className="flex items-center gap-1 text-xs text-ink-2">
                {label} <Tip text={String(tip)} />
              </div>
              <div className="mt-1 text-xl font-semibold tabular">
                <AnimatedNumber value={Number(v)} />
              </div>
            </div>
          </Lift>
        ))}
      </Stagger>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="Sends" subtitle="Unique (lead, step) accepted by the server">
          <dl className="space-y-1.5 text-[13px]">
            <div className="flex justify-between">
              <dt>Original emails{c.channel === 'whatsapp' ? ' / messages' : ''}</dt>
              <dd className="font-semibold tabular">{fmt(c.originalsSent)}</dd>
            </div>
            {steps.length === 0 ? (
              <div className="flex justify-between text-ink-2">
                <dt>Follow-ups</dt>
                <dd className="tabular">0</dd>
              </div>
            ) : (
              steps.map(([step, n]) => (
                <div key={step} className="flex justify-between">
                  <dt>
                    <StepLabel step={Number(step)} />
                  </dt>
                  <dd className="font-semibold tabular">{fmt(n)}</dd>
                </div>
              ))
            )}
            <div className="flex justify-between border-t border-line pt-1.5 text-ink-2">
              <dt>Failed, never accepted</dt>
              <dd className="tabular">{fmt(c.failedNeverAccepted)}</dd>
            </div>
            {c.sendsUnknownDate > 0 && (
              <div className="flex justify-between text-ink-2">
                <dt>
                  Sends with unknown date <Tip text="Known only from a sheet status (e.g. 'FU2 Sent'); counted in totals, not in daily charts." />
                </dt>
                <dd className="tabular">{fmt(c.sendsUnknownDate)}</dd>
              </div>
            )}
          </dl>
          <p className="mt-3 text-[11.5px] text-ink-3">
            Sending from: {c.mailboxes.length ? c.mailboxes.join(', ') : 'no send events yet'}
          </p>
        </Card>

        <Card title="Replies & bounces" subtitle="Unique leads · rate = outcome ÷ denominator shown">
          <dl className="space-y-2 text-[13px]">
            <div className="flex items-center justify-between gap-2">
              <dt>
                Reply rate <Tip text="Leads who replied ÷ leads contacted." />
              </dt>
              <dd>
                <RateCell num={c.repliedLeads} den={c.contacted} />
              </dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt>
                Positive reply rate <Tip text="Leads with a reply you marked Positive ÷ leads contacted. Classify replies in the inbox to make this complete." />
              </dt>
              <dd>
                <RateCell num={c.positiveLeads} den={c.contacted} />
              </dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt>
                Follow-up reply rate <Tip text="Leads who replied after their first follow-up ÷ leads who received a follow-up with a known send time." />
              </dt>
              <dd>{c.receivedFollowup > 0 ? <RateCell num={c.repliedAfterFollowup} den={c.receivedFollowup} /> : <span className="text-ink-3">Not measurable</span>}</dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt>
                Bounce rate <Tip text="Contacted leads with a bounce report ÷ leads contacted." />
              </dt>
              <dd>
                <RateCell num={c.bouncedLeads} den={c.contacted} />
              </dd>
            </div>
            <div className="flex justify-between border-t border-line pt-2 text-ink-2">
              <dt>Reply messages / classified leads</dt>
              <dd className="tabular">
                {fmt(c.replyMessages)} / {fmt(c.classifiedLeads)} of {fmt(c.repliedLeads)}
              </dd>
            </div>
            <div className="flex justify-between text-ink-2">
              <dt>Not interested · Unsubscribed</dt>
              <dd className="tabular">
                {fmt(c.notInterestedLeads)} · {fmt(c.unsubscribedLeads)}
              </dd>
            </div>
          </dl>
        </Card>

        <Card title="Lead statuses" subtitle="Current status of every lead in this campaign">
          <ul className="space-y-1.5 text-[13px]">
            {Object.entries(statuses)
              .sort((a, b) => b[1] - a[1])
              .map(([s, n]) => (
                <li key={s} className="flex items-center justify-between">
                  <Link href={`/leads?campaign=${c.slug}&status=${s}`}>
                    <LeadStatus status={s} />
                  </Link>
                  <span className="tabular">{fmt(n)}</span>
                </li>
              ))}
            {Object.keys(statuses).length === 0 && <li className="text-ink-3">No leads loaded yet.</li>}
          </ul>
          <p className="mt-3 text-[11.5px] text-ink-3">{Object.keys(LEAD_STATUS).length} statuses are defined; hover a badge for its rule.</p>
        </Card>
      </div>

      <Card
        className="mt-4"
        title="Business results"
        subtitle="Recorded on each lead's page. Counts include contacted leads only, so every rate uses the same denominator as the reply rate."
        actions={
          <Link href={`/leads?campaign=${c.slug}&outcome=any`} className="btn btn-sm">
            Leads with an outcome
          </Link>
        }
      >
        {c.qualifiedLeads + c.meetingLeads + c.wonLeads + c.lostLeads === 0 ? (
          <p className="text-[13px] text-ink-2">
            No outcomes recorded yet. When a reply turns into a qualified lead, a meeting or a deal, record it on the lead&rsquo;s page so this campaign is judged on business, not
            just replies.
          </p>
        ) : (
          <dl className="grid grid-cols-2 gap-4 text-[13px] md:grid-cols-5">
            <div>
              <dt className="text-ink-3">
                Qualified <Tip text="Contacted leads ever marked Qualified, Meeting booked or Won ÷ leads contacted." />
              </dt>
              <dd className="mt-1">
                <RateCell num={c.qualifiedLeads} den={c.contacted} />
              </dd>
            </div>
            <div>
              <dt className="text-ink-3">
                Meetings booked <Tip text="Contacted leads ever marked Meeting booked or Won ÷ leads contacted." />
              </dt>
              <dd className="mt-1">
                <RateCell num={c.meetingLeads} den={c.contacted} />
              </dd>
            </div>
            <div>
              <dt className="text-ink-3">
                Won <Tip text="Contacted leads whose latest outcome is Won ÷ leads contacted." />
              </dt>
              <dd className="mt-1">
                <RateCell num={c.wonLeads} den={c.contacted} />
              </dd>
            </div>
            <div>
              <dt className="text-ink-3">
                Won value <Tip text="Sum of the deal values recorded on Won outcomes." />
              </dt>
              <dd className="mt-1 text-[15px] font-semibold tabular text-ink">
                {c.wonValue > 0
                  ? `${c.wonCurrencies.length === 1 ? `${c.wonCurrencies[0]} ` : ''}${Math.round(c.wonValue).toLocaleString('en-IN')}${c.wonCurrencies.length > 1 ? ' (mixed)' : ''}`
                  : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-ink-3">
                Lost <Tip text="Contacted leads whose latest outcome is Lost." />
              </dt>
              <dd className="mt-1 text-[15px] font-semibold tabular text-ink">{fmt(c.lostLeads)}</dd>
            </div>
          </dl>
        )}
      </Card>

      <Card className="mt-4" title="Daily activity" subtitle={`${f.from} → ${f.to} (use ?from=YYYY-MM-DD&to=YYYY-MM-DD for another range)`}>
        <ActivityCharts points={activity.points} unknownDated={activity.unknownDated} />
      </Card>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Automation" subtitle="n8n workflows and follow-up rules for this campaign">
          <ul className="space-y-1.5 text-[13px]">
            {((c.config.workflowIds as string[]) ?? []).map((id) => {
              const w = workflows.find((x) => x.id === id);
              return (
                <li key={id} className="flex items-center justify-between gap-2">
                  <span>{w?.name ?? id}</span>
                  <span className="text-xs text-ink-3">{w ? (w.active ? 'active' : 'inactive') : 'state unknown'}</span>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-[12.5px] text-ink-2">
            <b>Follow-ups:</b> {followup?.mode === 'none' ? 'no automated follow-up sequence.' : followup?.mode === 'days_after_last' ? `sent ${followup.cadenceDays?.join(' / ')} days after the previous step.` : 'next touch date comes from the source.'}{' '}
            {followup?.note}
          </p>
        </Card>
        <Card title="Sources" subtitle="Where this campaign's leads come from">
          {sources.length === 0 ? (
            <p className="text-sm text-ink-3">No source rows synced yet.</p>
          ) : (
            <ul className="space-y-1.5 text-[13px]">
              {sources.map((s) => (
                <li key={s.key} className="flex items-center justify-between gap-2">
                  {s.external_url ? (
                    <a href={s.external_url} target="_blank" rel="noopener noreferrer" className="link">
                      {s.name}
                    </a>
                  ) : (
                    <span>{s.name}</span>
                  )}
                  <span className="text-xs text-ink-3">{s.last_success_at ? `synced ${formatDateTime(s.last_success_at)}` : 'not synced'}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card className="mt-4" title="Contact history" subtitle="Every send attempt and its result (latest 150). Accepted = the server took the message; it does not prove inbox delivery." pad={false}>
        {history.length === 0 ? (
          <EmptyState title="No send events yet">Send events appear once n8n (or the sheet) reports them.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="table-compact w-full min-w-[980px]">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Lead</th>
                  <th>Step</th>
                  <th>Result</th>
                  <th>Sender</th>
                  <th>Server response / error</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id}>
                    <td className="whitespace-nowrap">
                      {h.occurredAt ? (h.timeQuality === 'date_only' ? formatDate(h.occurredAt) : formatDateTime(h.occurredAt)) : '—'}
                      {TIME_QUALITY_LABEL[h.timeQuality] && <div className="text-[11px] text-ink-3">{TIME_QUALITY_LABEL[h.timeQuality]}</div>}
                    </td>
                    <td>
                      {h.leadId ? (
                        <Link href={`/leads/${h.leadId}`} className="link">
                          {h.leadName || h.recipient}
                        </Link>
                      ) : (
                        h.recipient
                      )}
                      {h.leadName && <div className="text-[11px] text-ink-3">{h.recipient}</div>}
                    </td>
                    <td>
                      <StepLabel step={h.step} />
                    </td>
                    <td>
                      <ResultPill result={h.result} />
                    </td>
                    <td className="text-ink-2">{h.sender ?? '—'}</td>
                    <td className="max-w-80 text-[12px] text-ink-2">{h.errorMessage ?? h.providerStatus ?? '—'}</td>
                    <td className="whitespace-nowrap text-[12px] text-ink-2">
                      {SOURCE_LABEL[h.source] ?? h.source}
                      {h.executionId && <div className="text-[11px] text-ink-3">exec #{h.executionId}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {c.contacted === 0 && c.leadsLoaded === 0 && (
        <div className="mt-4">
          <Notice>No data yet for this campaign. It fills in once the n8n bridge (sheets) and n8n API (send events) are connected on the Integrations page.</Notice>
        </div>
      )}
    </>
  );
}
