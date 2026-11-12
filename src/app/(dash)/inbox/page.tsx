import { randomUUID } from 'node:crypto';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  CheckCheck,
  ChevronDown,
  Clock,
  Filter,
  Inbox as InboxIcon,
  Layers,
  Mail,
  MailQuestion,
  MailWarning,
  Paperclip,
  Search,
  Send,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  UserRound,
  Workflow,
} from 'lucide-react';
import { assignThread, setSentiment, unassignThread } from '@/app/actions/data';
import { loadMessageBody, markHandled, setThreadRead, snoozeThread, unsnoozeThread } from '@/app/actions/inbox';
import { ContactButtons, IntentAvatar, IntentBadge, StageBadge } from '@/components/crm/LeadBits';
import { StagePicker } from '@/components/crm/LeadControls';
import { OpenEffects } from '@/components/inbox/OpenEffects';
import { ReplyComposer } from '@/components/inbox/ReplyComposer';
import { ScopePicker } from '@/components/inbox/ScopePicker';
import { StepLabel } from '@/components/status';
import { EmptyState, fmt } from '@/components/ui';
import { contactLinks } from '@/lib/crm/contact';
import { isStage } from '@/lib/crm/stages';
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
import { registry } from '@/lib/registry';
import { formatDate, formatDateTime, relativeTime } from '@/lib/time';

export const metadata = { title: 'Inbox' };

type SP = Record<string, string | undefined>;

const VIEW_META: Record<InboxView, { label: string; icon: typeof InboxIcon; count?: (c: InboxCounts) => number; help: string }> = {
  needs_you: {
    label: 'Needs you',
    icon: Sparkles,
    count: (c) => c.needsYou,
    help: 'Interested replies, questions, call requests and anything worth reading. "No", greetings, "thanks" and auto-replies are sorted into Screened out.',
  },
  screened: {
    label: 'Screened out',
    icon: Filter,
    count: (c) => c.screened,
    help: 'Waiting replies that do not need you: "no", unsubscribe, a bare greeting, "thanks" or an automatic reply. Glance through in case something was mis-sorted.',
  },
  inbox: { label: 'All received', icon: InboxIcon, count: (c) => c.inboxUnread, help: 'Every received conversation; the count is unread ones.' },
  snoozed: { label: 'Snoozed', icon: Clock, count: (c) => c.snoozed, help: 'Hidden until the time you picked, or until they write again.' },
  sent: { label: 'Sent', icon: Send, help: 'Conversations with something you or the outreach sent.' },
  bounces: { label: 'Bounces', icon: MailWarning, count: (c) => c.bounces30d, help: 'Emails that could not be delivered (last 30 days).' },
  spam: { label: 'Spam', icon: ShieldAlert, count: (c) => c.spamUnread, help: 'Unread conversations in Spam / Junk.' },
  unmatched: { label: 'Unmatched', icon: MailQuestion, count: (c) => c.unmatched30d, help: 'Replies not linked to a lead yet (last 30 days).' },
  internal: { label: 'Internal / automation', icon: Workflow, count: (c) => c.internalUnread, help: 'Reports, alerts and tests between your own addresses.' },
  all: { label: 'All mail', icon: Layers, help: 'Everything in the connected mailboxes.' },
};
const MAIN_VIEWS: InboxView[] = ['needs_you', 'screened', 'snoozed', 'sent'];
const MORE_VIEWS: InboxView[] = ['inbox', 'bounces', 'spam', 'unmatched', 'internal', 'all'];

const TYPE_LABEL: Record<MessageType, string> = {
  lead_reply: 'Replies from leads',
  human: 'Any human message',
  auto_reply: 'Auto-replies',
  bounce: 'Bounces',
  internal: 'Internal / automation',
};

const CLASSIFY = [
  ['positive', 'Interested'],
  ['not_interested', 'Not interested'],
  ['unsubscribe', 'Unsubscribe'],
  ['auto_reply', 'Auto-reply'],
] as const;

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

function Flag({ children, tone = 'slate' }: { children: React.ReactNode; tone?: 'slate' | 'red' | 'amber' | 'indigo' }) {
  const cls = { slate: 'bg-slate-100 text-slate-600', red: 'bg-red-50 text-red-700', amber: 'bg-amber-50 text-amber-800', indigo: 'bg-indigo-50 text-indigo-700' }[tone];
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>{children}</span>;
}

function ThreadItem({ t, sp, active }: { t: ThreadRow; sp: SP; active: boolean }) {
  const isOut = t.direction === 'outbound';
  const who = t.hasBounce
    ? `Bounce: ${t.bounceRecipients?.[0] ?? t.counterpart ?? 'unknown recipient'}`
    : isOut
      ? (t.leadName ?? t.counterpart ?? '(unknown)')
      : t.leadName || t.fromName || t.fromAddr || t.counterpart || '(unknown sender)';
  const snippet = t.hasBounce
    ? `Could not be delivered${t.bounceRecipients && t.bounceRecipients.length > 1 ? ` to ${t.bounceRecipients.length} recipients` : ''}${t.bounceCampaign ? ` · ${t.bounceCampaign}` : ''}`
    : t.snippet
      ? `${isOut ? 'You: ' : ''}${t.snippet}`
      : null;
  const unread = t.unread > 0;
  const intent = t.awaiting ? (t.openIntent ?? t.lastIntent) : t.lastIntent;
  return (
    <li>
      <Link
        href={href(sp, { thread: t.threadKey, leadq: undefined })}
        aria-current={active ? 'true' : undefined}
        className={`relative flex gap-3 px-4 py-3.5 transition-colors ${active ? 'bg-indigo-50/80' : 'hover:bg-slate-50'}`}
      >
        {active && <span className="absolute inset-y-2 left-0 w-1 rounded-r-full bg-brand" aria-hidden />}
        <IntentAvatar name={who} intent={t.hasBounce ? null : intent} size={40} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <span className={`truncate text-[14px] ${unread ? 'font-bold text-ink' : 'font-semibold text-ink'}`}>{who}</span>
            <time className={`shrink-0 text-[11.5px] ${unread ? 'font-semibold text-brand' : 'text-ink-3'}`} dateTime={t.lastAt?.toISOString()}>
              {shortTime(t.lastAt)}
            </time>
          </div>
          <div className={`truncate text-[12.5px] ${unread ? 'font-medium text-ink' : 'text-ink-2'}`}>{t.subject || '(no subject)'}</div>
          {snippet && <p className="mt-0.5 line-clamp-2 text-[12.5px] leading-snug text-ink-3">{snippet}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {!t.hasBounce && <IntentBadge intent={intent} />}
            {t.snoozed && t.snoozedUntil && (
              <Flag tone="indigo">
                <Clock size={11} aria-hidden /> {shortTime(t.snoozedUntil)}
              </Flag>
            )}
            {t.hasBounce && <Flag tone="red">Bounced</Flag>}
            {t.unmatched && <Flag tone="amber">Unmatched</Flag>}
            {t.flagged && <Flag tone="amber">Follow up</Flag>}
            {(t.campaignName ?? t.bounceCampaign) && <span className="max-w-[55%] truncate text-[11px] text-ink-3">{t.campaignName ?? t.bounceCampaign}</span>}
            {t.messages > 1 && <span className="text-[11px] text-ink-3">· {t.messages} messages</span>}
          </div>
        </div>
      </Link>
    </li>
  );
}

function MailboxStatus({ boxes }: { boxes: MailboxHealth[] }) {
  const problems = boxes.filter((b) => b.lastStatus !== 'ok');
  return (
    <details className="group rounded-xl bg-slate-50 px-3 py-2 text-[12px]" open={problems.length > 0}>
      <summary className="flex cursor-pointer list-none items-center justify-between font-semibold text-ink-2">
        <span className="flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${problems.length ? 'bg-critical' : 'bg-emerald-500'}`} aria-hidden />
          Mailboxes
        </span>
        <span className={`font-normal ${problems.length ? 'text-critical' : 'text-ink-3'}`}>
          {boxes.length - problems.length}/{boxes.length} syncing <ChevronDown size={12} className="inline transition-transform group-open:rotate-180" aria-hidden />
        </span>
      </summary>
      <ul className="mt-2 space-y-1.5">
        {boxes.map((b) => {
          const tone = b.lastStatus === 'ok' ? 'bg-emerald-500' : b.lastStatus === 'error' ? 'bg-critical' : 'bg-slate-300';
          const state = b.lastStatus === 'ok' ? 'Syncing' : b.lastStatus === 'error' ? 'Sync failing' : 'Not connected';
          return (
            <li key={b.address} className="flex items-start gap-2" title={b.lastError ?? undefined}>
              <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${tone}`} aria-hidden />
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
    </details>
  );
}

function MessageBody({ m, askBeforeUnread }: { m: ThreadMessage; askBeforeUnread: boolean }) {
  if (m.bodyText) {
    const { main, quoted } = splitQuoted(m.bodyText);
    return (
      <div>
        <p className="whitespace-pre-wrap break-words text-[14px] leading-relaxed text-ink">{main || '(empty message)'}</p>
        {quoted && (
          <details className="mt-2 text-[12.5px]">
            <summary className="cursor-pointer text-ink-3 hover:text-ink-2">Show quoted text</summary>
            <pre className="mt-1 max-h-80 overflow-auto whitespace-pre-wrap break-words border-l-2 border-line pl-3 font-sans text-ink-3">{quoted}</pre>
          </details>
        )}
        {m.bodyHtml && (
          <details className="mt-2 text-[12.5px]">
            <summary className="cursor-pointer text-ink-3 hover:text-ink-2">Show formatted version</summary>
            <iframe title={`Message ${m.id}`} sandbox="" srcDoc={emailDoc(m.bodyHtml)} className="mt-1 h-80 w-full rounded-lg border border-line bg-white" />
          </details>
        )}
      </div>
    );
  }
  if (m.bodyHtml) return <iframe title={`Message ${m.id}`} sandbox="" srcDoc={emailDoc(m.bodyHtml)} className="h-72 w-full rounded-lg border border-line bg-white" />;
  if (m.kind === 'bounce') return <p className="text-[12.5px] text-ink-3">The failed recipient and reason are shown above.</p>;
  if (m.unseen && askBeforeUnread) {
    return (
      <form action={loadMessageBody} className="flex flex-wrap items-center gap-2 text-[12.5px]">
        <input type="hidden" name="messageId" value={m.id} />
        <span className="flex items-center gap-1.5 text-warn">
          <AlertTriangle size={13} aria-hidden /> Loading this unread message will mark it read in the mailbox ({m.mailbox}).
        </span>
        <button className="btn btn-sm">Load anyway</button>
      </form>
    );
  }
  return <p className="text-[12.5px] text-ink-3">Loading message… (only headers are synced for older mail; open again if it does not appear)</p>;
}

export default async function InboxPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const requested = sp.view === 'needs_reply' ? 'needs_you' : sp.view;
  const view: InboxView = (INBOX_VIEWS as readonly string[]).includes(requested ?? '') ? (requested as InboxView) : 'needs_you';
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
  const scopeLabel = scope.mailbox ?? (scope.domain ? `All mailboxes on ${scope.domain}` : 'All mailboxes');
  const activeFilters: [string, string][] = [];
  if (sp.campaign) activeFilters.push(['campaign', campaigns.find((c) => c.slug === sp.campaign)?.name ?? sp.campaign]);
  if (sp.unread === '1') activeFilters.push(['unread', 'Unread']);
  if (sp.needs === '1') activeFilters.push(['needs', 'Needs you']);
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
  const contactName = lead?.name ?? lastHuman?.fromName ?? lastHuman?.fromAddr ?? null;
  const links = lead
    ? contactLinks({ phone: lead.phone, waChatId: lead.waChatId, email: lead.email, dialCode: registry().sources.find((s) => s.key === lead.sourceKey)?.dialCode })
    : null;
  const headIntent = lastHuman?.intent ?? null;

  const viewLink = (v: InboxView, compact = false) => {
    const meta = VIEW_META[v];
    const n = meta.count?.(counts) ?? 0;
    const Icon = meta.icon;
    const on = v === view;
    const primary = v === 'needs_you';
    return (
      <Link
        key={v}
        href={href({ domain: sp.domain, mailbox: sp.mailbox }, { view: v === 'needs_you' ? undefined : v })}
        aria-current={on ? 'page' : undefined}
        title={meta.help}
        className={`flex items-center gap-2.5 rounded-xl px-3 ${compact ? 'py-1.5 text-[12.5px]' : 'py-2 text-[13.5px]'} ${
          on ? 'bg-white font-semibold text-ink shadow-[var(--shadow-card)] ring-1 ring-line' : 'text-ink-2 hover:bg-white/70'
        }`}
      >
        <Icon size={compact ? 14 : 16} aria-hidden className={on ? 'text-brand' : 'text-ink-3'} />
        <span className="flex-1">{meta.label}</span>
        {meta.count && n > 0 && (
          <span className={`tabular rounded-full px-2 text-[11.5px] font-semibold leading-5 ${primary ? 'bg-brand text-white' : 'text-ink-3'}`}>{fmt(n)}</span>
        )}
      </Link>
    );
  };

  const mailboxOptions = boxes.map((b) => ({ address: b.address, domain: b.domain, ok: b.lastStatus === 'ok' }));

  return (
    <div data-fullbleed className="flex min-h-[calc(100dvh-56px)] flex-col bg-canvas lg:h-full lg:min-h-0 lg:flex-row">
      {/* 1. Views (desktop) */}
      <aside className="hidden w-60 shrink-0 flex-col gap-4 overflow-y-auto border-r border-line bg-canvas px-3 py-5 lg:flex" aria-label="Inbox navigation">
        <div className="px-1">
          <h1 className="text-[20px] font-bold tracking-tight text-ink">Inbox</h1>
          <p className="text-[12px] text-ink-3">{scopeLabel}</p>
        </div>
        <ScopePicker mailboxes={mailboxOptions} />
        <nav aria-label="Inbox views" className="space-y-1">
          {MAIN_VIEWS.map((v) => viewLink(v))}
          <details className="group pt-2" open={MORE_VIEWS.includes(view)}>
            <summary className="flex cursor-pointer list-none items-center justify-between px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-ink-3 hover:text-ink-2">
              More
              <ChevronDown size={13} className="transition-transform group-open:rotate-180" aria-hidden />
            </summary>
            <div className="space-y-0.5">{MORE_VIEWS.map((v) => viewLink(v, true))}</div>
          </details>
        </nav>
        <div className="mt-auto">
          <MailboxStatus boxes={boxes} />
        </div>
      </aside>

      {/* 2. Conversation list */}
      <section
        className={`${thread ? 'hidden lg:flex' : 'flex'} min-h-0 w-full shrink-0 flex-col border-r border-line bg-white lg:w-[360px] xl:w-[400px]`}
        aria-label="Conversations"
      >
        <div className="space-y-3 border-b border-line px-4 pb-3 pt-4">
          <div className="lg:hidden">
            <h1 className="mb-3 text-[22px] font-bold tracking-tight text-ink">Inbox</h1>
            <div className="grid grid-cols-2 gap-1 rounded-2xl bg-slate-100 p-1" role="navigation" aria-label="Inbox views">
              {(['needs_you', 'screened'] as InboxView[]).map((v) => {
                const n = VIEW_META[v].count?.(counts) ?? 0;
                const on = v === view;
                return (
                  <Link
                    key={v}
                    href={href({ domain: sp.domain, mailbox: sp.mailbox }, { view: v === 'needs_you' ? undefined : v })}
                    aria-current={on ? 'page' : undefined}
                    className={`flex items-center justify-center gap-1.5 rounded-xl py-2 text-[13.5px] font-semibold ${on ? 'bg-white text-ink shadow-sm' : 'text-ink-2'}`}
                  >
                    {VIEW_META[v].label}
                    {n > 0 && <span className={`rounded-full px-1.5 text-[11px] leading-[18px] tabular ${v === 'needs_you' ? 'bg-brand text-white' : 'bg-slate-200 text-ink-2'}`}>{n}</span>}
                  </Link>
                );
              })}
            </div>
            <div className="no-scrollbar -mx-4 mt-2 flex gap-1.5 overflow-x-auto px-4">
              {(['snoozed', 'sent', ...MORE_VIEWS] as InboxView[]).map((v) => {
                const n = VIEW_META[v].count?.(counts) ?? 0;
                return (
                  <Link key={v} href={href({ domain: sp.domain, mailbox: sp.mailbox }, { view: v })} aria-current={v === view ? 'page' : undefined} className="chip !min-h-8 !py-1 !text-[12px]">
                    {VIEW_META[v].label}
                    {VIEW_META[v].count && n > 0 ? <span className="tabular opacity-70">{n}</span> : null}
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
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" aria-hidden />
              <input name="q" type="search" defaultValue={sp.q ?? ''} placeholder="Search people, subject, text…" className="field h-10 w-full rounded-xl bg-slate-50 pl-9" />
            </label>
            <details className="relative">
              <summary className="icon-btn cursor-pointer list-none ring-1 ring-line" aria-label="Filters">
                <SlidersHorizontal size={16} aria-hidden />
                {activeFilters.filter(([k]) => k !== 'q').length > 0 && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-brand" aria-hidden />}
              </summary>
              <div className="absolute right-0 z-30 mt-1 w-72 space-y-2.5 rounded-2xl border border-line bg-white p-4 text-[12.5px] shadow-[var(--shadow-pop)]">
                <div className="lg:hidden">
                  <div className="mb-1 font-medium text-ink-2">Mailbox</div>
                  <ScopePicker mailboxes={mailboxOptions} compact />
                </div>
                <label className="block font-medium text-ink-2">
                  Campaign
                  <select name="campaign" defaultValue={sp.campaign ?? ''} className="field mt-1 w-full">
                    <option value="">All campaigns</option>
                    {campaigns.map((c) => (
                      <option key={c.slug} value={c.slug}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block font-medium text-ink-2">
                  Lead match
                  <select name="match" defaultValue={sp.match ?? ''} className="field mt-1 w-full">
                    <option value="">Matched and unmatched</option>
                    <option value="matched">Matched to a lead</option>
                    <option value="unmatched">Unmatched</option>
                  </select>
                </label>
                <label className="block font-medium text-ink-2">
                  Message type
                  <select name="type" defaultValue={type ?? ''} className="field mt-1 w-full">
                    <option value="">Any type</option>
                    {MESSAGE_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {TYPE_LABEL[t]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block font-medium text-ink-2">
                  Sort
                  <select name="sort" defaultValue={sp.sort ?? 'newest'} className="field mt-1 w-full">
                    <option value="newest">Newest first</option>
                    <option value="oldest">Oldest first</option>
                  </select>
                </label>
                <label className="flex items-center gap-2 text-ink-2">
                  <input type="checkbox" name="unread" value="1" defaultChecked={sp.unread === '1'} /> Unread only
                </label>
                <label className="flex items-center gap-2 text-ink-2">
                  <input type="checkbox" name="needs" value="1" defaultChecked={sp.needs === '1'} /> Needs you only
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
          <p className="text-[12px] leading-snug text-ink-3">{VIEW_META[view].help}</p>
          {(activeFilters.length > 0 || scope.domain || scope.mailbox) && (
            <div className="flex flex-wrap items-center gap-1.5 text-[11.5px]">
              {(scope.domain || scope.mailbox) && (
                <Link href={href(sp, { domain: undefined, mailbox: undefined, page: undefined, thread: undefined })} className="rounded-full bg-indigo-50 px-2 py-0.5 text-indigo-700" title="Show all mailboxes">
                  {scopeLabel} ✕
                </Link>
              )}
              {activeFilters.map(([k, label]) => (
                <Link key={k} href={href(sp, { [k]: undefined, page: undefined })} className="rounded-full bg-slate-100 px-2 py-0.5 text-ink-2" title="Remove filter">
                  {label} ✕
                </Link>
              ))}
            </div>
          )}
          {problems.length > 0 && (
            <p className="flex items-start gap-1.5 rounded-xl bg-critical-50 px-3 py-2 text-[12px] text-critical">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden />
              <span>
                {problems.length} mailbox{problems.length === 1 ? ' is' : 'es are'} not syncing: {problems.map((p) => p.address).join(', ')}.{' '}
                <Link href="/integrations" className="underline">
                  Details
                </Link>
              </span>
            </p>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {threads.rows.length === 0 ? (
            <EmptyState
              icon={<Sparkles size={28} className="text-emerald-500" aria-hidden />}
              title={view === 'needs_you' && !activeFilters.length ? 'You are all caught up' : 'No conversations here'}
            >
              {view === 'needs_you' && !activeFilters.length
                ? `Nothing interested or unanswered is waiting.${counts.screened ? ` ${counts.screened} screened-out repl${counts.screened === 1 ? 'y is' : 'ies are'} under Screened out.` : ''}`
                : 'Try another view, mailbox or filter.'}
            </EmptyState>
          ) : (
            <ul className="divide-y divide-line/70">
              {threads.rows.map((t) => (
                <ThreadItem key={t.threadKey} t={t} sp={sp} active={t.threadKey === thread} />
              ))}
            </ul>
          )}
          {threads.total > PAGE_SIZE && (
            <div className="flex items-center justify-between border-t border-line px-4 py-2.5 text-xs">
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
      <main className={`${thread ? 'flex' : 'hidden lg:flex'} min-h-0 min-w-0 flex-1 flex-col bg-canvas`} aria-label="Conversation">
        {!thread || (messages.length === 0 && pending.length === 0) ? (
          <div className="flex flex-1 items-center justify-center p-8">
            <EmptyState icon={<Mail size={30} className="text-ink-3" aria-hidden />} title={thread ? 'This conversation is no longer available' : 'Pick a conversation'}>
              {thread ? 'It may have been moved or deleted in the mailbox.' : 'Read it, see the lead and campaign, move it along the pipeline and reply, all from here.'}
            </EmptyState>
          </div>
        ) : (
          <>
            <OpenEffects thread={thread} unread={threadUnread} missingBodies={missingBodies} />
            {/* Toolbar */}
            <div className="no-scrollbar flex items-center gap-1.5 overflow-x-auto whitespace-nowrap border-b border-line bg-white/90 px-3 py-2 text-[12.5px] backdrop-blur sm:flex-wrap sm:px-4">
              <Link href={href(sp, { thread: undefined, leadq: undefined })} className="icon-btn lg:hidden" aria-label="Back to conversations">
                <ArrowLeft size={19} aria-hidden />
              </Link>
              {waitingOnYou ? (
                <form action={markHandled}>
                  <input type="hidden" name="thread" value={thread} />
                  <button className="btn btn-sm border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100" title="Take it off your list until they write again">
                    <CheckCheck size={14} aria-hidden /> Done
                  </button>
                </form>
              ) : state?.handledAt ? (
                <form action={markHandled}>
                  <input type="hidden" name="thread" value={thread} />
                  <input type="hidden" name="undo" value="1" />
                  <button className="btn btn-sm">Move back to Needs you</button>
                </form>
              ) : null}
              {snoozed ? (
                <form action={unsnoozeThread} className="flex items-center gap-1.5">
                  <input type="hidden" name="thread" value={thread} />
                  <span className="text-indigo-700">
                    <Clock size={13} className="inline" aria-hidden /> Until {formatDateTime(state!.snoozedUntil)}
                  </span>
                  <button className="btn btn-sm">Unsnooze</button>
                </form>
              ) : (
                <details className="relative">
                  <summary className="btn btn-sm cursor-pointer list-none">
                    <Clock size={14} aria-hidden /> Snooze
                  </summary>
                  <form action={snoozeThread} className="absolute left-0 z-30 mt-1 w-64 space-y-1 rounded-2xl border border-line bg-white p-2 shadow-[var(--shadow-pop)]">
                    <input type="hidden" name="thread" value={thread} />
                    <p className="px-2 pb-1 text-[11.5px] text-ink-3">Hide it until then. It comes back sooner if they write again.</p>
                    {[
                      ['later', 'Later today (6 pm)'],
                      ['tomorrow', 'Tomorrow, 9 am'],
                      ['monday', 'Next Monday, 9 am'],
                      ['week', 'In a week, 9 am'],
                    ].map(([v, label]) => (
                      <button key={v} name="preset" value={v} className="block w-full rounded-lg px-2 py-1.5 text-left hover:bg-slate-100">
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
                  <button className="btn btn-sm text-ink-3" title="Unlink from the lead; it is not counted as a reply">
                    Not outreach
                  </button>
                </form>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="mx-auto max-w-3xl space-y-4 px-3 py-4 sm:px-5 lg:py-6">
                {/* Who and what */}
                <section className="card p-4 sm:p-5">
                  <div className="flex items-start gap-3.5">
                    <IntentAvatar name={contactName} intent={headIntent} size={48} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {lead ? (
                          <Link href={`/leads/${lead.id}`} className="text-[17px] font-bold leading-tight tracking-tight text-ink hover:underline sm:text-[18px]">
                            {contactName}
                          </Link>
                        ) : (
                          <span className="text-[18px] font-bold leading-tight tracking-tight text-ink">{contactName ?? 'Unknown sender'}</span>
                        )}
                        <IntentBadge intent={headIntent} />
                        {lead && isStage(lead.stage) && <StageBadge stage={lead.stage} />}
                      </div>
                      <p className="mt-0.5 truncate text-[13px] text-ink-3">{subject || '(no subject)'}</p>
                      {lead && (
                        <p className="mt-0.5 text-[12.5px] text-ink-3">
                          {[lead.category, lead.city, lead.country].filter(Boolean).join(' · ')}
                          {lead.category || lead.city || lead.country ? ' · ' : ''}
                          <Link href={`/campaigns/${lead.campaignSlug}`} className="text-indigo-700 hover:underline">
                            {lead.campaignName}
                          </Link>
                        </p>
                      )}
                    </div>
                    {links && (
                      <div className="hidden sm:block">
                        <ContactButtons links={links} name={contactName} />
                      </div>
                    )}
                  </div>
                  {links && (
                    <div className="mt-3 sm:hidden">
                      <ContactButtons links={links} name={contactName} />
                    </div>
                  )}
                  {lead && (
                    <>
                      <div className="mt-4 border-t border-line pt-3">
                        <div className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-ink-3">Pipeline stage</div>
                        <StagePicker leadId={lead.id} stage={isStage(lead.stage) ? lead.stage : null} />
                      </div>
                      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-[12.5px] sm:grid-cols-4">
                        <div className="min-w-0">
                          <dt className="text-ink-3">Sent from</dt>
                          <dd className="truncate text-ink" title={lead.sentFrom ?? undefined}>
                            {lead.sentFrom ?? '—'}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-ink-3">Last sent</dt>
                          <dd className="text-ink">{lead.lastContactedAt ? formatDate(lead.lastContactedAt) : '—'}</dd>
                        </div>
                        <div>
                          <dt className="text-ink-3">Sequence</dt>
                          <dd className="text-ink">
                            {lead.lastStep === null ? '—' : <StepLabel step={lead.lastStep} />}
                            {lead.lastStep !== null && lead.maxSteps ? ` of ${lead.maxSteps}` : ''}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-ink-3">Next</dt>
                          <dd className="text-ink">{lead.lastReplyAt ? 'Stopped (they replied)' : lead.nextFollowupAt ? formatDate(lead.nextFollowupAt) : 'None'}</dd>
                        </div>
                      </dl>
                      {lead.suppressed && (
                        <p className="mt-3 rounded-xl bg-critical-50 px-3 py-2 text-[12.5px] text-critical">On the do-not-contact list ({lead.suppressionReason}).</p>
                      )}
                    </>
                  )}
                  {!lead && bounces.length === 0 && messages.some((m) => m.direction === 'inbound' && m.kind === 'message') && (
                    <div className="mt-4 space-y-2 border-t border-line pt-3 text-[12.5px]">
                      <p className="flex items-start gap-2 text-ink-2">
                        <UserRound size={15} className="mt-0.5 shrink-0 text-amber-600" aria-hidden />
                        <span>Not linked to a lead yet, so it is not counted as a reply. Link it, or mark it as not outreach.</span>
                      </p>
                      {suggested && (
                        <form action={assignThread} className="flex flex-wrap items-center gap-2 rounded-xl bg-amber-50 px-3 py-2">
                          <input type="hidden" name="thread" value={thread} />
                          <input type="hidden" name="leadId" value={suggested.id} />
                          <span className="flex-1">
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
                          <input id="leadq" name="leadq" defaultValue={sp.leadq ?? ''} placeholder="Find lead by name, email or ID" className="field min-w-0 flex-1" />
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
                        <ul className="divide-y divide-line rounded-xl border border-line">
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
                      {messages.some((m) => m.matchMethod === 'manual_none') && <p className="text-ink-3">Marked as not outreach: it stays out of Needs you and reply counts.</p>}
                    </div>
                  )}
                </section>

                {bounces.length > 0 && (
                  <section className="card border-red-200 p-4 text-[12.5px]" aria-label="Bounce details">
                    <h3 className="mb-2 flex items-center gap-1.5 font-semibold text-critical">
                      <MailWarning size={14} aria-hidden /> Could not be delivered
                    </h3>
                    <ul className="space-y-2">
                      {bounces.map((b) => (
                        <li key={b.recipient} className="grid gap-x-4 gap-y-0.5 sm:grid-cols-[1fr_auto]">
                          <span>
                            <b className="text-ink">{b.recipient}</b>{' '}
                            <Flag tone={b.bounceType === 'hard' ? 'red' : 'amber'}>{b.bounceType === 'hard' ? 'Permanent' : b.bounceType === 'soft' ? 'Temporary' : 'Unknown type'}</Flag>
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

                {/* Conversation */}
                <ol className="space-y-3" aria-label="Messages">
                  {messages.map((m) => {
                    const out = m.direction === 'outbound';
                    const classifiable = !out && m.kind === 'message' && m.leadId;
                    return (
                      <li key={m.id} className={`flex ${out ? 'justify-end' : 'justify-start'}`}>
                        <article
                          className={`w-full max-w-[92%] overflow-hidden rounded-2xl shadow-[var(--shadow-card)] ring-1 sm:max-w-[85%] ${
                            out ? 'rounded-tr-md bg-indigo-50/80 ring-indigo-100' : m.kind === 'bounce' ? 'rounded-tl-md bg-white ring-red-200' : 'rounded-tl-md bg-white ring-line'
                          }`}
                        >
                          <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-4 pt-3 text-[12px]">
                            <span className="font-semibold text-ink">
                              {out ? (m.sendAttemptId ? 'Outreach' : 'You') : m.fromName || m.fromAddr}
                              <span className="ml-1.5 font-normal text-ink-3">{out ? m.fromAddr : m.fromName ? m.fromAddr : ''}</span>
                            </span>
                            <time className="text-ink-3" dateTime={m.sentAt?.toISOString()}>
                              {formatDateTime(m.sentAt)}
                            </time>
                          </header>
                          <div className="mt-1 flex flex-wrap gap-1 px-4">
                            {m.unread && <Flag tone="indigo">Unread</Flag>}
                            {m.kind === 'bounce' && <Flag tone="red">Bounce report</Flag>}
                            {m.kind === 'auto_reply' && (
                              <Flag>
                                <Bot size={11} aria-hidden /> Auto-reply
                              </Flag>
                            )}
                            {m.kind === 'internal' && <Flag>Internal / automation</Flag>}
                            {out && m.sendAttemptId && (
                              <Flag tone="indigo">
                                <StepLabel step={m.step ?? 0} />
                              </Flag>
                            )}
                            {m.hasAttachments && (
                              <Flag>
                                <Paperclip size={11} aria-hidden /> Attachment
                              </Flag>
                            )}
                            <span className="text-[11px] text-ink-3">
                              {out ? `to ${m.toAddrs.join(', ')}` : `to ${m.mailbox}`}
                              {m.ccAddrs.length ? ` · cc ${m.ccAddrs.join(', ')}` : ''}
                            </span>
                          </div>
                          <div className="px-4 pb-3 pt-2">
                            <MessageBody m={m} askBeforeUnread={policy.askBeforeUnread} />
                          </div>
                          {classifiable && (
                            <footer className="flex flex-wrap items-center gap-1.5 border-t border-line bg-slate-50/70 px-4 py-2 text-[11.5px]">
                              <span className="mr-0.5 text-ink-3">{m.sentiment ? 'You marked' : 'Sorted as'}</span>
                              <IntentBadge intent={m.intent} />
                              <details className="relative">
                                <summary className="cursor-pointer list-none rounded-full px-2 py-0.5 text-indigo-700 hover:bg-indigo-50">Change</summary>
                                <div className="absolute left-0 z-20 mt-1 flex w-56 flex-col gap-0.5 rounded-xl border border-line bg-white p-1.5 shadow-[var(--shadow-pop)]">
                                  {CLASSIFY.map(([value, label]) => (
                                    <form key={value} action={setSentiment}>
                                      <input type="hidden" name="messageId" value={m.id} />
                                      <input type="hidden" name="sentiment" value={value} />
                                      <button className={`w-full rounded-lg px-2.5 py-1.5 text-left text-[12.5px] hover:bg-slate-100 ${m.sentiment === value ? 'font-semibold text-ink' : 'text-ink-2'}`}>{label}</button>
                                    </form>
                                  ))}
                                  {m.sentiment && (
                                    <form action={setSentiment}>
                                      <input type="hidden" name="messageId" value={m.id} />
                                      <input type="hidden" name="sentiment" value="" />
                                      <button className="w-full rounded-lg px-2.5 py-1.5 text-left text-[12.5px] text-ink-3 hover:bg-slate-100">Back to automatic</button>
                                    </form>
                                  )}
                                </div>
                              </details>
                            </footer>
                          )}
                        </article>
                      </li>
                    );
                  })}
                  {pending.map((r) => (
                    <li key={`r${r.id}`} className="flex justify-end">
                      <article className={`w-full max-w-[92%] rounded-2xl rounded-tr-md px-4 py-3 shadow-[var(--shadow-card)] ring-1 sm:max-w-[85%] ${r.status === 'failed' ? 'bg-red-50 ring-red-200' : 'bg-indigo-50/80 ring-indigo-100'}`}>
                        <header className="flex flex-wrap items-baseline justify-between gap-2 text-[12px]">
                          <span className="font-semibold text-ink">
                            You <span className="font-normal text-ink-3">{r.fromAddr}</span>
                          </span>
                          <span className="text-ink-3">{formatDateTime(r.sentAt ?? r.createdAt)}</span>
                        </header>
                        <div className="mt-1 text-[11.5px]">
                          {r.status === 'sent' && <span className="text-emerald-700">Sent · its Sent-folder copy appears at the next sync</span>}
                          {r.status === 'sending' && <span className="text-indigo-700">Sending…</span>}
                          {r.status === 'unknown' && <span className="text-amber-700">Not confirmed: check the Sent folder before resending</span>}
                          {r.status === 'failed' && <span className="text-critical">Not sent: {r.errorMessage ?? 'refused by the mail server'}</span>}
                        </div>
                        <p className="mt-2 whitespace-pre-wrap break-words text-[14px] leading-relaxed text-ink">{r.bodyText}</p>
                      </article>
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
                  <p className="text-center text-[12px] text-ink-3">Bounce reports come from the mail system, so there is nothing to reply to.</p>
                ) : null}
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
