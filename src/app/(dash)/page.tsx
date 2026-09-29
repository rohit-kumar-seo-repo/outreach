import Link from 'next/link';
import { AlarmClock, CalendarClock, CheckCheck, Inbox, Megaphone, MessageSquareReply, Send, ShieldAlert, Users, XCircle } from 'lucide-react';
import { ActivityCharts } from '@/components/ActivityCharts';
import { FilterBar } from '@/components/FilterBar';
import { Card, fmt, KpiCard, Notice, PageHeader, SyncState, Tip } from '@/components/ui';
import { alertCounts } from '@/lib/alerts';
import { campaignOptions, mailboxOptions } from '@/lib/metrics/campaigns';
import { parseFilters } from '@/lib/metrics/filters';
import { dailyActivity, deliveryFunnel, integrationStatuses, overviewKpis } from '@/lib/metrics/overview';
import { formatDateTime, localDate, relativeTime } from '@/lib/time';

export const metadata = { title: 'Overview' };

export default async function OverviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const f = parseFilters(await searchParams);
  const [kpis, activity, funnel, integrations, campaigns, mailboxes, alerts] = await Promise.all([
    overviewKpis(f),
    dailyActivity(f),
    deliveryFunnel(f),
    integrationStatuses(),
    campaignOptions(),
    mailboxOptions(),
    alertCounts(),
  ]);
  const byKey = new Map(integrations.map((i) => [i.key, i]));
  const n8n = byKey.get('n8n:executions');
  const bridge = byKey.get('n8n:bridge');
  const noN8n = !n8n || n8n.status !== 'ok';
  const noSheets = !bridge || bridge.status !== 'ok';
  const mailboxRows = integrations.filter((i) => i.kind === 'mailbox');
  const mailboxOk = mailboxRows.filter((m) => m.status === 'ok').length;
  const noMail = mailboxOk === 0;
  const lastSync = integrations.map((i) => i.lastSuccessAt).filter(Boolean).sort((a, b) => b!.getTime() - a!.getTime())[0] ?? null;

  const sendsNote = noN8n && kpis.sentToday === 0 ? 'Not connected — n8n API key needed' : null;
  const sheetsNote = noSheets && kpis.remainingLeads === 0 ? 'Not connected — n8n Data Bridge needed' : null;
  const mailNote = noMail && kpis.repliesToday === 0 ? 'Not connected — mailbox credentials needed' : null;

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle={
          <>
            Today is {kpis.today} ({process.env.APP_TIMEZONE ?? 'Asia/Kolkata'}). Last successful sync {lastSync ? relativeTime(lastSync) : 'never'}.
          </>
        }
      />
      <FilterBar
        today={localDate()}
        campaigns={campaigns.map((c) => ({ value: c.slug, label: c.name }))}
        domains={[...new Set(mailboxes.map((m) => m.domain))]}
        mailboxes={mailboxes.map((m) => m.address)}
      />

      {alerts.critical + alerts.warning > 0 && (
        <div className="mb-5">
          <Notice tone={alerts.critical ? 'critical' : 'warn'} title={`${alerts.critical + alerts.warning} open alert${alerts.critical + alerts.warning === 1 ? '' : 's'}`}>
            {alerts.critical ? `${alerts.critical} critical` : ''}
            {alerts.critical && alerts.warning ? ', ' : ''}
            {alerts.warning ? `${alerts.warning} warning${alerts.warning === 1 ? '' : 's'}` : ''}: failed n8n runs, sync failures, overdue follow-ups, bounce spikes or daily limits.{' '}
            <Link href="/alerts" className="link font-medium">
              Review alerts →
            </Link>
          </Notice>
        </div>
      )}

      {(noN8n || noSheets || noMail) && (
        <div className="mb-5">
          <Notice tone="warn" title="Some data sources are not connected yet">
            Numbers below only include connected sources; anything unavailable shows &ldquo;—&rdquo;.{' '}
            {[noN8n && 'n8n send events', noSheets && 'spreadsheets', noMail && 'mailboxes'].filter(Boolean).join(', ')} still need credentials on the server.{' '}
            <Link href="/integrations" className="link font-medium">
              See what is needed →
            </Link>
          </Notice>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4 xl:grid-cols-5">
        <KpiCard
          label="Emails sent today"
          value={fmt(kpis.sentToday)}
          sub="Original emails accepted by the server"
          tip="Unique original (step 0) emails the SMTP server or Hostinger API accepted today. Accepted ≠ delivered to the inbox."
          icon={<Send size={15} aria-hidden />}
          tone="brand"
          unavailable={sendsNote}
        />
        <KpiCard
          label="Scheduled for tomorrow"
          value={fmt(kpis.scheduledTomorrow + kpis.scheduledTomorrowFollowups)}
          sub={`${fmt(kpis.scheduledTomorrow)} original · ${fmt(kpis.scheduledTomorrowFollowups)} follow-up`}
          tip="Rows approved in a sheet with a send date/time falling tomorrow. WhatsApp daily-limit picks are not schedules and are not counted."
          icon={<CalendarClock size={15} aria-hidden />}
          unavailable={sheetsNote}
        />
        <KpiCard
          label="Replies today"
          value={fmt(kpis.repliesToday)}
          sub={`${fmt(kpis.repliesTodayWhatsapp)} WhatsApp replies today`}
          tip="Inbound emails matched to a contacted lead (thread header or sender address). Auto-replies and bounces are excluded."
          icon={<MessageSquareReply size={15} aria-hidden />}
          tone="good"
          href="/inbox?kind=replies"
          unavailable={mailNote}
        />
        <KpiCard
          label="Follow-ups sent today"
          value={fmt(kpis.followupsToday)}
          sub="Follow-up steps accepted by the server"
          tip="Unique follow-up steps (step ≥ 1) accepted today."
          icon={<CheckCheck size={15} aria-hidden />}
          tone="teal"
          unavailable={sendsNote}
        />
        <KpiCard
          label="Follow-ups due / overdue"
          value={
            <>
              {fmt(kpis.followupsDueToday)} <span className="text-base font-medium text-ink-3">/ {fmt(kpis.followupsOverdue)}</span>
            </>
          }
          sub={`${fmt(kpis.flaggedThreadsDue)} inbox threads flagged for follow-up`}
          tip="Leads whose next sequence step (or manual follow-up date) is due today / was due before today and who have not replied."
          icon={<AlarmClock size={15} aria-hidden />}
          tone="warn"
          href="/leads?followup=due"
        />
        <KpiCard
          label="Bounces / failed today"
          value={
            <>
              {fmt(kpis.bouncesToday)} <span className="text-base font-medium text-ink-3">/ {fmt(kpis.failedToday)}</span>
            </>
          }
          sub="Bounce reports · rejected send attempts"
          tip="Bounces = non-delivery reports found in the mailboxes. Failed = attempts the server/API rejected (from n8n)."
          icon={<XCircle size={15} aria-hidden />}
          tone="critical"
        />
        <KpiCard
          label="Active campaigns"
          value={fmt(kpis.activeCampaigns)}
          sub={
            kpis.campaignStatusUnknown > 0
              ? `${kpis.campaignStatusUnknown} with unknown status (n8n not connected)`
              : `${fmt(kpis.campaignsWithSends7d)} sent in the last 7 days`
          }
          tip="Campaigns whose n8n send workflow is active."
          icon={<Megaphone size={15} aria-hidden />}
          href="/campaigns"
        />
        <KpiCard
          label="Leads ready to contact"
          value={fmt(kpis.readyLeads + kpis.queuedLeads)}
          sub={`${fmt(kpis.queuedLeads)} queued · ${fmt(kpis.awaitingApproval)} awaiting approval`}
          tip="Ready (valid, uncontacted, picked up automatically) + Queued (approved with a send date). Excludes duplicates, invalid and suppressed leads."
          icon={<Users size={15} aria-hidden />}
          tone="brand"
          href="/leads?status=ready"
          unavailable={sheetsNote}
        />
        <KpiCard
          label="Spreadsheet leads remaining"
          value={fmt(kpis.remainingLeads)}
          sub={`${fmt(kpis.needsDraft)} still need a draft`}
          tip="Rows still in the sheets that have never been contacted and are usable: ready + queued + awaiting approval + needs draft + failed-never-sent."
          icon={<ShieldAlert size={15} aria-hidden />}
          href="/spreadsheets"
          unavailable={sheetsNote}
        />
        <KpiCard
          label="Unmatched inbound (30 d)"
          value={fmt(kpis.unmatchedInbound)}
          sub="Emails not linked to a lead"
          tip="Inbound messages (not spam/trash) the dashboard could not reliably match to a lead or campaign. Assign them in the inbox."
          icon={<Inbox size={15} aria-hidden />}
          href="/inbox?match=unmatched"
          unavailable={mailNote}
        />
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Card
          className="xl:col-span-2"
          title="Daily activity"
          subtitle={`${f.from} → ${f.to} · ${process.env.APP_TIMEZONE ?? 'Asia/Kolkata'} days · accepted sends, matched replies, bounces, failed attempts`}
        >
          <ActivityCharts points={activity.points} unknownDated={activity.unknownDated} />
        </Card>

        <div className="flex flex-col gap-5">
          <Card
            title={
              <span className="flex items-center gap-1.5">
                Delivery funnel <Tip text="For sends in the selected range. An SMTP/API acceptance only means the server queued the message. Email delivery is only confirmed when the recipient replies; WhatsApp when WAHA reports a delivered (2) or read (3) tick." />
              </span>
            }
            subtitle="Scheduled → attempted → accepted → bounced / confirmed"
          >
            <dl className="space-y-2 text-[13px]">
              {[
                ['Scheduled (upcoming)', funnel.scheduledUpcoming, 'Approved rows with a future send time'],
                ['Attempted', funnel.attempted, 'A workflow tried to send'],
                ['Accepted by server', funnel.accepted, 'SMTP 250 / API 2xx / WAHA message key'],
                ['Failed (never accepted)', funnel.failed, 'Rejected on every attempt'],
                ['Bounced after acceptance', funnel.bounced, 'Bounce report within 14 days'],
                ['Delivery confirmed', funnel.confirmedByReply + funnel.confirmedWhatsappAck, 'Email: recipient replied · WhatsApp: delivered/read tick'],
                ['Accepted, delivery unverified', funnel.unverified, 'No bounce, no confirmation — the normal state for email'],
              ].map(([label, n, help]) => (
                <div key={String(label)} className="flex items-baseline justify-between gap-3 border-b border-line pb-2 last:border-0 last:pb-0">
                  <div>
                    <dt className="font-medium text-ink">{label}</dt>
                    <dd className="text-[11.5px] text-ink-3">{help}</dd>
                  </div>
                  <dd className="text-base font-semibold text-ink tabular">{fmt(Number(n))}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card title="Integrations" subtitle="Connection and last successful sync" actions={<Link href="/integrations" className="link text-xs">Details</Link>}>
            <ul className="space-y-2 text-[13px]">
              {[
                ['n8n send events', n8n],
                ['Spreadsheets (n8n bridge)', bridge],
                ['WhatsApp (WAHA)', byKey.get('waha')],
              ].map(([label, s]) => {
                const st = s as (typeof integrations)[number] | undefined;
                return (
                  <li key={String(label)} className="flex items-center justify-between gap-2">
                    <span className="text-ink">{String(label)}</span>
                    <span className="flex items-center gap-2">
                      <span className="text-[11px] text-ink-3" title={st?.lastSuccessAt ? formatDateTime(st.lastSuccessAt) : undefined}>
                        {st?.lastSuccessAt ? relativeTime(st.lastSuccessAt) : ''}
                      </span>
                      <SyncState status={st?.status ?? 'never'} />
                    </span>
                  </li>
                );
              })}
              <li className="flex items-center justify-between gap-2">
                <span className="text-ink">Mailboxes</span>
                <span className="text-[12px] text-ink-2 tabular">
                  {mailboxOk} of {mailboxRows.length} connected
                </span>
              </li>
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
