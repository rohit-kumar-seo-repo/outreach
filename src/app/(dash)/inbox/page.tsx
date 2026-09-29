import { randomUUID } from 'node:crypto';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  CheckCheck,
  Clock,
  Inbox as InboxIcon,
  MailQuestion,
  MailWarning,
  Paperclip,
  Reply,
  Search,
  Send,
  ShieldAlert,
  SlidersHorizontal,
  Workflow,
} from 'lucide-react';
import { assignThread, setSentiment, unassignThread } from '@/app/actions/data';
import { loadMessageBody, markHandled, setThreadRead, snoozeThread, unsnoozeThread } from '@/app/actions/inbox';
import { OpenEffects } from '@/components/inbox/OpenEffects';
import { ReplyComposer } from '@/components/inbox/ReplyComposer';
import { ScopePicker } from '@/components/inbox/ScopePicker';
import { LeadStatus, OutcomeBadge, StepLabel } from '@/components/status';
import { EmptyState, fmt, Pill } from '@/components/ui';
import { env } from '@/lib/env';
import { bodyPolicy } from '@/lib/mail/body';
import { replyContext } from '@/lib/mail/reply';
import { campaignOptions } from '@/lib/metrics/campaigns';
import {
  INBOX_VIEWS,
  inboxCounts,
  leadContext,
  leadSearch,
  listThreads,
  mailboxHealth,
  MESSAGE_TYPES,
  PAGE_SIZE,
  pendingReplies,
  threadBounces,
  threadMessages,
  threadState,
  type InboxCounts,
  type InboxView,
  type MailboxHealth,
  type MessageType,
  type ThreadMessage,
  type ThreadRow,
} from '@/lib/metrics/inbox';
import { formatDate, formatDateTime, relativeTime } from '@/lib/time';

export const metadata = { title: 'Inbox' };

type SP = Record<string, string | undefined>;

const SENTIMENTS = [
  ['positive', 'Positive'],
  ['neutral', 'Neutral'],
  ['not_interested', 'Not interested'],
  ['unsubscribe', 'Unsubscribe'],
  ['auto_reply', 'Auto-reply'],
] as const;

const VIEW_META: Record<InboxView, { label: string; icon: typeof InboxIcon; count?: (c: InboxCounts) => number; countHelp?: string }> = {
  needs_reply: { label: 'Needs reply', icon: Reply, count: (c) => c.needsReply, countHelp: 'Conversations waiting for your reply' },
  inbox: { label: 'Inbox', icon: InboxIcon, count: (c) => c.inboxUnread, countHelp: 'Unread conversations' },
  sent: { label: 'Sent', icon: Send },
  snoozed: { label: 'Snoozed', icon: Clock, count: (c) => c.snoozed, countHelp: 'Snoozed conversations' },
  bounces: { label: 'Bounces', icon: MailWarning, count: (c) => c.bounces30d, countHelp: 'Conversations with a bounce in the last 30 days' },
  spam: { label: 'Spam', icon: ShieldAlert, count: (c) => c.spamUnread, countHelp: 'Unread conversations in Spam/Junk' },
  unmatched: { label: 'Unmatched', icon: MailQuestion, count: (c) => c.unmatched30d, countHelp: 'Not linked to a lead, last 30 days' },
  internal: { label: 'Internal / automation', icon: Workflow, count: (c) => c.internalUnread, countHelp: 'Unread reports, alerts and tests' },
  all: { label: 'All mail', icon: InboxIcon },
};
const NAV_VIEWS: InboxView[] = ['needs_reply', 'inbox', 'sent', 'snoozed', 'bounces', 'spam'];
const MORE_VIEWS: InboxView[] = ['unmatched', 'internal', 'all'];

const TYPE_LABEL: Record<MessageType, string> = {
  lead_reply: 'Replies from leads',
  human: 'Any human message',
  auto_reply: 'Auto-replies',
  bounce: 'Bounces',
  internal: 'Internal / automation',
};

function href(sp: SP, patch: SP): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...sp, ...patch })) if (v) u.set(k, v);
  const s = u.toString();
  return s ? `/inbox?${s}` : '/inbox';
}

function shortTime(d: Date | null): string {
  if (!d) return '';
  const tz = env.timezone;
  const day = (x: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(x);
  if (day(d) === day(new Date())) return new Intl.DateTimeFormat('en-IN', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(d);
  if (day(d) === day(new Date(Date.now() - 86_400_000))) return 'Yesterday';
  const sameYear = new Intl.DateTimeFormat('en', { timeZone: tz, year: 'numeric' }).format(d) === new Intl.DateTimeFormat('en', { timeZone: tz, year: 'numeric' }).format(new Date());
  return new Intl.DateTimeFormat('en-IN', { timeZone: tz, day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) }).format(d);
}

function initials(s: string | null | undefined): string {
  const w = (s ?? '?').replace(/[<>"@].*$/, '').trim().split(/[\s._-]+/).filter(Boolean);
  return ((w[0]?.[0] ?? '?') + (w[1]?.[0] ?? '')).toUpperCase();
}

/** Splits a plain-text body into the new text and the quoted history below it. */
function splitQuoted(text: string): { main: string; quoted: string | null } {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const idx = lines.findIndex(
    (l, i) =>
      /^\s*On .{4,200}wrote:\s*$/.test(l) ||
      /^\s*-{2,}\s*(Original Message|Forwarded message)/i.test(l) ||
      (/^From: /.test(l) && /^(Sent|Date): /.test(lines[i + 1] ?? '')) ||
      (/^>/.test(l) && lines.slice(i).every((x) => /^>|^\s*$/.test(x))),
  );
  if (idx <= 0) return { main: text.trim(), quoted: null };
  return { main: lines.slice(0, idx).join('\n').trim(), quoted: lines.slice(idx).join('\n').trim() };
}

function emailDoc(html: string): string {
  // Rendered inside a sandboxed iframe (no scripts, no same-origin). Remote images are blocked
  // so opening an email never fires a sender's tracking pixel.
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: cid:; style-src 'unsafe-inline'; font-src data:"><base target="_blank"><style>body{font-family:system-ui,sans-serif;font-size:14px;color:#0f172a;margin:12px;word-break:break-word}img{max-width:100%}</style></head><body>${html}</body></html>`;
}

function RowBadge({ t }: { t: ThreadRow }) {
  if (t.snoozed && t.snoozedUntil)
    return (
      <Pill tone="brand">
        <Clock size={11} aria-hidden /> {shortTime(t.snoozedUntil)}
      </Pill>
    );
  if (t.hasBounce) return <Pill tone="critical">Bounce</Pill>;
  if (t.awaiting && t.unread > 0 && t.leadId) return <Pill tone="good">New reply</Pill>;
  if (t.awaiting) return <Pill tone="warn">Needs reply</Pill>;
  if (t.kind === 'internal' || (t.hasInternal && !t.leadId)) return <Pill>Internal</Pill>;
  if (t.unmatched) return <Pill tone="warn">Unmatched</Pill>;
  if (t.kind === 'auto_reply') return <Pill>Auto-reply</Pill>;
  return null;
}

function ThreadItem({ t, sp, active }: { t: ThreadRow; sp: SP; active: boolean }) {
  const isOut = t.direction === 'outbound';
  const who = t.hasBounce
    ? `Bounce: ${t.bounceRecipients?.[0] ?? t.counterpart ?? 'unknown recipient'}`
    : isOut
      ? `To: ${t.leadName ?? t.counterpart ?? '(unknown)'}`
      : (t.fromName || t.fromAddr || t.counterpart || '(unknown sender)');
  const snippet = t.hasBounce
    ? `Could not be delivered${t.bounceRecipients && t.bounceRecipients.length > 1 ? ` to ${t.bounceRecipients.length} recipients` : ''}${t.bounceCampaign ? ` · ${t.bounceCampaign}` : ''}`
    : t.snippet
      ? `${isOut ? 'You: ' : ''}${t.snippet}`
      : null;
  const unread = t.unread > 0;
  return (
    <li>
      <Link
        href={href(sp, { thread: t.threadKey, leadq: undefined })}
        aria-current={active ? 'true' : undefined}
        className={`block border-l-[3px] px-4 py-3 transition-colors hover:bg-slate-50 ${active ? 'border-l-brand bg-brand-50/70' : 'border-l-transparent'}`}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1.5">
            {unread ? <span className="h-2 w-2 shrink-0 rounded-full bg-brand" aria-label="Unread" /> : null}
            <span className={`truncate text-[13.5px] ${unread ? 'font-semibold text-ink' : 'font-medium text-ink'}`}>{who}</span>
            {t.messages > 1 && <span className="shrink-0 text-[11px] text-ink-3">{t.messages}</span>}
          </span>
          <time className={`shrink-0 text-[11.5px] ${unread ? 'font-semibold text-brand' : 'text-ink-3'}`} dateTime={t.lastAt?.toISOString()}>
            {shortTime(t.lastAt)}
          </time>
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <span className={`truncate text-[12.5px] ${unread ? 'font-medium text-ink' : 'text-ink-2'}`}>{t.subject || '(no subject)'}</span>
          <span className="shrink-0">
            <RowBadge t={t} />
          </span>
        </div>
        {snippet && <p className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-ink-3">{snippet}</p>}
        <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[11px]">
          <span className="max-w-[60%] truncate rounded bg-slate-100 px-1.5 py-0.5 text-ink-2" title={`Mailbox: ${t.mailbox}`}>
            {t.mailbox}
          </span>
          {(t.campaignName ?? t.bounceCampaign) && (
            <span className="max-w-[45%] truncate rounded bg-brand-50 px-1.5 py-0.5 text-brand" title="Campaign">
              {t.campaignName ?? t.bounceCampaign}
            </span>
          )}
          {t.flagged && <span className="rounded bg-warn-50 px-1.5 py-0.5 text-warn">Follow up</span>}
        </div>
      </Link>
    </li>
  );
}

function MailboxStatus({ boxes }: { boxes: MailboxHealth[] }) {
  const problems = boxes.filter((b) => b.lastStatus !== 'ok');
  return (
    <div>
      <h2 className="mb-1.5 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-ink-3">
        Mailboxes
        <span className={`normal-case tracking-normal ${problems.length ? 'text-critical' : 'text-good-text'}`}>
          {boxes.length - problems.length} of {boxes.length} syncing
        </span>
      </h2>
      <ul className="space-y-1 text-[12px]">
        {boxes.map((b) => {
          const tone = b.lastStatus === 'ok' ? 'bg-good' : b.lastStatus === 'error' ? 'bg-critical' : 'bg-slate-300';
          const state = b.lastStatus === 'ok' ? 'Syncing' : b.lastStatus === 'error' ? 'Sync failing' : 'Not connected';
          return (
            <li key={b.address} className="flex items-start gap-2" title={b.lastError ?? undefined}>
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${tone}`} aria-hidden />
              <span className="min-w-0">
                <span className="block truncate text-ink-2">{b.address}</span>
                <span className="block text-[11px] text-ink-3">
                  {state}
                  {b.lastStatus === 'ok' ? (b.canSend ? ' · can reply' : ' · read-only') : ''}
                  {b.lastStatus === 'error' && b.lastSuccessAt ? ` · last OK ${relativeTime(b.lastSuccessAt)}` : ''}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function MessageBody({ m, askBeforeUnread }: { m: ThreadMessage; askBeforeUnread: boolean }) {
  if (m.bodyText) {
    const { main, quoted } = splitQuoted(m.bodyText);
    return (
      <div className="px-4 pb-3 pt-2">
        <pre className="whitespace-pre-wrap break-words font-sans text-[13.5px] leading-relaxed text-ink">{main || '(empty message)'}</pre>
        {quoted && (
          <details className="mt-2 text-[12.5px]">
            <summary className="cursor-pointer text-ink-3 hover:text-ink-2">Show quoted text</summary>
            <pre className="mt-1 max-h-80 overflow-auto whitespace-pre-wrap break-words border-l-2 border-line pl-3 font-sans text-ink-3">{quoted}</pre>
          </details>
        )}
        {m.bodyHtml && (
          <details className="mt-2 text-[12.5px]">
            <summary className="cursor-pointer text-ink-3 hover:text-ink-2">Show formatted version</summary>
            <iframe title={`Message ${m.id}`} sandbox="" srcDoc={emailDoc(m.bodyHtml)} className="mt-1 h-80 w-full rounded border border-line bg-white" />
          </details>
        )}
      </div>
    );
  }
  if (m.bodyHtml) {
    return (
      <div className="px-4 pb-3 pt-2">
        <iframe title={`Message ${m.id}`} sandbox="" srcDoc={emailDoc(m.bodyHtml)} className="h-72 w-full rounded border border-line bg-white" />
      </div>
    );
  }
  if (m.kind === 'bounce') return <p className="px-4 pb-3 pt-2 text-[12.5px] text-ink-3">The failed recipient and reason are shown above.</p>;
  if (m.unseen && askBeforeUnread) {
    return (
      <form action={loadMessageBody} className="flex flex-wrap items-center gap-2 px-4 pb-3 pt-2 text-[12.5px]">
        <input type="hidden" name="messageId" value={m.id} />
        <span className="flex items-center gap-1.5 text-warn">
          <AlertTriangle size={13} aria-hidden /> Loading this unread message will mark it read in the mailbox ({m.mailbox}).
        </span>
        <button className="btn btn-sm">Load anyway</button>
      </form>
    );
  }
  return <p className="px-4 pb-3 pt-2 text-[12.5px] text-ink-3">Loading message… (only headers are synced for older mail; open again if it does not appear)</p>;
}

export default async function InboxPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const view: InboxView = (INBOX_VIEWS as readonly string[]).includes(sp.view ?? '') ? (sp.view as InboxView) : 'needs_reply';
  const scope = { domain: sp.domain?.toLowerCase() || null, mailbox: sp.mailbox?.toLowerCase() || null };
  const type = (MESSAGE_TYPES as readonly string[]).includes(sp.type ?? '') ? (sp.type as MessageType) : null;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const [threads, counts, boxes, campaigns, policy] = await Promise.all([
    listThreads({
      ...scope,
      view,
      campaign: sp.campaign || null,
      unread: sp.unread === '1',
      needsReply: sp.needs === '1',
      match: sp.match === 'matched' || sp.match === 'unmatched' ? sp.match : null,
      type,
      search: sp.q || null,
      sort: sp.sort === 'oldest' ? 'oldest' : 'newest',
      page,
    }),
    inboxCounts(scope),
    mailboxHealth(),
    campaignOptions(),
    bodyPolicy(),
  ]);
  const thread = sp.thread ?? null;
  const [messages, pending, bounces, state, reply] = thread
    ? await Promise.all([threadMessages(thread), pendingReplies(thread), threadBounces(thread), threadState(thread), replyContext(thread)])
    : [[], [], [], null, null];
  const leadId = messages.find((m) => m.leadId)?.leadId ?? null;
  const lead = leadId ? await leadContext(leadId) : null;
  const suggestedId = !leadId ? (messages.find((m) => m.suggestedLeadId)?.suggestedLeadId ?? null) : null;
  const suggested = suggestedId ? await leadContext(suggestedId) : null;
  const searchResults = thread && !leadId && sp.leadq ? await leadSearch(sp.leadq) : [];
  const problems = boxes.filter((b) => b.lastStatus !== 'ok');
  const scopeLabel = scope.mailbox ?? (scope.domain ? `All mailboxes on ${scope.domain}` : 'All domains and mailboxes');
  const activeFilters: [string, string][] = [];
  if (sp.campaign) activeFilters.push(['campaign', campaigns.find((c) => c.slug === sp.campaign)?.name ?? sp.campaign]);
  if (sp.unread === '1') activeFilters.push(['unread', 'Unread']);
  if (sp.needs === '1') activeFilters.push(['needs', 'Needs reply']);
  if (sp.match) activeFilters.push(['match', sp.match === 'matched' ? 'Matched to a lead' : 'Unmatched']);
  if (type) activeFilters.push(['type', TYPE_LABEL[type]]);
  if (sp.q) activeFilters.push(['q', `“${sp.q}”`]);
  const subject = messages.at(-1)?.subject ?? pending.at(-1)?.fromAddr ?? '(no subject)';
  const lastHuman = [...messages].reverse().find((m) => m.direction === 'inbound' && m.kind === 'message');
  const lastOurs = Math.max(
    ...messages.filter((m) => m.direction === 'outbound' && !m.sendAttemptId).map((m) => m.sentAt?.getTime() ?? 0),
    ...pending.filter((r) => r.status !== 'failed').map((r) => (r.sentAt ?? r.createdAt).getTime()),
    0,
  );
  const waitingOnYou =
    !!lastHuman?.sentAt && lastHuman.sentAt.getTime() > lastOurs && lastHuman.sentAt.getTime() > (state?.handledAt?.getTime() ?? 0) && !messages.some((m) => m.matchMethod === 'manual_none');
  const snoozed = !!state?.snoozedUntil && state.snoozedUntil.getTime() > Date.now();
  const threadUnread = messages.some((m) => m.unread);
  const missingBodies = messages.some((m) => !m.bodyFetchedAt && m.kind !== 'bounce');
  const unsubscribed = reply?.blocked.filter((b) => !b.reason.startsWith('hard bounce')) ?? [];
  const hardBounced = reply?.blocked.filter((b) => b.reason.startsWith('hard bounce')) ?? [];

  const navList = (
    <nav aria-label="Inbox views" className="space-y-0.5">
      {NAV_VIEWS.map((v) => {
        const meta = VIEW_META[v];
        const n = meta.count?.(counts) ?? 0;
        const Icon = meta.icon;
        const on = v === view;
        return (
          <Link
            key={v}
            href={href({ domain: sp.domain, mailbox: sp.mailbox }, { view: v === 'needs_reply' ? undefined : v })}
            aria-current={on ? 'page' : undefined}
            className={`flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13.5px] ${on ? 'bg-brand text-white' : 'text-ink-2 hover:bg-slate-100'}`}
          >
            <Icon size={16} aria-hidden />
            <span className="flex-1">{meta.label}</span>
            {meta.count && n > 0 && (
              <span className={`tabular text-[12px] font-semibold ${on ? 'text-white' : v === 'needs_reply' ? 'text-brand' : 'text-ink-3'}`} title={meta.countHelp}>
                {fmt(n)}
              </span>
            )}
          </Link>
        );
      })}
      <div className="my-2 border-t border-line" />
      {MORE_VIEWS.map((v) => {
        const meta = VIEW_META[v];
        const n = meta.count?.(counts) ?? 0;
        const Icon = meta.icon;
        const on = v === view;
        return (
          <Link
            key={v}
            href={href({ domain: sp.domain, mailbox: sp.mailbox }, { view: v })}
            aria-current={on ? 'page' : undefined}
            className={`flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[12.5px] ${on ? 'bg-brand text-white' : 'text-ink-3 hover:bg-slate-100 hover:text-ink-2'}`}
          >
            <Icon size={14} aria-hidden />
            <span className="flex-1">{meta.label}</span>
            {meta.count && n > 0 && (
              <span className="tabular text-[11.5px]" title={meta.countHelp}>
                {fmt(n)}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );

  const mailboxOptions = boxes.map((b) => ({ address: b.address, domain: b.domain, ok: b.lastStatus === 'ok' }));

  return (
    <div data-fullbleed className="flex min-h-[calc(100dvh-56px)] flex-col bg-canvas lg:h-full lg:min-h-0 lg:flex-row">
      {/* 1. Inbox navigation */}
      <aside className="hidden w-56 shrink-0 flex-col gap-5 overflow-y-auto border-r border-line bg-white px-3 py-4 lg:flex" aria-label="Inbox navigation">
        <div>
          <h1 className="px-1 text-[17px] font-semibold text-ink">Inbox</h1>
          <p className="px-1 text-[11.5px] text-ink-3">Showing: {scopeLabel}</p>
        </div>
        <ScopePicker mailboxes={mailboxOptions} />
        {navList}
        <MailboxStatus boxes={boxes} />
      </aside>

      {/* 2. Conversation list */}
      <section
        className={`${thread ? 'hidden lg:flex' : 'flex'} min-h-0 w-full shrink-0 flex-col border-r border-line bg-white lg:w-[340px] xl:w-[380px] 2xl:w-[420px]`}
        aria-label="Conversations"
      >
        <div className="space-y-2 border-b border-line px-4 py-3">
          <div className="lg:hidden">
            <h1 className="mb-2 text-[17px] font-semibold text-ink">Inbox</h1>
            <ScopePicker mailboxes={mailboxOptions} compact />
            <div className="-mx-4 mt-2 flex gap-1 overflow-x-auto px-4 pb-1" role="navigation" aria-label="Inbox views">
              {[...NAV_VIEWS, ...MORE_VIEWS].map((v) => {
                const n = VIEW_META[v].count?.(counts) ?? 0;
                return (
                  <Link
                    key={v}
                    href={href({ domain: sp.domain, mailbox: sp.mailbox }, { view: v === 'needs_reply' ? undefined : v })}
                    aria-current={v === view ? 'page' : undefined}
                    className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1 text-[12.5px] ${v === view ? 'border-brand bg-brand text-white' : 'border-line text-ink-2'}`}
                  >
                    {VIEW_META[v].label}
                    {VIEW_META[v].count && n > 0 ? ` ${n}` : ''}
                  </Link>
                );
              })}
            </div>
          </div>
          <form method="get" className="flex items-center gap-2" role="search">
            {Object.entries(sp)
              .filter(([k, v]) => v && !['q', 'page', 'thread', 'leadq'].includes(k))
              .map(([k, v]) => (
                <input key={k} type="hidden" name={k} value={v} />
              ))}
            <label className="relative flex-1">
              <span className="sr-only">Search conversations</span>
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" aria-hidden />
              <input name="q" defaultValue={sp.q ?? ''} placeholder="Search people, subject, text, campaign…" className="field w-full py-1.5 pl-8 text-[13px]" />
            </label>
            <details className="relative">
              <summary className="btn btn-sm cursor-pointer list-none" aria-label="Filters">
                <SlidersHorizontal size={14} aria-hidden />
                <span className="hidden sm:inline">Filters</span>
                {activeFilters.filter(([k]) => k !== 'q').length > 0 && (
                  <span className="rounded-full bg-brand px-1.5 text-[10.5px] text-white">{activeFilters.filter(([k]) => k !== 'q').length}</span>
                )}
              </summary>
              <div className="absolute right-0 z-30 mt-1 w-72 space-y-2 rounded-lg border border-line bg-white p-3 text-[12.5px] shadow-lg">
                <label className="block">
                  Campaign
                  <select name="campaign" defaultValue={sp.campaign ?? ''} className="field mt-0.5 w-full py-1">
                    <option value="">All campaigns</option>
                    {campaigns.map((c) => (
                      <option key={c.slug} value={c.slug}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  Lead match
                  <select name="match" defaultValue={sp.match ?? ''} className="field mt-0.5 w-full py-1">
                    <option value="">Matched and unmatched</option>
                    <option value="matched">Matched to a lead</option>
                    <option value="unmatched">Unmatched</option>
                  </select>
                </label>
                <label className="block">
                  Message type
                  <select name="type" defaultValue={type ?? ''} className="field mt-0.5 w-full py-1">
                    <option value="">Any type</option>
                    {MESSAGE_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {TYPE_LABEL[t]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  Sort
                  <select name="sort" defaultValue={sp.sort ?? 'newest'} className="field mt-0.5 w-full py-1">
                    <option value="newest">Newest first</option>
                    <option value="oldest">Oldest first</option>
                  </select>
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="unread" value="1" defaultChecked={sp.unread === '1'} /> Unread only
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="needs" value="1" defaultChecked={sp.needs === '1'} /> Needs reply only
                </label>
                <div className="flex justify-end gap-2 pt-1">
                  <Link href={href({ domain: sp.domain, mailbox: sp.mailbox, view: sp.view }, {})} className="btn btn-sm">
                    Clear
                  </Link>
                  <button className="btn btn-sm btn-primary">Apply</button>
                </div>
              </div>
            </details>
          </form>
          <div className="flex flex-wrap items-center gap-1.5 text-[11.5px]">
            <span className="font-medium text-ink-2">
              {VIEW_META[view].label} · {fmt(threads.total)} conversation{threads.total === 1 ? '' : 's'}
            </span>
            <span className="text-ink-3">· {sp.sort === 'oldest' ? 'oldest first' : 'newest first'}</span>
            {(scope.domain || scope.mailbox) && (
              <Link href={href(sp, { domain: undefined, mailbox: undefined, page: undefined, thread: undefined })} className="rounded-full bg-brand-50 px-2 py-0.5 text-brand" title="Show all mailboxes">
                {scopeLabel} ✕
              </Link>
            )}
            {activeFilters.map(([k, label]) => (
              <Link key={k} href={href(sp, { [k]: undefined, page: undefined })} className="rounded-full bg-slate-100 px-2 py-0.5 text-ink-2" title="Remove filter">
                {label} ✕
              </Link>
            ))}
          </div>
          {problems.length > 0 && (
            <p className="flex items-start gap-1.5 rounded-md bg-critical-50 px-2.5 py-1.5 text-[12px] text-critical">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden />
              <span>
                {problems.length} mailbox{problems.length === 1 ? ' is' : 'es are'} not syncing: {problems.map((p) => p.address).join(', ')}. Their new mail is missing here.{' '}
                <Link href="/integrations" className="underline">
                  Details
                </Link>
              </span>
            </p>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {threads.rows.length === 0 ? (
            <EmptyState title={view === 'needs_reply' && !activeFilters.length ? 'Nothing is waiting for your reply' : 'No conversations here'}>
              {view === 'needs_reply' && !activeFilters.length
                ? 'Replies from leads appear here until you answer them, snooze them or mark them as not needing a reply.'
                : 'Try another view, mailbox or filter.'}
            </EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {threads.rows.map((t) => (
                <ThreadItem key={t.threadKey} t={t} sp={sp} active={t.threadKey === thread} />
              ))}
            </ul>
          )}
          {threads.total > PAGE_SIZE && (
            <div className="flex items-center justify-between border-t border-line px-4 py-2 text-xs">
              {page > 1 ? (
                <Link href={href(sp, { page: String(page - 1), thread: undefined })} className="link">
                  ← Previous
                </Link>
              ) : (
                <span />
              )}
              <span className="text-ink-3">
                {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, threads.total)} of {fmt(threads.total)}
              </span>
              {page * PAGE_SIZE < threads.total ? (
                <Link href={href(sp, { page: String(page + 1), thread: undefined })} className="link">
                  Next →
                </Link>
              ) : (
                <span />
              )}
            </div>
          )}
        </div>
      </section>

      {/* 3. Reading pane */}
      <main className={`${thread ? 'flex' : 'hidden lg:flex'} min-h-0 min-w-0 flex-1 flex-col`} aria-label="Conversation">
        {!thread || (messages.length === 0 && pending.length === 0) ? (
          <div className="flex flex-1 items-center justify-center p-8">
            <EmptyState title={thread ? 'This conversation is no longer available' : 'Select a conversation'}>
              {thread ? 'It may have been moved or deleted in the mailbox.' : 'Open a conversation to read it, see its lead and campaign, and reply.'}
            </EmptyState>
          </div>
        ) : (
          <>
            <OpenEffects thread={thread} unread={threadUnread} missingBodies={missingBodies} />
            <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-white px-4 py-2 text-[12.5px]">
              <Link href={href(sp, { thread: undefined, leadq: undefined })} className="btn btn-sm lg:hidden">
                <ArrowLeft size={14} aria-hidden /> Back
              </Link>
              {waitingOnYou ? (
                <form action={markHandled}>
                  <input type="hidden" name="thread" value={thread} />
                  <button className="btn btn-sm" title="Leave Needs reply until they write again">
                    <CheckCheck size={14} aria-hidden /> No reply needed
                  </button>
                </form>
              ) : state?.handledAt ? (
                <form action={markHandled}>
                  <input type="hidden" name="thread" value={thread} />
                  <input type="hidden" name="undo" value="1" />
                  <button className="btn btn-sm">Move back to Needs reply</button>
                </form>
              ) : null}
              {snoozed ? (
                <form action={unsnoozeThread} className="flex items-center gap-1.5">
                  <input type="hidden" name="thread" value={thread} />
                  <span className="text-brand">
                    <Clock size={13} className="inline" aria-hidden /> Snoozed until {formatDateTime(state!.snoozedUntil)}
                  </span>
                  <button className="btn btn-sm">Unsnooze</button>
                </form>
              ) : (
                <details className="relative">
                  <summary className="btn btn-sm cursor-pointer list-none">
                    <Clock size={14} aria-hidden /> Snooze
                  </summary>
                  <form action={snoozeThread} className="absolute left-0 z-30 mt-1 w-64 space-y-1 rounded-lg border border-line bg-white p-2 shadow-lg">
                    <input type="hidden" name="thread" value={thread} />
                    <p className="px-1 pb-1 text-[11.5px] text-ink-3">Hide it until then. It comes back sooner if they write again.</p>
                    {[
                      ['later', 'Later today (6 pm)'],
                      ['tomorrow', 'Tomorrow, 9 am'],
                      ['monday', 'Next Monday, 9 am'],
                      ['week', 'In a week, 9 am'],
                    ].map(([v, label]) => (
                      <button key={v} name="preset" value={v} className="block w-full rounded px-2 py-1.5 text-left hover:bg-slate-100">
                        {label}
                      </button>
                    ))}
                    <div className="flex items-center gap-1 border-t border-line pt-2">
                      <label className="sr-only" htmlFor="snooze-until">
                        Snooze until
                      </label>
                      <input id="snooze-until" type="datetime-local" name="until" className="field min-w-0 flex-1 py-1 text-[12px]" />
                      <button name="preset" value="custom" className="btn btn-sm">
                        Set
                      </button>
                    </div>
                  </form>
                </details>
              )}
              <form action={setThreadRead}>
                <input type="hidden" name="thread" value={thread} />
                <input type="hidden" name="read" value={threadUnread ? '1' : '0'} />
                <button className="btn btn-sm">{threadUnread ? 'Mark read' : 'Mark unread'}</button>
              </form>
              {leadId && (
                <form action={unassignThread} className="ml-auto">
                  <input type="hidden" name="thread" value={thread} />
                  <button className="btn btn-sm" title="Unlink from the lead; it is not counted as a reply">
                    Not outreach
                  </button>
                </form>
              )}
            </div>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4 lg:px-6">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h2 className="min-w-0 break-words text-[19px] font-semibold leading-snug text-ink">{subject || '(no subject)'}</h2>
                <div className="flex flex-wrap items-center gap-1.5">
                  {waitingOnYou && !snoozed ? <Pill tone="warn">Needs your reply</Pill> : lastOurs > 0 ? <Pill tone="teal">You replied</Pill> : null}
                  {bounces.length > 0 && <Pill tone="critical">Bounce</Pill>}
                  {messages.some((m) => m.kind === 'internal') && (
                    <Pill title="Reports, alerts and tests between your own addresses. Never counted in campaign metrics.">
                      <Workflow size={11} aria-hidden /> Internal / automation
                    </Pill>
                  )}
                </div>
              </div>

              {/* Compact context card */}
              {lead ? (
                <section className="@container card px-4 py-3 text-[12.5px]" aria-label="Lead and campaign">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Link href={`/leads/${lead.id}`} className="text-[14px] font-semibold text-ink hover:underline">
                        {lead.name ?? lead.email ?? `Lead ${lead.id}`}
                      </Link>
                      <div className="mt-0.5 flex flex-wrap gap-x-3 text-ink-3">
                        {lead.email && <span>{lead.email}</span>}
                        {lead.website && (
                          <a href={/^https?:/i.test(lead.website) ? lead.website : `https://${lead.website}`} className="link" target="_blank" rel="noreferrer noopener">
                            {lead.website.replace(/^https?:\/\//i, '').replace(/\/$/, '')}
                          </a>
                        )}
                        {(lead.city || lead.country) && <span>{[lead.city, lead.country].filter(Boolean).join(', ')}</span>}
                        {lead.category && <span>{lead.category}</span>}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1">
                      <LeadStatus status={lead.status} />
                      <OutcomeBadge outcome={lead.outcome} />
                    </div>
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 @2xl:grid-cols-4">
                    <div>
                      <dt className="text-ink-3">Campaign</dt>
                      <dd>
                        <Link href={`/campaigns/${lead.campaignSlug}`} className="link font-medium">
                          {lead.campaignName}
                        </Link>
                      </dd>
                    </div>
                    <div className="min-w-0">
                      <dt className="text-ink-3">Sent from</dt>
                      <dd className="truncate" title={lead.sentFrom ?? undefined}>
                        {lead.sentFrom ?? 'Not recorded'}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-ink-3">Last sent</dt>
                      <dd>{lead.lastContactedAt ? formatDateTime(lead.lastContactedAt) : 'Not recorded'}</dd>
                    </div>
                    <div>
                      <dt className="text-ink-3">Follow-up step</dt>
                      <dd>
                        {lead.lastStep === null ? (
                          '—'
                        ) : (
                          <>
                            <StepLabel step={lead.lastStep} />
                            {lead.maxSteps ? ` of ${lead.maxSteps}` : ''}
                          </>
                        )}
                        <span className="block text-[11px] text-ink-3">
                          {lead.lastReplyAt ? 'Sequence stopped: they replied' : lead.nextFollowupAt ? `Next ${formatDate(lead.nextFollowupAt)}` : 'No follow-up scheduled'}
                        </span>
                      </dd>
                    </div>
                  </dl>
                  <p className="mt-2 border-t border-line pt-2 text-[11.5px] text-ink-3">
                    {fmt(lead.sendsAccepted)} email{lead.sendsAccepted === 1 ? '' : 's'} sent
                    {lead.lastReplyAt ? ` · they replied ${relativeTime(lead.lastReplyAt)}` : ''}
                    {lead.lastResponseAt ? ` · you replied ${relativeTime(lead.lastResponseAt)}` : ''}
                    {lead.sourceName ? (
                      <>
                        {' '}
                        · Source:{' '}
                        {lead.sourceUrl ? (
                          <a href={lead.sourceUrl} className="link" target="_blank" rel="noreferrer noopener">
                            {lead.sourceName}
                          </a>
                        ) : (
                          lead.sourceName
                        )}
                      </>
                    ) : null}
                    {lead.suppressed ? ` · On the do-not-contact list (${lead.suppressionReason})` : ''}
                  </p>
                </section>
              ) : bounces.length === 0 && messages.some((m) => m.direction === 'inbound' && m.kind === 'message') ? (
                <section className="card space-y-2 border-warn/40 px-4 py-3 text-[12.5px]" aria-label="Link to a lead">
                  <p className="flex items-start gap-2 text-ink-2">
                    <Pill tone="warn">Unmatched</Pill>
                    <span>Not linked to a lead or campaign, so it is not counted as a reply. Link it, or mark it as not outreach.</span>
                  </p>
                  {suggested && (
                    <form action={assignThread} className="flex flex-wrap items-center gap-2 rounded-md bg-slate-50 px-3 py-2">
                      <input type="hidden" name="thread" value={thread} />
                      <input type="hidden" name="leadId" value={suggested.id} />
                      <span>
                        Likely match (same company domain): <b>{suggested.name ?? suggested.email}</b> · {suggested.campaignName}
                      </span>
                      <button className="btn btn-sm btn-primary">Link</button>
                    </form>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <form method="get" className="flex flex-1 flex-wrap items-center gap-2">
                      {Object.entries(sp)
                        .filter(([k, v]) => v && k !== 'leadq')
                        .map(([k, v]) => (
                          <input key={k} type="hidden" name={k} value={v} />
                        ))}
                      <label className="sr-only" htmlFor="leadq">
                        Find a lead
                      </label>
                      <input id="leadq" name="leadq" defaultValue={sp.leadq ?? ''} placeholder="Find lead by name, email or ID" className="field min-w-0 flex-1 py-1" />
                      <button className="btn btn-sm">Search</button>
                    </form>
                    {!messages.some((m) => m.matchMethod === 'manual_none') && (
                      <form action={unassignThread}>
                        <input type="hidden" name="thread" value={thread} />
                        <button className="btn btn-sm">Not outreach</button>
                      </form>
                    )}
                  </div>
                  {searchResults.length > 0 && (
                    <ul className="divide-y divide-line rounded-md border border-line">
                      {searchResults.map((r) => (
                        <li key={r.id} className="flex items-center justify-between gap-2 px-3 py-1.5">
                          <span className="min-w-0 truncate">
                            {r.name ?? '(no name)'} <span className="text-ink-3">{r.email}</span> · <span className="text-ink-2">{r.campaignName}</span>
                          </span>
                          <form action={assignThread}>
                            <input type="hidden" name="thread" value={thread} />
                            <input type="hidden" name="leadId" value={r.id} />
                            <button className="btn btn-sm btn-primary">Link</button>
                          </form>
                        </li>
                      ))}
                    </ul>
                  )}
                  {sp.leadq && searchResults.length === 0 && <p className="text-ink-3">No leads found for &ldquo;{sp.leadq}&rdquo;.</p>}
                  {messages.some((m) => m.matchMethod === 'manual_none') && <p className="text-ink-3">Marked as not outreach: it stays out of Needs reply and reply counts.</p>}
                </section>
              ) : null}

              {bounces.length > 0 && (
                <section className="card border-critical/30 px-4 py-3 text-[12.5px]" aria-label="Bounce details">
                  <h3 className="mb-2 flex items-center gap-1.5 font-semibold text-critical">
                    <MailWarning size={14} aria-hidden /> Could not be delivered
                  </h3>
                  <ul className="space-y-2">
                    {bounces.map((b) => (
                      <li key={b.recipient} className="grid gap-x-4 gap-y-0.5 sm:grid-cols-[1fr_auto]">
                        <span>
                          <b className="text-ink">{b.recipient}</b>{' '}
                          <Pill tone={b.bounceType === 'hard' ? 'critical' : 'warn'}>{b.bounceType === 'hard' ? 'Permanent' : b.bounceType === 'soft' ? 'Temporary' : 'Unknown type'}</Pill>
                          {b.statusCode ? <span className="ml-1 text-ink-3">{b.statusCode}</span> : null}
                        </span>
                        <span className="text-ink-3">{formatDateTime(b.occurredAt)}</span>
                        <span className="text-ink-2 sm:col-span-2">
                          {b.campaignSlug ? (
                            <>
                              Campaign:{' '}
                              <Link href={`/campaigns/${b.campaignSlug}`} className="link">
                                {b.campaignName}
                              </Link>
                            </>
                          ) : (
                            'Campaign: not matched'
                          )}
                          {b.leadId ? (
                            <>
                              {' '}
                              · Lead:{' '}
                              <Link href={`/leads/${b.leadId}`} className="link">
                                {b.leadName ?? b.recipient}
                              </Link>
                            </>
                          ) : null}
                          {b.sentFrom ? ` · Sent from ${b.sentFrom}` : ''}
                        </span>
                        {b.diagnostic && <span className="text-[11.5px] text-ink-3 sm:col-span-2">{b.diagnostic.slice(0, 240)}</span>}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              <ol className="space-y-3" aria-label="Messages">
                {messages.map((m) => {
                  const out = m.direction === 'outbound';
                  return (
                    <li key={m.id} className={`card overflow-hidden ${out ? 'border-l-4 border-l-brand/70' : m.kind === 'bounce' ? 'border-l-4 border-l-critical/70' : ''}`}>
                      <header className="flex items-start gap-3 px-4 pt-3 text-[12.5px]">
                        <span
                          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11.5px] font-semibold ${out ? 'bg-navy-800 text-white' : 'bg-brand-50 text-brand'}`}
                          aria-hidden
                        >
                          {initials(m.fromName || m.fromAddr)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                            <span className="font-semibold text-ink">
                              {m.fromName || m.fromAddr}
                              {m.fromName && <span className="ml-1 font-normal text-ink-3">&lt;{m.fromAddr}&gt;</span>}
                            </span>
                            <time className="text-ink-3" dateTime={m.sentAt?.toISOString()}>
                              {formatDateTime(m.sentAt)}
                            </time>
                          </div>
                          <div className="truncate text-ink-3">
                            to {m.toAddrs.join(', ')}
                            {m.ccAddrs.length ? ` · cc ${m.ccAddrs.join(', ')}` : ''} · {m.mailbox} · {m.folder}
                          </div>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {m.unread && <Pill tone="brand">Unread</Pill>}
                            {m.kind === 'bounce' && <Pill tone="critical">Bounce report</Pill>}
                            {m.kind === 'auto_reply' && (
                              <Pill>
                                <Bot size={11} aria-hidden /> Auto-reply (not counted)
                              </Pill>
                            )}
                            {m.kind === 'internal' && <Pill>Internal / automation</Pill>}
                            {out && m.sendAttemptId && (
                              <Pill tone="teal">
                                Outreach · <StepLabel step={m.step ?? 0} />
                              </Pill>
                            )}
                            {out && !m.sendAttemptId && m.kind !== 'internal' && <Pill tone="teal">Your reply</Pill>}
                            {m.hasAttachments && (
                              <Pill>
                                <Paperclip size={11} aria-hidden /> Attachment
                              </Pill>
                            )}
                          </div>
                        </div>
                      </header>
                      <MessageBody m={m} askBeforeUnread={policy.askBeforeUnread} />
                      {!out && m.kind === 'message' && m.leadId && (
                        <footer className="flex flex-wrap items-center gap-1 border-t border-line bg-slate-50/60 px-4 py-1.5 text-[11.5px]">
                          <span className="mr-1 text-ink-3">Classify:</span>
                          {SENTIMENTS.map(([value, label]) => (
                            <form key={value} action={setSentiment}>
                              <input type="hidden" name="messageId" value={m.id} />
                              <input type="hidden" name="sentiment" value={m.sentiment === value ? '' : value} />
                              <button
                                className={`rounded-full px-2 py-0.5 ${m.sentiment === value ? 'bg-brand text-white' : 'text-ink-2 hover:bg-slate-200'}`}
                                aria-pressed={m.sentiment === value}
                              >
                                {label}
                              </button>
                            </form>
                          ))}
                        </footer>
                      )}
                    </li>
                  );
                })}
                {pending.map((r) => (
                  <li key={`r${r.id}`} className={`card overflow-hidden border-l-4 ${r.status === 'failed' ? 'border-l-critical/70 opacity-80' : 'border-l-brand/70'}`}>
                    <header className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-3 text-[12.5px]">
                      <span className="font-semibold text-ink">
                        You <span className="font-normal text-ink-3">&lt;{r.fromAddr}&gt;</span>
                      </span>
                      <span className="text-ink-3">{formatDateTime(r.sentAt ?? r.createdAt)}</span>
                      <span className="w-full text-ink-3">to {[...r.toAddrs, ...r.ccAddrs].join(', ')} · sent from the dashboard</span>
                    </header>
                    <div className="px-4 pt-1">
                      {r.status === 'sent' && <Pill tone="teal">Sent · waiting for its Sent-folder copy</Pill>}
                      {r.status === 'sending' && <Pill tone="brand">Sending…</Pill>}
                      {r.status === 'unknown' && <Pill tone="warn">Not confirmed: check the Sent folder before resending</Pill>}
                      {r.status === 'failed' && <Pill tone="critical">Not sent: {r.errorMessage ?? 'refused by the mail server'}</Pill>}
                    </div>
                    <pre className="whitespace-pre-wrap break-words px-4 pb-3 pt-2 font-sans text-[13.5px] leading-relaxed text-ink">{r.bodyText}</pre>
                  </li>
                ))}
              </ol>

              {reply?.replyable && bounces.length === 0 ? (
                <ReplyComposer
                  key={thread}
                  thread={thread}
                  initialKey={randomUUID()}
                  options={reply.options.map((o) => ({ address: o.address, canSend: o.canSend, reason: o.reason }))}
                  defaultFrom={reply.defaultFrom}
                  defaultTo={reply.defaultTo}
                  subject={reply.subject}
                  warnings={[
                    ...unsubscribed.map((b) => `${b.address} ${b.reason}. Only reply if they wrote to you again.`),
                    ...hardBounced.map((b) => `${b.address}: ${b.reason}. Sending to it is blocked.`),
                  ]}
                  linkedTo={lead ? `${lead.name ?? lead.email} (${lead.campaignName})` : null}
                />
              ) : bounces.length > 0 ? (
                <p className="text-[12px] text-ink-3">Bounce reports come from the mail system, so there is nothing to reply to.</p>
              ) : null}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
