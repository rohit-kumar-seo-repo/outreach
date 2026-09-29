import Link from 'next/link';
import { Card, EmptyState, fmt, Notice, PageHeader, Pill, RateCell } from '@/components/ui';
import { one } from '@/lib/db';
import { campaignStats } from '@/lib/metrics/campaigns';
import { waChat, waConversations, waSessions } from '@/lib/metrics/whatsapp';
import { formatDateTime, relativeTime } from '@/lib/time';

export const metadata = { title: 'WhatsApp' };

export default async function WhatsAppPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const [sessions, conversations, stats, src] = await Promise.all([
    waSessions(),
    waConversations(),
    campaignStats().then((r) => r.filter((c) => c.channel === 'whatsapp')),
    one<{ last_status: string | null; last_error: string | null; last_success_at: Date | null }>(`select last_status, last_error, last_success_at from sources where key = 'waha'`),
  ]);
  const chat = sp.chat ? await waChat(sp.chat) : [];
  const wahaOk = src?.last_status === 'ok';
  const anyData = stats.some((s) => s.contacted > 0 || s.leadsLoaded > 0) || conversations.length > 0;

  return (
    <>
      <PageHeader title="WhatsApp" subtitle="Outreach sent through WAHA (self-hosted WhatsApp HTTP API) by the n8n WAHA workflows, and the replies that came back." />
      {!wahaOk && (
        <div className="mb-4">
          <Notice tone="warn" title="WAHA chat history is not connected">
            Send events still come from the n8n WAHA workflows once the n8n API key is set, and inbound messages come from the “WAHA - Incoming Message Webhook” executions. To
            show full conversations and delivered/read ticks, set <code>WAHA_BASE_URL</code> and <code>WAHA_API_KEY</code> on the server.
            {src?.last_error ? ` Last error: ${src.last_error}` : ''}
          </Notice>
        </div>
      )}
      {!anyData && (
        <div className="mb-4">
          <Notice>No WhatsApp data yet. Counts stay empty until a source is connected; nothing is estimated.</Notice>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {stats.map((c) => (
          <Card key={c.slug} title={<Link href={`/campaigns/${c.slug}`} className="link">{c.name}</Link>} subtitle={`Session: ${String(c.config.waSession ?? '—')}`}>
            <dl className="grid grid-cols-2 gap-y-1.5 text-[13px]">
              <dt className="text-ink-2">Leads loaded</dt>
              <dd className="text-right tabular">{fmt(c.leadsLoaded)}</dd>
              <dt className="text-ink-2">Messages accepted</dt>
              <dd className="text-right tabular">{fmt(c.originalsSent)}</dd>
              <dt className="text-ink-2">Failed</dt>
              <dd className="text-right tabular">{fmt(c.failedNeverAccepted)}</dd>
              <dt className="text-ink-2">Remaining</dt>
              <dd className="text-right tabular">{fmt(c.remaining)}</dd>
              <dt className="text-ink-2">Reply rate</dt>
              <dd className="text-right">
                <RateCell num={c.repliedLeads} den={c.contacted} />
              </dd>
            </dl>
          </Card>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(300px,380px)_1fr]">
        <div className="space-y-4">
          <Card title="Sessions" subtitle={src?.last_success_at ? `Checked ${relativeTime(src.last_success_at)}` : 'Not checked yet'}>
            {sessions.length === 0 ? (
              <p className="text-sm text-ink-3">No session data (WAHA not connected).</p>
            ) : (
              <ul className="space-y-1.5 text-[13px]">
                {sessions.map((s) => (
                  <li key={s.name} className="flex items-center justify-between">
                    <span>
                      {s.name} {s.phone && <span className="text-ink-3">· +{s.phone}</span>}
                    </span>
                    <Pill tone={s.status === 'WORKING' ? 'good' : 'critical'}>{s.status ?? 'unknown'}</Pill>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Conversations" subtitle="Chats with outreach leads only (personal chats are never synced)" pad={false}>
            {conversations.length === 0 ? (
              <EmptyState title="No conversations recorded" />
            ) : (
              <ul className="max-h-[60vh] divide-y divide-line overflow-y-auto">
                {conversations.map((c) => (
                  <li key={`${c.session}:${c.chatId}`}>
                    <Link href={`/whatsapp?chat=${encodeURIComponent(c.chatId)}`} className={`block px-4 py-2.5 hover:bg-slate-50 ${sp.chat === c.chatId ? 'bg-brand-50' : ''}`}>
                      <div className="flex justify-between gap-2 text-[13px]">
                        <span className="truncate font-medium">{c.leadName ?? `+${c.chatId.replace('@c.us', '')}`}</span>
                        <span className="text-[11px] text-ink-3">{relativeTime(c.lastAt)}</span>
                      </div>
                      <div className="truncate text-[12px] text-ink-2">
                        {c.lastFromMe ? 'You: ' : ''}
                        {c.lastBody ?? '(media)'}
                      </div>
                      <div className="mt-0.5 flex gap-1">
                        {c.inbound > 0 && <Pill tone="good">{c.inbound} inbound</Pill>}
                        {c.campaignName && <Pill>{c.campaignName}</Pill>}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <Card title={sp.chat ? `+${sp.chat.replace('@c.us', '')}` : 'Conversation'} pad={false}>
          {chat.length === 0 ? (
            <EmptyState title="Select a conversation" />
          ) : (
            <ul className="max-h-[70vh] space-y-2 overflow-y-auto p-4 text-[13px]">
              {chat.map((m) => (
                <li key={m.id} className={`max-w-[80%] rounded-lg px-3 py-2 ${m.fromMe ? 'ml-auto bg-brand-50' : 'bg-slate-100'}`}>
                  <div className="whitespace-pre-wrap">{m.body ?? (m.hasMedia ? '(media)' : '')}</div>
                  <div className="mt-1 text-[11px] text-ink-3">
                    {formatDateTime(m.sentAt)} · {m.session}
                    {m.fromMe && m.ack !== null ? ` · ${['pending', 'sent', 'delivered', 'read', 'played'][m.ack] ?? m.ack}` : ''}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
