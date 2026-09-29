import Link from 'next/link';
import { AlertTriangle, BellOff, CheckCircle2, XCircle } from 'lucide-react';
import { acknowledgeAlert, checkAlertsNow, saveAlertSettings } from '@/app/actions/data';
import { Card, EmptyState, Notice, PageHeader, Pill } from '@/components/ui';
import { alertSettings, openAlerts, resolvedAlerts, type AlertRow } from '@/lib/alerts';
import { env } from '@/lib/env';
import { formatDateTime, relativeTime } from '@/lib/time';

export const metadata = { title: 'Alerts' };

const KIND_LABEL: Record<string, string> = {
  n8n_failed_run: 'n8n run failed',
  sync_failed: 'Sync failure',
  followups_overdue: 'Overdue follow-ups',
  bounce_spike: 'Bounce spike',
  volume_limit: 'Daily limit',
};

function Severity({ severity }: { severity: string }) {
  return severity === 'critical' ? (
    <Pill tone="critical">
      <XCircle size={12} aria-hidden /> Critical
    </Pill>
  ) : (
    <Pill tone="warn">
      <AlertTriangle size={12} aria-hidden /> Warning
    </Pill>
  );
}

function AlertItem({ a }: { a: AlertRow }) {
  return (
    <li className={`flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between ${a.acknowledgedAt ? 'opacity-70' : ''}`}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Severity severity={a.severity} />
          <span className="text-[11.5px] font-medium uppercase tracking-wide text-ink-3">{KIND_LABEL[a.kind] ?? a.kind}</span>
          {a.acknowledgedAt && (
            <Pill>
              <BellOff size={12} aria-hidden /> Acknowledged
            </Pill>
          )}
        </div>
        <div className="mt-1 text-[14px] font-semibold text-ink">{a.title}</div>
        {a.detail && <p className="mt-0.5 text-[13px] text-ink-2">{a.detail}</p>}
        <div className="mt-1 text-[11.5px] text-ink-3">
          Since {formatDateTime(a.firstSeenAt)} · still true at {formatDateTime(a.lastSeenAt)}
          {a.notifiedAt ? ` · sent to n8n ${relativeTime(a.notifiedAt)}` : ''}
        </div>
      </div>
      <div className="flex shrink-0 gap-2">
        {a.link && (
          <Link href={a.link} className="btn btn-sm">
            Open
          </Link>
        )}
        {!a.acknowledgedAt && (
          <form action={acknowledgeAlert}>
            <input type="hidden" name="id" value={a.id} />
            <button className="btn btn-sm" title="Hide from the sidebar badge. It still resolves on its own when the problem clears.">
              Acknowledge
            </button>
          </form>
        )}
      </div>
    </li>
  );
}

export default async function AlertsPage() {
  const [open, resolved, settings] = await Promise.all([openAlerts(), resolvedAlerts(), alertSettings()]);
  const bridgeReady = !!env.n8nBaseUrl && !!env.bridgeKey;
  return (
    <>
      <PageHeader
        title="Alerts"
        subtitle="Checked every 5 minutes. An alert stays open while the problem exists and resolves itself when it clears."
        actions={
          <form action={checkAlertsNow}>
            <button className="btn btn-sm btn-primary">Check now</button>
          </form>
        }
      />
      <Card title={`Open alerts (${open.length})`} pad={false} className="mb-4">
        {open.length === 0 ? (
          <EmptyState title="Nothing needs attention" icon={<CheckCircle2 size={28} className="text-good-text" aria-hidden />}>
            No failed n8n runs, sync failures, overdue follow-ups, bounce spikes or daily-limit breaches right now.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {open.map((a) => (
              <AlertItem key={a.id} a={a} />
            ))}
          </ul>
        )}
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card title="What raises an alert" subtitle="Each rule runs every 5 minutes against the synced data">
          <ul className="space-y-2.5 text-[13px] text-ink-2">
            <li>
              <b className="text-ink">n8n run failed</b>: the latest run of a tracked sender workflow ended in error (last 7 days), with n8n&rsquo;s error message. Critical.
            </li>
            <li>
              <b className="text-ink">Sync failure</b>: a mailbox, spreadsheet, n8n or WhatsApp sync returned an error. Critical when there has been no successful sync for 6 hours.
              &ldquo;Not connected&rdquo; is a setup state, not an alert.
            </li>
            <li>
              <b className="text-ink">Overdue follow-ups</b>: follow-ups whose due date is more than {settings.overdueGraceDays} day(s) in the past and were not sent. Critical after 7 days.
            </li>
            <li>
              <b className="text-ink">Bounce spike</b>: per sending domain, at least {settings.bounceMinCount} bounces in 24 h and either ≥ {settings.bounceRatePct}% of its sends in the last 48 h,
              or ≥ {settings.bounceSpikeMultiplier}× its usual daily bounces. Critical at twice the rate.
            </li>
            <li>
              <b className="text-ink">Daily limit</b>: a mailbox or domain reached its warning level (warning) or went over its limit (critical). Set limits on{' '}
              <Link href="/sending" className="link">
                Sending volume
              </Link>
              .
            </li>
          </ul>
          <p className="mt-3 text-[12px] text-ink-3">Alerts only inform. The dashboard never pauses, sends or changes anything in n8n.</p>
        </Card>

        <Card title="Alert settings">
          <form action={saveAlertSettings} className="grid grid-cols-1 gap-3 text-[13px] sm:grid-cols-2">
            <label className="block">
              Minimum bounces in 24 h
              <input name="bounceMinCount" type="number" min={1} max={1000} defaultValue={settings.bounceMinCount} className="field mt-1 w-full" />
            </label>
            <label className="block">
              Bounce rate threshold (%)
              <input name="bounceRatePct" type="number" min={0.5} max={100} step={0.5} defaultValue={settings.bounceRatePct} className="field mt-1 w-full" />
            </label>
            <label className="block">
              Spike vs usual (× daily average)
              <input name="bounceSpikeMultiplier" type="number" min={1.5} max={50} step={0.5} defaultValue={settings.bounceSpikeMultiplier} className="field mt-1 w-full" />
            </label>
            <label className="block">
              Follow-up grace period (days)
              <input name="overdueGraceDays" type="number" min={0} max={30} defaultValue={settings.overdueGraceDays} className="field mt-1 w-full" />
            </label>
            <label className="flex items-start gap-2 sm:col-span-2">
              <input name="notifyN8n" type="checkbox" defaultChecked={settings.notifyN8n} className="mt-0.5" disabled={!bridgeReady} />
              <span>
                Send new alerts to n8n (webhook <code>outreach-dashboard-alerts</code>, same header key as the data bridge), so an n8n workflow can email or WhatsApp you.
                {!bridgeReady && <span className="block text-ink-3">Needs N8N_BASE_URL and N8N_BRIDGE_KEY.</span>}
              </span>
            </label>
            <div className="sm:col-span-2">
              <button className="btn btn-primary">Save settings</button>
            </div>
          </form>
          {settings.notifyN8n && (
            <div className="mt-3">
              <Notice>
                Alerts are posted to n8n once each (again if a warning becomes critical). The n8n workflow &ldquo;Outreach Dashboard — Alerts&rdquo; emails them to you, and only
                while it is active in n8n (it was created inactive). If n8n cannot be reached, the error shows on Integrations and the alerts are retried.
              </Notice>
            </div>
          )}
        </Card>
      </div>

      <Card title="Resolved in the last 30 days" className="mt-4" pad={false}>
        {resolved.length === 0 ? (
          <EmptyState title="No resolved alerts yet" />
        ) : (
          <div className="overflow-x-auto">
            <table className="table-compact w-full min-w-[760px]">
              <thead>
                <tr>
                  <th>Alert</th>
                  <th>Severity</th>
                  <th>Opened</th>
                  <th>Resolved</th>
                </tr>
              </thead>
              <tbody>
                {resolved.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <div className="font-medium">{a.title}</div>
                      <div className="text-[11.5px] text-ink-3">{KIND_LABEL[a.kind] ?? a.kind}</div>
                    </td>
                    <td>
                      <Severity severity={a.severity} />
                    </td>
                    <td className="whitespace-nowrap">{formatDateTime(a.firstSeenAt)}</td>
                    <td className="whitespace-nowrap">{a.resolvedAt ? formatDateTime(a.resolvedAt) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
