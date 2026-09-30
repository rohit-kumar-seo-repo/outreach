import Link from 'next/link';
import { AlertTriangle, MessageSquareWarning, PauseCircle, Users, WifiOff } from 'lucide-react';
import { Card, EmptyState, fmt, KpiCard, Notice, PageHeader, Pill } from '@/components/ui';
import { env } from '@/lib/env';
import { one } from '@/lib/db';
import { campaignStats } from '@/lib/metrics/campaigns';
import { listTemplates } from '@/lib/whatsapp/templates';
import { waAttention, waConversations, type WaConversation } from '@/lib/metrics/whatsapp';
import { formatPhone } from '@/lib/normalize';
import { addDays, localDate, relativeTime } from '@/lib/time';

export const metadata = { title: 'WhatsApp' };

function chatTitle(c: WaConversation): string {
  return c.leadName || c.contactName || formatPhone(c.phone) || 'Unknown business (number hidden)';
}

export default async function WhatsAppOverviewPage() {
  const today = localDate();
  const yesterday = addDays(today, -1);
  const [attention, stats, conversations, templates, src, deltas] = await Promise.all([
    waAttention(),
    campaignStats().then((r) => r.filter((c) => c.channel === 'whatsapp')),
    waConversations(30),
    listTemplates(),
    one<{ last_status: string | null; last_error: string | null; last_success_at: Date | null }>(`select last_status, last_error, last_success_at from sources where key = 'waha'`),
    one<{ acceptedToday: number; acceptedYesterday: number; repliesToday: number; repliesYesterday: number }>(
      `select
         (select count(*)::int from send_attempts where channel = 'whatsapp' and result = 'accepted' and (coalesce(occurred_at, now()) at time zone $1)::date = $2::date) as "acceptedToday",
         (select count(*)::int from send_attempts where channel = 'whatsapp' and result = 'accepted' and (coalesce(occurred_at, now()) at time zone $1)::date = $3::date) as "acceptedYesterday",
         (select count(*)::int from wa_messages where not from_me and not is_auto and (sent_at at time zone $1)::date = $2::date) as "repliesToday",
         (select count(*)::int from wa_messages where not from_me and not is_auto and (sent_at at time zone $1)::date = $3::date) as "repliesYesterday"`,
      [env.timezone, today, yesterday],
    ),
  ]);
  const wahaOk = src?.last_status === 'ok';
  const anyData = stats.some((s) => s.contacted > 0 || s.leadsLoaded > 0) || conversations.length > 0;
  const recentReplies = conversations.filter((c) => c.inbound > 0 && !c.lastFromMe).slice(0, 6);
  const delta = (a: number, b: number) => (b === 0 ? null : Math.round(((a - b) / b) * 100));
  const acceptedDelta = deltas ? delta(deltas.acceptedToday, deltas.acceptedYesterday) : null;
  const repliesDelta = deltas ? delta(deltas.repliesToday, deltas.repliesYesterday) : null;

  return (
    <>
      <PageHeader title="Overview" subtitle="What needs your attention today, across every WhatsApp account and campaign." />
      {!wahaOk && (
        <div className="mb-4">
          <Notice tone="warn" title="WAHA chat history is not connected">
            Send events still come from the n8n WAHA workflows once the n8n API key is set, and inbound messages come from the "WAHA - Incoming Message Webhook" executions. To
            show full conversations, delivered/read ticks and account health, set <code>WAHA_BASE_URL</code> and <code>WAHA_API_KEY</code> on the server.
            {src?.last_error ? ` Last error: ${src.last_error}` : ''}
          </Notice>
        </div>
      )}
      {!anyData && (
        <div className="mb-4">
          <Notice>No WhatsApp data yet. Counts stay empty until a source is connected; nothing is estimated.</Notice>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard
          label="Messages accepted today"
          value={fmt(deltas?.acceptedToday ?? 0)}
          sub={acceptedDelta !== null ? `${acceptedDelta >= 0 ? '+' : ''}${acceptedDelta}% vs yesterday (${fmt(deltas?.acceptedYesterday ?? 0)})` : `Yesterday: ${fmt(deltas?.acceptedYesterday ?? 0)}`}
        />
        <KpiCard
          label="Human replies today"
          value={fmt(deltas?.repliesToday ?? 0)}
          sub={repliesDelta !== null ? `${repliesDelta >= 0 ? '+' : ''}${repliesDelta}% vs yesterday (${fmt(deltas?.repliesYesterday ?? 0)})` : `Yesterday: ${fmt(deltas?.repliesYesterday ?? 0)}`}
          tone="good"
        />
        <KpiCard
          label="Needs your attention"
          value={fmt(attention.needsReply + attention.campaigns.length + attention.disconnectedSessions.length)}
          sub={`${attention.needsReply} repl${attention.needsReply === 1 ? 'y' : 'ies'} · ${attention.campaigns.length} campaign issue(s) · ${attention.disconnectedSessions.length} account issue(s)`}
          tone={attention.needsReply + attention.campaigns.length + attention.disconnectedSessions.length > 0 ? 'warn' : 'good'}
          href="/whatsapp/inbox"
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Needs your attention" pad={false}>
          <ul className="divide-y divide-line">
            {attention.needsReply > 0 && (
              <AttentionRow icon={<Users size={16} />} href="/whatsapp/inbox?view=needs_reply" text={`${attention.needsReply} conversation(s) waiting for your reply`} />
            )}
            {attention.followupsOverdue > 0 && <AttentionRow icon={<AlertTriangle size={16} />} href="/leads?followup=overdue" text={`${attention.followupsOverdue} follow-up(s) overdue`} />}
            {attention.followupsDueToday > 0 && <AttentionRow icon={<AlertTriangle size={16} />} href="/leads?followup=today" text={`${attention.followupsDueToday} follow-up(s) due today`} />}
            {attention.failedSendsToday > 0 && <AttentionRow icon={<MessageSquareWarning size={16} />} href="/whatsapp/reports" text={`${attention.failedSendsToday} send(s) failed today`} />}
            {attention.disconnectedSessions.map((s) => (
              <AttentionRow key={s.name} icon={<WifiOff size={16} />} href="/whatsapp/accounts" text={`Account "${s.name}" is ${s.status ?? 'not connected'}`} />
            ))}
            {attention.campaigns.map((c) => (
              <AttentionRow
                key={c.slug}
                icon={<PauseCircle size={16} />}
                href={`/whatsapp/campaigns/${c.slug}`}
                text={`${c.name}: ${c.detail}`}
              />
            ))}
            {attention.workflowErrors.map((w) => (
              <AttentionRow key={w.workflowId} icon={<AlertTriangle size={16} />} href="/integrations" text={`${w.name ?? w.workflowId}: ${w.failures} failed run(s) in 24h`} />
            ))}
            {attention.needsReply === 0 &&
              attention.followupsOverdue === 0 &&
              attention.followupsDueToday === 0 &&
              attention.failedSendsToday === 0 &&
              attention.disconnectedSessions.length === 0 &&
              attention.campaigns.length === 0 &&
              attention.workflowErrors.length === 0 && <EmptyState title="Nothing needs attention right now" />}
          </ul>
        </Card>

        <Card title="Sent today & next run" subtitle="Real counts from recorded sends; the next run's size is capped by your daily limit, not a schedule." pad={false}>
          {attention.volume.length === 0 ? (
            <EmptyState title="No WhatsApp campaigns configured" />
          ) : (
            <table className="table-compact w-full">
              <thead>
                <tr>
                  <th>Campaign</th>
                  <th>Account</th>
                  <th className="text-right">Sent today</th>
                  <th className="text-right">Daily cap</th>
                </tr>
              </thead>
              <tbody>
                {attention.volume.map((v) => (
                  <tr key={v.campaignSlug}>
                    <td>
                      <Link href={`/whatsapp/campaigns/${v.campaignSlug}`} className="link">
                        {v.campaignName}
                      </Link>
                    </td>
                    <td className="text-ink-2">{v.session}</td>
                    <td className="text-right tabular">{fmt(v.sentToday)}</td>
                    <td className="text-right tabular">{v.dailyCap ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_minmax(280px,360px)]">
        <Card title="Campaigns" subtitle="Full controls, funnel and reconciliation on the Campaigns tab." actions={<Link href="/whatsapp/campaigns" className="link text-[13px]">View all →</Link>} pad={false}>
          {stats.length === 0 ? (
            <EmptyState title="No WhatsApp campaigns configured" />
          ) : (
            <table className="table-compact w-full">
              <thead>
                <tr>
                  <th>Campaign</th>
                  <th className="text-right">Accepted</th>
                  <th className="text-right">Replies</th>
                  <th className="text-right">Remaining</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {stats.map((c) => (
                  <tr key={c.slug}>
                    <td>
                      <Link href={`/whatsapp/campaigns/${c.slug}`} className="link font-medium">
                        {c.name}
                      </Link>
                    </td>
                    <td className="text-right tabular">{fmt(c.originalsSent)}</td>
                    <td className="text-right tabular">{fmt(c.repliedLeads)}</td>
                    <td className="text-right tabular">{fmt(c.remaining)}</td>
                    <td>
                      <Pill tone={c.status === 'active' ? 'good' : c.status === 'paused' ? 'default' : 'warn'}>{c.status}</Pill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <div className="space-y-4">
          <Card title="Message templates" subtitle={`${templates.length} saved`} actions={<Link href="/whatsapp/templates" className="link text-[13px]">Manage →</Link>}>
            {templates.length === 0 ? (
              <p className="text-[13px] text-ink-2">No templates yet. Create one to reuse across campaigns.</p>
            ) : (
              <ul className="space-y-1.5 text-[13px]">
                {templates.slice(0, 4).map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-2">
                    <span className="truncate">{t.name}</span>
                    <Pill tone={t.kind === 'text' ? 'default' : 'brand'}>{t.kind}</Pill>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <div className="mt-4">
        <Card title="Recent replies" subtitle="Auto-replies are excluded from this list and from human reply counts." actions={<Link href="/whatsapp/inbox" className="link text-[13px]">Open inbox →</Link>} pad={false}>
          {recentReplies.length === 0 ? (
            <EmptyState title="No human replies recorded yet" />
          ) : (
            <ul className="divide-y divide-line">
              {recentReplies.map((c) => (
                <li key={`${c.session}:${c.chatId}`}>
                  <Link href={`/whatsapp/inbox?chat=${encodeURIComponent(c.chatId)}&session=${encodeURIComponent(c.session)}`} className="flex items-center justify-between gap-3 px-4 py-2.5 hover:bg-slate-50">
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-medium">{chatTitle(c)}</div>
                      <div className="truncate text-[12px] text-ink-3">{c.lastBody ?? '(media)'}</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2 text-[11px] text-ink-3">
                      {c.campaignName ? <Pill tone="brand">{c.campaignName}</Pill> : <Pill tone="warn">No lead match</Pill>}
                      {relativeTime(c.lastAt)}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

function AttentionRow({ icon, href, text }: { icon: React.ReactNode; href: string; text: string }) {
  return (
    <li>
      <Link href={href} className="flex items-center gap-3 px-4 py-2.5 text-[13px] hover:bg-slate-50">
        <span className="text-warn">{icon}</span>
        <span className="flex-1">{text}</span>
      </Link>
    </li>
  );
}
