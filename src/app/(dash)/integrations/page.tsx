import { CheckCircle2, CircleSlash } from 'lucide-react';
import Link from 'next/link';
import { requestSync, resolveError } from '@/app/actions/data';
import { Card, EmptyState, Notice, PageHeader, Pill, SyncState } from '@/components/ui';
import { configChecklist, openErrors, recentRuns, workflowCoverage } from '@/lib/metrics/integrations';
import { integrationStatuses } from '@/lib/metrics/overview';
import { formatDateTime, relativeTime } from '@/lib/time';

export const metadata = { title: 'Integrations' };

const JOBS = [
  ['all', 'Sync everything'],
  ['sheets', 'Spreadsheets'],
  ['n8n-executions', 'n8n send events'],
  ['mailboxes', 'Mailboxes'],
  ['waha', 'WhatsApp'],
] as const;

export default async function IntegrationsPage() {
  const [statuses, errors, runs, workflows] = await Promise.all([integrationStatuses(), openErrors(), recentRuns(), workflowCoverage()]);
  const checklist = configChecklist();
  const untracked = workflows.filter((w) => !w.tracked && w.looksLikeSender);
  const failingUntracked = workflows.filter((w) => !w.tracked && (w.lastRunStatus === 'error' || w.lastRunStatus === 'crashed'));
  const sources = statuses.filter((s) => s.kind !== 'mailbox');
  const mailboxes = statuses.filter((s) => s.kind === 'mailbox');
  return (
    <>
      <PageHeader
        title="Integrations"
        subtitle="What is connected, when it last synced, and what is still needed. Secret values are never shown here."
        actions={
          <div className="flex flex-wrap gap-1.5">
            {JOBS.map(([job, label]) => (
              <form key={job} action={requestSync}>
                <input type="hidden" name="job" value={job} />
                <button className={`btn btn-sm ${job === 'all' ? 'btn-primary' : ''}`}>{label}</button>
              </form>
            ))}
          </div>
        }
      />
      {failingUntracked.length > 0 && (
        <div className="mb-4">
          <Notice tone="critical" title={`${failingUntracked.length} n8n workflow(s) outside the dashboard's registry are failing`}>
            {failingUntracked.map((w) => w.name).join(', ')}. Every active n8n workflow's execution history is now pulled for health, even when it is not one of
            this dashboard's tracked campaigns — see the open error below and the{' '}
            <Link href="/alerts" className="link">
              Alerts
            </Link>{' '}
            page for the exact n8n error message on each run.
          </Notice>
        </div>
      )}
      {untracked.length > 0 && (
        <div className="mb-4">
          <Notice tone="warn" title={`${untracked.length} n8n workflow(s) send messages but are not mapped to a campaign`}>
            Their sends are <b>not counted</b> anywhere until they are added to <code>config/registry.json</code>: {untracked.map((w) => `${w.name}${w.active ? '' : ' (inactive)'}`).join(', ')}.
          </Notice>
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title="Server configuration" subtitle="Environment variables on the VPS (present / missing)">
          <ul className="space-y-2 text-[13px]">
            {checklist.map((c) => (
              <li key={c.key} className="flex items-start gap-2">
                {c.ok ? <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-good-text" aria-label="set" /> : <CircleSlash size={16} className="mt-0.5 shrink-0 text-ink-3" aria-label="missing" />}
                <div>
                  <code className="text-[12px]">{c.key}</code>
                  <div className="text-[12px] text-ink-2">{c.purpose}</div>
                </div>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Data sources" pad={false}>
          <table className="table-compact w-full">
            <thead>
              <tr>
                <th>Source</th>
                <th>Status</th>
                <th>Last success</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => (
                <tr key={s.key}>
                  <td>
                    <div className="font-medium">{s.name}</div>
                    <div className="text-[11px] text-ink-3">
                      {s.kind.replace('_', ' ')}
                      {s.detail ? ` · ${s.detail}` : ''}
                    </div>
                    {s.lastError && <div className="mt-0.5 text-[11.5px] text-critical">{s.lastError}</div>}
                  </td>
                  <td>
                    <SyncState status={s.status} />
                  </td>
                  <td className="whitespace-nowrap text-[12px] text-ink-2" title={s.lastSuccessAt ? formatDateTime(s.lastSuccessAt) : ''}>
                    {s.lastSuccessAt ? relativeTime(s.lastSuccessAt) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title="Mailboxes" subtitle="Header sync of every folder (Inbox, Sent, Spam, …)" pad={false}>
          <table className="table-compact w-full">
            <thead>
              <tr>
                <th>Mailbox</th>
                <th>Method</th>
                <th>Status</th>
                <th>Last success</th>
              </tr>
            </thead>
            <tbody>
              {mailboxes.map((m) => (
                <tr key={m.key}>
                  <td>
                    {m.name}
                    {m.lastError && m.status !== 'not_connected' && <div className="text-[11.5px] text-critical">{m.lastError}</div>}
                  </td>
                  <td className="text-[12px] text-ink-2">{m.detail ?? '—'}</td>
                  <td>
                    <SyncState status={m.status} />
                  </td>
                  <td className="whitespace-nowrap text-[12px] text-ink-2">{m.lastSuccessAt ? relativeTime(m.lastSuccessAt) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card
          title="n8n workflow coverage"
          subtitle="Tracked send workflows, any sender workflow that is not mapped, and any other active workflow currently failing"
          pad={false}
        >
          {workflows.length === 0 ? (
            <EmptyState title="n8n not scanned yet">Set N8N_BASE_URL and N8N_API_KEY; the workflow scan runs hourly.</EmptyState>
          ) : (
            <table className="table-compact w-full">
              <thead>
                <tr>
                  <th>Workflow</th>
                  <th>n8n state</th>
                  <th>Tracking</th>
                  <th>Last run</th>
                </tr>
              </thead>
              <tbody>
                {workflows.map((w) => (
                  <tr key={w.id}>
                    <td>
                      {w.name}
                      <div className="text-[11px] text-ink-3">{w.id}</div>
                    </td>
                    <td>{w.active ? <Pill tone="good">Active</Pill> : <Pill>Inactive</Pill>}</td>
                    <td>{w.tracked ? <Pill tone="brand">Tracked</Pill> : <Pill tone="warn">Not mapped</Pill>}</td>
                    <td className="whitespace-nowrap text-[12px]">
                      {w.lastRunStatus ? (
                        <>
                          <Pill tone={w.lastRunStatus === 'success' ? 'good' : w.lastRunStatus === 'error' || w.lastRunStatus === 'crashed' ? 'critical' : 'default'}>
                            {w.lastRunStatus}
                          </Pill>
                          {w.lastRunAt && <span className="ml-1.5 text-ink-3" title={formatDateTime(w.lastRunAt)}>{relativeTime(w.lastRunAt)}</span>}
                        </>
                      ) : (
                        <span className="text-ink-3">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <Card className="mt-4" title={`Open integration errors (${errors.length})`} subtitle="Problems are recorded here instead of being dropped. Repeats are folded into one row." pad={false}>
        {errors.length === 0 ? (
          <EmptyState title="No open errors" />
        ) : (
          <table className="table-compact w-full">
            <thead>
              <tr>
                <th>Source</th>
                <th>Message</th>
                <th>Seen</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {errors.map((e) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap text-[12px]">
                    <Pill tone={e.severity === 'error' ? 'critical' : 'warn'}>{e.severity}</Pill>
                    <div className="mt-1 text-ink-3">{e.sourceKey}</div>
                  </td>
                  <td className="text-[12.5px]">{e.message}</td>
                  <td className="whitespace-nowrap text-[12px] text-ink-2">
                    {e.occurrences}× · last {relativeTime(e.lastSeenAt)}
                  </td>
                  <td>
                    <form action={resolveError}>
                      <input type="hidden" name="id" value={e.id} />
                      <button className="btn btn-sm">Resolve</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <Card className="mt-4" title="Recent sync runs" pad={false}>
        {runs.length === 0 ? (
          <EmptyState title="The sync worker has not run yet" />
        ) : (
          <table className="table-compact w-full">
            <thead>
              <tr>
                <th>Job</th>
                <th>Started</th>
                <th>Duration</th>
                <th>Status</th>
                <th className="text-right">Seen / written</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td>{r.job}</td>
                  <td className="whitespace-nowrap text-[12px]">{formatDateTime(r.startedAt)}</td>
                  <td className="text-[12px] tabular">{r.finishedAt ? `${Math.max(0, Math.round((r.finishedAt.getTime() - r.startedAt.getTime()) / 1000))}s` : 'running'}</td>
                  <td>
                    <Pill tone={r.status === 'success' ? 'good' : r.status === 'skipped' ? 'default' : r.status === 'partial' ? 'warn' : r.status === 'running' ? 'brand' : 'critical'}>{r.status}</Pill>
                  </td>
                  <td className="text-right text-[12px] tabular">
                    {r.itemsSeen} / {r.itemsWritten}
                  </td>
                  <td className="max-w-md text-[12px] text-ink-2">{r.error ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}
