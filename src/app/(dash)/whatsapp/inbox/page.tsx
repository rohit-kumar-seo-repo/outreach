import Link from 'next/link';
import { markWaHandled } from '@/app/actions/whatsapp';
import { Card, EmptyState, Pill } from '@/components/ui';
import { WaClassifyMenu } from '@/components/whatsapp/WaClassifyMenu';
import { WaInboxFilters } from '@/components/whatsapp/WaInboxFilters';
import { WaOpenEffects } from '@/components/whatsapp/WaOpenEffects';
import { WaReplyComposer } from '@/components/whatsapp/WaReplyComposer';
import { randomUUID } from 'node:crypto';
import { campaignOptions } from '@/lib/metrics/campaigns';
import { waSessions } from '@/lib/metrics/whatsapp';
import { formatPhone } from '@/lib/normalize';
import { formatDateTime, relativeTime } from '@/lib/time';
import { listWaThreads, waInboxCounts, waThreadContext, waThreadMessages, WA_VIEWS, type WaThreadRow, type WaView } from '@/lib/whatsapp/inbox';

export const metadata = { title: 'WhatsApp inbox' };

const VIEW_LABELS: Record<WaView, string> = { needs_reply: 'Needs reply', all: 'All', unread: 'Unread', auto_replies: 'Auto-replies' };

function chatTitle(t: Pick<WaThreadRow, 'leadName' | 'contactName' | 'phone'>): string {
  return t.leadName || t.contactName || formatPhone(t.phone) || 'Unknown business (number hidden)';
}

export default async function WaInboxPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const view = (WA_VIEWS as readonly string[]).includes(sp.view ?? '') ? (sp.view as WaView) : 'needs_reply';
  const base = { session: sp.account || null, campaign: sp.campaign || null, from: sp.from || null, to: sp.to || null, search: sp.q || null };
  const [threads, counts, sessions, campaigns] = await Promise.all([
    listWaThreads({ ...base, view }),
    waInboxCounts(base),
    waSessions(),
    campaignOptions().then((r) => r.filter((c) => c.channel === 'whatsapp')),
  ]);
  const openChat = sp.openChat ?? null;
  const openSession = sp.openSession ?? null;
  const [context, messages] = openChat && openSession ? await Promise.all([waThreadContext(openSession, openChat), waThreadMessages(openSession, openChat)]) : [null, []];
  const openThread = openChat && openSession ? threads.find((t) => t.chatId === openChat && t.session === openSession) : undefined;
  const sessionOk = sessions.find((s) => s.name === openSession)?.status === 'WORKING';

  function hrefFor(patch: Record<string, string | undefined>): string {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...patch })) if (v) u.set(k, v);
    const s = u.toString();
    return `/whatsapp/inbox${s ? `?${s}` : ''}`;
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <nav className="flex gap-1" aria-label="Views">
          {WA_VIEWS.map((v) => (
            <Link
              key={v}
              href={hrefFor({ view: v, openChat: undefined, openSession: undefined })}
              className={`rounded-full px-3 py-1.5 text-[12.5px] font-medium ${view === v ? 'bg-brand text-white' : 'bg-white text-ink-2 ring-1 ring-line hover:bg-slate-50'}`}
            >
              {VIEW_LABELS[v]} {counts[v] > 0 ? <span className="tabular">({counts[v]})</span> : null}
            </Link>
          ))}
        </nav>
      </div>
      <div className="mb-4">
        <WaInboxFilters accounts={sessions.map((s) => s.name)} campaigns={campaigns} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(300px,380px)_1fr]">
        <Card pad={false}>
          {threads.length === 0 ? (
            <EmptyState title="Nothing here" />
          ) : (
            <ul className="max-h-[70vh] divide-y divide-line overflow-y-auto">
              {threads.map((t) => {
                const active = t.chatId === openChat && t.session === openSession;
                return (
                  <li key={`${t.session}:${t.chatId}`}>
                    <Link
                      href={hrefFor({ view, openChat: t.chatId, openSession: t.session })}
                      className={`block px-4 py-2.5 hover:bg-slate-50 ${active ? 'bg-brand-50' : ''}`}
                    >
                      <div className="flex justify-between gap-2 text-[13px]">
                        <span className={`truncate ${t.unread ? 'font-semibold' : 'font-medium'}`}>{chatTitle(t)}</span>
                        <span className="shrink-0 text-[11px] text-ink-3">{relativeTime(t.lastAt)}</span>
                      </div>
                      <div className="truncate text-[12px] text-ink-2">
                        {t.lastFromMe ? 'You: ' : t.lastIsAuto ? 'Auto-reply: ' : ''}
                        {t.lastBody ?? '(media)'}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1">
                        {t.needsReply && <Pill tone="warn">Needs reply</Pill>}
                        {t.autoReplies > 0 && <Pill title="Automatic greeting/away message, excluded from human reply counts.">{t.autoReplies} auto</Pill>}
                        {t.campaignName ? <Pill tone="brand">{t.campaignName}</Pill> : <Pill>No lead match</Pill>}
                        <span className="text-[11px] text-ink-3">{t.session}</span>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {!openChat || !openSession ? (
          <Card>
            <EmptyState title="Select a conversation" />
          </Card>
        ) : !context ? (
          <Card>
            <EmptyState title="Conversation not found" />
          </Card>
        ) : (
          <div className="space-y-3">
            <WaOpenEffects session={openSession} chatId={openChat} unread={openThread?.unread ?? false} />
            <Card
              title={chatTitle({ leadName: context.leadName, contactName: context.contactName, phone: context.phone })}
              subtitle={
                <>
                  {context.hiddenNumber ? 'Number hidden by WhatsApp (privacy ID)' : formatPhone(context.phone) ?? context.phone}
                  {context.leadId && (
                    <>
                      {' · '}
                      <Link href={`/leads/${context.leadId}`} className="link">
                        Lead
                      </Link>
                      {context.campaignName ? ` in ${context.campaignName}` : ''}
                    </>
                  )}
                  {context.city ? ` · ${context.city}` : ''}
                </>
              }
              actions={
                <div className="flex items-center gap-2">
                  <WaClassifyMenu session={openSession} chatId={openChat} />
                  <form action={markWaHandled}>
                    <input type="hidden" name="session" value={openSession} />
                    <input type="hidden" name="chatId" value={openChat} />
                    <input type="hidden" name="undo" value={context.handledAt ? '1' : '0'} />
                    <button type="submit" className="btn btn-sm">
                      {context.handledAt ? 'Reopen' : 'No reply needed'}
                    </button>
                  </form>
                  {context.phone && (
                    <a href={`https://wa.me/${context.phone}`} target="_blank" rel="noreferrer noopener" className="btn btn-sm">
                      Open in WhatsApp
                    </a>
                  )}
                </div>
              }
              pad={false}
            >
              <ul className="max-h-[50vh] space-y-2 overflow-y-auto p-4 text-[13px]">
                {messages.map((m) => (
                  <li key={m.id} className={`max-w-[80%] rounded-lg px-3 py-2 ${m.fromMe ? 'ml-auto bg-brand-50' : 'bg-slate-100'}`}>
                    <div className="whitespace-pre-wrap">{m.body ?? (m.hasMedia ? '(media)' : '')}</div>
                    <div className="mt-1 text-[11px] text-ink-3">
                      {formatDateTime(m.sentAt)}
                      {m.fromMe && m.ack !== null ? ` · ${['pending', 'sent', 'delivered', 'read', 'played'][m.ack] ?? m.ack}` : ''}
                      {m.isAuto ? ' · automatic reply, not counted as a human reply' : ''}
                      {m.sentiment ? ` · classified: ${m.sentiment.replace('_', ' ')}` : ''}
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
            <WaReplyComposer
              session={openSession}
              chatId={openChat}
              initialKey={randomUUID()}
              canSend={sessionOk}
              reason={sessionOk ? null : `The account "${openSession}" is not connected right now.`}
            />
          </div>
        )}
      </div>
    </>
  );
}
