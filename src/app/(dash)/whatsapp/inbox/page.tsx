import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { ArrowLeft, Bot, CheckCheck, ExternalLink, Filter, MessageCircle, Phone, Sparkles, UserRound } from 'lucide-react';
import { markWaHandled } from '@/app/actions/whatsapp';
import { IntentAvatar, IntentBadge, StageBadge } from '@/components/crm/LeadBits';
import { WaClassifyMenu } from '@/components/whatsapp/WaClassifyMenu';
import { WaInboxFilters } from '@/components/whatsapp/WaInboxFilters';
import { WaOpenEffects } from '@/components/whatsapp/WaOpenEffects';
import { WaReplyComposer } from '@/components/whatsapp/WaReplyComposer';
import { EmptyState } from '@/components/ui';
import { isStage } from '@/lib/crm/stages';
import { campaignOptions } from '@/lib/metrics/campaigns';
import { waSessions } from '@/lib/metrics/whatsapp';
import { formatPhone } from '@/lib/normalize';
import { env } from '@/lib/env';
import { listWaThreads, waInboxCounts, waThreadContext, waThreadMessages, WA_VIEWS, type WaThreadRow, type WaView } from '@/lib/whatsapp/inbox';

export const metadata = { title: 'WhatsApp inbox' };

const VIEW_LABELS: Record<WaView, string> = { needs_you: 'Needs you', screened: 'Screened out', unread: 'Unread', all: 'All chats', auto_replies: 'Auto-replies' };
const VIEW_HELP: Partial<Record<WaView, string>> = {
  needs_you: 'Interested, questions, call requests and anything worth reading. "No", greetings, "thanks" and auto-greetings go to Screened out.',
  screened: 'Waiting chats that do not need you: "no", stop, a bare greeting, "thanks" or an automatic greeting. Glance through in case one was mis-sorted.',
};

function chatTitle(t: Pick<WaThreadRow, 'leadName' | 'contactName' | 'phone'>): string {
  return t.leadName || t.contactName || formatPhone(t.phone) || 'Unknown business (number hidden)';
}

function clock(d: Date): string {
  return new Intl.DateTimeFormat('en-IN', { timeZone: env.timezone, hour: '2-digit', minute: '2-digit' }).format(d);
}

function dayLabel(d: Date): string {
  const tz = env.timezone;
  const day = (x: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(x);
  if (day(d) === day(new Date())) return 'Today';
  if (day(d) === day(new Date(Date.now() - 86_400_000))) return 'Yesterday';
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' }).format(d);
}

function listTime(d: Date): string {
  const label = dayLabel(d);
  return label === 'Today' ? clock(d) : label;
}

const TICKS = ['pending', 'sent', 'delivered', 'read', 'played'];

export default async function WaInboxPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const requested = sp.view === 'needs_reply' ? 'needs_you' : sp.view;
  const view = (WA_VIEWS as readonly string[]).includes(requested ?? '') ? (requested as WaView) : 'needs_you';
  const base = { session: sp.account || null, campaign: sp.campaign || null, from: sp.from || null, to: sp.to || null, search: sp.q || null };
  const [threads, counts, sessions, campaigns] = await Promise.all([
    listWaThreads({ ...base, view }),
    waInboxCounts(base),
    waSessions(),
    campaignOptions().then((r) => r.filter((c) => c.channel === 'whatsapp')),
  ]);
  // Links from elsewhere (lead pages, overview) use ?chat=&session=.
  const openChat = sp.openChat ?? sp.chat ?? null;
  const openSession = sp.openSession ?? sp.session ?? null;
  const [context, messages] = openChat && openSession ? await Promise.all([waThreadContext(openSession, openChat), waThreadMessages(openSession, openChat)]) : [null, []];
  const openThread = openChat && openSession ? threads.find((t) => t.chatId === openChat && t.session === openSession) : undefined;
  const sessionOk = sessions.find((s) => s.name === openSession)?.status === 'WORKING';
  const lastInbound = [...messages].reverse().find((m) => !m.fromMe);
  const title = context ? chatTitle({ leadName: context.leadName, contactName: context.contactName, phone: context.phone }) : '';

  function hrefFor(patch: Record<string, string | undefined>): string {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, chat: undefined, session: undefined, ...patch })) if (v) u.set(k, v);
    const s = u.toString();
    return `/whatsapp/inbox${s ? `?${s}` : ''}`;
  }

  // Group messages by day for date separators.
  const days: { label: string; items: typeof messages }[] = [];
  for (const m of messages) {
    const label = dayLabel(m.sentAt);
    if (days.at(-1)?.label !== label) days.push({ label, items: [] });
    days.at(-1)!.items.push(m);
  }

  return (
    <div className="card overflow-hidden lg:flex lg:h-[calc(100dvh-190px)] lg:min-h-[560px]">
      {/* Chat list */}
      <section className={`${openChat ? 'hidden lg:flex' : 'flex'} min-h-0 w-full flex-col border-line lg:w-[380px] lg:shrink-0 lg:border-r`} aria-label="Chats">
        <div className="space-y-3 border-b border-line p-4">
          <div className="grid grid-cols-2 gap-1 rounded-2xl bg-slate-100 p-1" role="navigation" aria-label="Views">
            {(['needs_you', 'screened'] as WaView[]).map((v) => (
              <Link
                key={v}
                href={hrefFor({ view: v === 'needs_you' ? undefined : v, openChat: undefined, openSession: undefined })}
                aria-current={view === v ? 'page' : undefined}
                className={`flex items-center justify-center gap-1.5 rounded-xl py-2 text-[13.5px] font-semibold ${view === v ? 'bg-white text-ink shadow-sm' : 'text-ink-2'}`}
              >
                {v === 'needs_you' ? <Sparkles size={14} className="text-[#128c7e]" aria-hidden /> : <Filter size={14} aria-hidden />}
                {VIEW_LABELS[v]}
                {counts[v] > 0 && (
                  <span className={`rounded-full px-1.5 text-[11px] leading-[18px] tabular ${v === 'needs_you' ? 'bg-[#128c7e] text-white' : 'bg-slate-200 text-ink-2'}`}>{counts[v]}</span>
                )}
              </Link>
            ))}
          </div>
          <div className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4">
            {(['unread', 'all', 'auto_replies'] as WaView[]).map((v) => (
              <Link
                key={v}
                href={hrefFor({ view: v, openChat: undefined, openSession: undefined })}
                aria-current={view === v ? 'page' : undefined}
                className="chip !min-h-8 !py-1 !text-[12px]"
              >
                {VIEW_LABELS[v]}
                {counts[v] > 0 && <span className="tabular opacity-70">{counts[v]}</span>}
              </Link>
            ))}
          </div>
          <WaInboxFilters accounts={sessions.map((s) => s.name)} campaigns={campaigns} />
          {VIEW_HELP[view] && <p className="text-[12px] leading-snug text-ink-3">{VIEW_HELP[view]}</p>}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {threads.length === 0 ? (
            <EmptyState icon={<Sparkles size={28} className="text-[#25d366]" aria-hidden />} title={view === 'needs_you' ? 'You are all caught up' : 'Nothing here'}>
              {view === 'needs_you' ? `No WhatsApp reply needs you right now.${counts.screened ? ` ${counts.screened} screened-out chat${counts.screened === 1 ? '' : 's'} under Screened out.` : ''}` : 'Try another view or filter.'}
            </EmptyState>
          ) : (
            <ul className="divide-y divide-line/70">
              {threads.map((t) => {
                const active = t.chatId === openChat && t.session === openSession;
                const intent = t.needsReply ? (t.openIntent ?? t.lastIntent) : t.lastIntent;
                return (
                  <li key={`${t.session}:${t.chatId}`}>
                    <Link
                      href={hrefFor({ view: sp.view, openChat: t.chatId, openSession: t.session })}
                      className={`relative flex gap-3 px-4 py-3 transition-colors ${active ? 'bg-emerald-50/70' : 'hover:bg-slate-50'}`}
                    >
                      {active && <span className="absolute inset-y-2 left-0 w-1 rounded-r-full bg-[#128c7e]" aria-hidden />}
                      <IntentAvatar name={chatTitle(t)} intent={intent} size={44} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className={`truncate text-[14px] ${t.unread ? 'font-bold text-ink' : 'font-semibold text-ink'}`}>{chatTitle(t)}</span>
                          <span className={`shrink-0 text-[11.5px] ${t.unread ? 'font-semibold text-[#128c7e]' : 'text-ink-3'}`}>{listTime(t.lastAt)}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <p className={`min-w-0 flex-1 truncate text-[13px] ${t.unread ? 'text-ink' : 'text-ink-2'}`}>
                            {t.lastFromMe ? <CheckCheck size={14} className="mr-1 inline text-sky-500" aria-hidden /> : t.lastIsAuto ? <Bot size={13} className="mr-1 inline text-ink-3" aria-hidden /> : null}
                            {t.lastBody ?? '(media)'}
                          </p>
                          {t.unread && <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#25d366]" aria-label="Unread" />}
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          <IntentBadge intent={intent} />
                          {isStage(t.leadStage) && <StageBadge stage={t.leadStage} />}
                          <span className="truncate text-[11px] text-ink-3">{t.campaignName ?? 'No lead match'} · {t.session}</span>
                        </div>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      {/* Conversation */}
      <section className={`${openChat ? 'flex' : 'hidden lg:flex'} min-h-0 min-w-0 flex-1 flex-col`} aria-label="Conversation">
        {!openChat || !openSession ? (
          <div className="flex flex-1 items-center justify-center bg-[#f0f2f5] p-8">
            <EmptyState icon={<MessageCircle size={32} className="text-[#25d366]" aria-hidden />} title="Pick a chat">
              Read the conversation, see the lead and reply from the same WhatsApp number they know.
            </EmptyState>
          </div>
        ) : !context ? (
          <div className="flex flex-1 items-center justify-center p-8">
            <EmptyState title="Conversation not found" />
          </div>
        ) : (
          <>
            <WaOpenEffects session={openSession} chatId={openChat} unread={openThread?.unread ?? false} />
            {/* Header */}
            <header className="flex flex-wrap items-center gap-3 border-b border-line bg-white px-3 py-2.5 sm:px-4">
              <Link href={hrefFor({ openChat: undefined, openSession: undefined })} className="icon-btn lg:hidden" aria-label="Back to chats">
                <ArrowLeft size={19} aria-hidden />
              </Link>
              <IntentAvatar name={title} intent={lastInbound?.intent ?? null} size={42} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  {context.leadId ? (
                    <Link href={`/leads/${context.leadId}`} className="truncate text-[15px] font-bold text-ink hover:underline">
                      {title}
                    </Link>
                  ) : (
                    <span className="truncate text-[15px] font-bold text-ink">{title}</span>
                  )}
                  {isStage(context.leadStage) && <StageBadge stage={context.leadStage} />}
                </div>
                <p className="truncate text-[12px] text-ink-3">
                  {context.hiddenNumber ? 'Number hidden by WhatsApp' : formatPhone(context.phone) ?? context.phone}
                  {context.campaignName ? ` · ${context.campaignName}` : ''}
                  {context.city ? ` · ${context.city}` : ''} · via {openSession}
                </p>
              </div>
              {context.phone && (
                <a href={`tel:+${context.phone}`} className="contact-btn border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100" aria-label={`Call ${title}`}>
                  <Phone size={17} aria-hidden />
                </a>
              )}
            </header>
            <div className="flex flex-wrap items-center gap-2 border-b border-line bg-white px-3 py-2 text-[12px] sm:px-4">
              <IntentBadge intent={lastInbound?.intent ?? null} />
              <WaClassifyMenu session={openSession} chatId={openChat} />
              {context.phone && (
                <a href={`https://wa.me/${context.phone}`} target="_blank" rel="noreferrer noopener" className="btn btn-sm" title="Open in your WhatsApp app">
                  <ExternalLink size={13} aria-hidden /> WhatsApp app
                </a>
              )}
              {context.leadId && (
                <Link href={`/leads/${context.leadId}`} className="btn btn-sm">
                  <UserRound size={13} aria-hidden /> Lead
                </Link>
              )}
              <form action={markWaHandled} className="ml-auto">
                <input type="hidden" name="session" value={openSession} />
                <input type="hidden" name="chatId" value={openChat} />
                <input type="hidden" name="undo" value={context.handledAt ? '1' : '0'} />
                <button type="submit" className={`btn btn-sm ${context.handledAt ? '' : 'border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'}`}>
                  <CheckCheck size={14} aria-hidden /> {context.handledAt ? 'Reopen' : 'Done'}
                </button>
              </form>
            </div>

            {/* Messages */}
            <div className="min-h-[50vh] flex-1 overflow-y-auto bg-[#efeae2] bg-[radial-gradient(rgba(0,0,0,0.035)_1px,transparent_1px)] bg-[length:14px_14px] px-3 py-4 sm:px-6 lg:min-h-0">
              {days.map((d) => (
                <div key={d.label} className="space-y-1.5">
                  <div className="sticky top-1 z-10 flex justify-center py-2">
                    <span className="rounded-lg bg-white/90 px-3 py-1 text-[11.5px] font-medium text-ink-2 shadow-sm">{d.label}</span>
                  </div>
                  {d.items.map((m) => (
                    <div key={m.id} className={`flex ${m.fromMe ? 'justify-end' : 'justify-start'}`}>
                      <div
                        className={`max-w-[85%] rounded-xl px-3 pb-1.5 pt-2 text-[14px] leading-snug shadow-[0_1px_0.5px_rgba(11,20,26,0.13)] sm:max-w-[70%] ${
                          m.fromMe ? 'rounded-tr-sm bg-[#d9fdd3] text-ink' : m.isAuto ? 'rounded-tl-sm bg-white/70 text-ink-2' : 'rounded-tl-sm bg-white text-ink'
                        }`}
                      >
                        {m.isAuto && (
                          <span className="mb-0.5 flex items-center gap-1 text-[11px] font-medium text-ink-3">
                            <Bot size={11} aria-hidden /> Automatic reply
                          </span>
                        )}
                        <p className="whitespace-pre-wrap break-words">{m.body ?? (m.hasMedia ? '📎 Media (voice note, image or file)' : '')}</p>
                        <div className="mt-0.5 flex items-center justify-end gap-1.5 text-[10.5px] text-ink-3">
                          {!m.fromMe && !m.isAuto && m.intent && m.intent !== 'other' && <IntentBadge intent={m.intent} className="!px-1.5 !py-0 !text-[10px]" />}
                          {clock(m.sentAt)}
                          {m.fromMe && m.ack !== null && (
                            <span title={TICKS[m.ack] ?? String(m.ack)} className={m.ack >= 3 ? 'text-sky-500' : ''}>
                              {m.ack >= 2 ? '✓✓' : '✓'}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>

            <div className="border-t border-line bg-[#f0f2f5] px-3 py-3 sm:px-4">
              <WaReplyComposer
                session={openSession}
                chatId={openChat}
                initialKey={randomUUID()}
                canSend={sessionOk}
                reason={sessionOk ? null : `The account "${openSession}" is not connected right now.`}
              />
            </div>
          </>
        )}
      </section>
    </div>
  );
}
