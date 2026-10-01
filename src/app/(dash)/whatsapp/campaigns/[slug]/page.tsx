import Link from 'next/link';
import { notFound } from 'next/navigation';
import { pauseCampaign, resumeCampaign, saveCampaignSettings } from '@/app/actions/whatsapp';
import { Card, fmt, Notice, PageHeader, Pill, RateCell } from '@/components/ui';
import { q } from '@/lib/db';
import { campaignBySlug } from '@/lib/metrics/campaigns';
import { campaignFunnel } from '@/lib/metrics/whatsapp';
import { listTemplates, templateCoverage } from '@/lib/whatsapp/templates';
import { formatDateTime, relativeTime } from '@/lib/time';

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default async function WaCampaignDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const c = await campaignBySlug(slug);
  if (!c || c.channel !== 'whatsapp') notFound();
  const workflowIds = (c.config.workflowIds as string[] | undefined) ?? [];
  const [funnel, templates, workflows, lastExec, source, session, coverage] = await Promise.all([
    campaignFunnel(c.id),
    listTemplates(),
    q<{ id: string; name: string | null; active: boolean | null }>('select id, name, active from n8n_workflows where id = any($1)', [workflowIds]),
    q<{ workflow_id: string; status: string; started_at: Date }>(
      `select distinct on (workflow_id) workflow_id, status, started_at from n8n_executions where workflow_id = any($1) order by workflow_id, started_at desc`,
      [workflowIds],
    ),
    q<{ key: string; name: string; row_count: number | null; last_success_at: Date | null }>(
      `select distinct s.key, s.name, s.row_count, s.last_success_at from sources s join leads l on l.source_id = s.id where l.campaign_id = $1`,
      [c.id],
    ),
    q<{ status: string | null }>('select status from wa_sessions where name = $1', [String(c.config.waSession ?? '')]),
    c.templateId ? templateCoverage(c.id, c.templateId) : Promise.resolve(null),
  ]);
  const paused = !!c.controlPausedAt;
  const window = c.sendWindow ?? {};
  const template = templates.find((t) => t.id === c.templateId);

  return (
    <>
      <PageHeader
        title={c.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            {paused ? <Pill tone="warn">Paused{c.controlPausedBy ? ` by ${c.controlPausedBy}` : ''}</Pill> : <Pill tone="good">Active</Pill>}
            <span>Account: {String(c.config.waSession ?? '—')}</span>
            {session[0] && <Pill tone={session[0].status === 'WORKING' ? 'good' : 'critical'}>{session[0].status ?? 'unknown'}</Pill>}
          </span>
        }
        actions={
          <>
            <Link href={`/campaigns/${c.slug}`} className="btn">
              Full metrics
            </Link>
            <Link href={`/leads?campaign=${c.slug}`} className="btn">
              View leads
            </Link>
          </>
        }
      />
      {c.description && <p className="-mt-2 mb-4 max-w-4xl text-sm text-ink-2">{c.description}</p>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="Controls" subtitle="A pause stops the next queued sends at the workflow's final send step (see docs/WHATSAPP.md).">
          <div className="space-y-3">
            {paused ? (
              <>
                {c.controlPauseReason && <p className="text-[13px] text-ink-2">Reason: {c.controlPauseReason}</p>}
                <form action={resumeCampaign}>
                  <input type="hidden" name="slug" value={c.slug} />
                  <button type="submit" className="btn btn-primary w-full">
                    Resume sending
                  </button>
                </form>
              </>
            ) : (
              <form action={pauseCampaign} className="space-y-2">
                <input type="hidden" name="slug" value={c.slug} />
                <input name="reason" placeholder="Reason (optional, shown to you later)" className="field w-full" maxLength={200} />
                <button type="submit" className="btn w-full">
                  Pause sending
                </button>
              </form>
            )}
            <p className="text-[11.5px] text-ink-3">
              {workflows.length === 0
                ? 'No n8n workflow is linked to this campaign yet, so pausing here has no effect on sending.'
                : workflows.every((w) => w.active === false)
                  ? 'The n8n workflow is also switched off, so nothing would send even without this.'
                  : 'Enforced by a gate check the n8n workflow makes before every send.'}
            </p>
          </div>
        </Card>

        <Card title="Workflow & source" subtitle="Real n8n execution history and the linked spreadsheet.">
          <dl className="space-y-1.5 text-[13px]">
            {workflows.length === 0 && <p className="text-ink-2">No linked n8n workflow.</p>}
            {workflows.map((w) => {
              const exec = lastExec.find((e) => e.workflow_id === w.id);
              return (
                <div key={w.id} className="flex items-center justify-between gap-2">
                  <dt className="truncate">{w.name ?? w.id}</dt>
                  <dd className="flex items-center gap-1.5">
                    <Pill tone={w.active ? 'good' : 'default'}>{w.active ? 'On' : 'Off'}</Pill>
                    {exec && <span className="text-ink-3" title={formatDateTime(exec.started_at)}>{relativeTime(exec.started_at)}</span>}
                  </dd>
                </div>
              );
            })}
            {source.map((s) => (
              <div key={s.key} className="flex items-center justify-between gap-2 border-t border-line pt-1.5">
                <dt className="truncate">{s.name}</dt>
                <dd className="text-ink-3 tabular">{fmt(s.row_count)} rows</dd>
              </div>
            ))}
          </dl>
        </Card>

        <Card title="Progress" subtitle="Unique leads contacted ÷ reply.">
          <dl className="space-y-1.5 text-[13px]">
            <div className="flex justify-between">
              <dt>Contacted</dt>
              <dd className="tabular font-medium">{fmt(c.contacted)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Reply rate</dt>
              <dd><RateCell num={c.repliedLeads} den={c.contacted} /></dd>
            </div>
            <div className="flex justify-between">
              <dt>Positive rate</dt>
              <dd><RateCell num={c.positiveLeads} den={c.contacted} /></dd>
            </div>
            <div className="flex justify-between border-t border-line pt-1.5">
              <dt>Meetings · Won</dt>
              <dd className="tabular">{fmt(c.meetingLeads)} · {fmt(c.wonLeads)}</dd>
            </div>
          </dl>
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Where every loaded lead went" subtitle={`${fmt(funnel.loaded)} loaded, reconciled to the category below — every lead is counted exactly once.`} pad={false}>
          <table className="table-compact w-full">
            <tbody>
              {funnel.buckets.map((b) => (
                <tr key={b.bucket}>
                  <td>
                    <Link href={`/leads?campaign=${c.slug}`} className="link">
                      {b.label}
                    </Link>
                  </td>
                  <td className="w-40">
                    <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full bg-brand" style={{ width: funnel.loaded ? `${Math.max(2, (b.count / funnel.loaded) * 100)}%` : '0%' }} />
                    </div>
                  </td>
                  <td className="text-right tabular">{fmt(b.count)}</td>
                </tr>
              ))}
              <tr className="border-t border-line font-medium">
                <td>Loaded (total)</td>
                <td />
                <td className="text-right tabular">{fmt(funnel.loaded)}</td>
              </tr>
            </tbody>
          </table>
        </Card>

        <Card title="Sending settings" subtitle="Daily cap and send window are enforced by the n8n gate check; a template here is what the setup wizard would use.">
          <form action={saveCampaignSettings} className="space-y-4 text-[13px]">
            <input type="hidden" name="slug" value={c.slug} />
            <label className="block">
              <span className="mb-1 block font-medium text-ink-2">Your daily volume limit</span>
              <input name="dailyCap" type="number" min={1} max={1000} defaultValue={c.dailyCap ?? ''} className="field w-32" placeholder="No limit" />
              <span className="mt-1 block text-[11.5px] text-ink-3">This is a manual limit you set — not something WhatsApp itself enforces or reports.</span>
            </label>
            <label className="block">
              <span className="mb-1 block font-medium text-ink-2">Message template</span>
              <select name="templateId" defaultValue={c.templateId ?? ''} className="field w-full max-w-sm">
                <option value="">No template linked (n8n uses its own drafted message)</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.kind})
                  </option>
                ))}
              </select>
            </label>
            <fieldset>
              <legend className="mb-1 font-medium text-ink-2">Send days</legend>
              <div className="flex flex-wrap gap-2">
                {DAY_LABELS.map((d, i) => (
                  <label key={d} className="flex items-center gap-1">
                    <input type="checkbox" name="sendDay" value={i + 1} defaultChecked={window.days?.includes(i + 1) ?? false} /> {d}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="flex gap-3">
              <label className="block">
                <span className="mb-1 block font-medium text-ink-2">From</span>
                <input type="time" name="startLocal" defaultValue={window.startLocal ?? ''} className="field" />
              </label>
              <label className="block">
                <span className="mb-1 block font-medium text-ink-2">To</span>
                <input type="time" name="endLocal" defaultValue={window.endLocal ?? ''} className="field" />
              </label>
            </div>
            <button type="submit" className="btn btn-primary">
              Save settings
            </button>
          </form>
        </Card>
      </div>

      {template && (
        <div className="mt-4">
          <Notice>
            Linked template: <strong>{template.name}</strong> ({template.kind}). Manage it on the{' '}
            <Link href="/whatsapp/templates" className="link">
              Templates
            </Link>{' '}
            tab.
            {coverage && coverage.needsDraft > 0 && (
              <>
                {' '}
                It could fill in <strong>{coverage.fullyCoverable}</strong> of the {coverage.needsDraft} lead(s) still waiting on a drafted message right now
                {coverage.partiallyCoverable > 0 ? ` (${coverage.partiallyCoverable} more are missing at least one field this template needs)` : ''}. This is a
                read-only check — nothing is written back to the sheet yet; ask if you want that built.
              </>
            )}
          </Notice>
        </div>
      )}
    </>
  );
}
