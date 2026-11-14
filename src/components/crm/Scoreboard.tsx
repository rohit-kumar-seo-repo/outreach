// "What we got": totals and one row per outreach source for a period. Server component.
import Link from 'next/link';
import { AlertTriangle, ArrowRight, CalendarCheck, CheckCheck, CirclePause, Mail, MessageCircle, MessageSquareReply, Send, Sparkles, Trophy } from 'lucide-react';
import { money } from '@/lib/crm/present';
import { RANGES, isActive, type Range, type Scoreboard as Board, type SourceHealth, type SourceScore } from '@/lib/metrics/scoreboard';
import { relativeTime } from '@/lib/time';

const nf = new Intl.NumberFormat('en-IN');
const n = (v: number) => nf.format(v);

const METRICS = [
  { key: 'sent', label: 'Sent', tint: 'tint-contacted', icon: Send },
  { key: 'replies', label: 'Replies', tint: 'tint-new', icon: MessageSquareReply },
  { key: 'interested', label: 'Interested', tint: 'tint-interested', icon: Sparkles },
  { key: 'meetings', label: 'Meetings', tint: 'tint-meeting', icon: CalendarCheck },
  { key: 'won', label: 'Won', tint: 'tint-won', icon: Trophy },
] as const;

const HEALTH: Record<SourceHealth, { label: string; cls: string; icon?: typeof AlertTriangle }> = {
  sending: { label: 'Sending', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  paused: { label: 'Paused', cls: 'bg-slate-100 text-slate-600 ring-slate-200', icon: CirclePause },
  idle: { label: 'Not sending', cls: 'bg-amber-50 text-amber-800 ring-amber-200', icon: AlertTriangle },
  finished: { label: 'List finished', cls: 'bg-indigo-50 text-indigo-700 ring-indigo-200', icon: CheckCheck },
  new: { label: 'Not started', cls: 'bg-slate-100 text-slate-600 ring-slate-200' },
};

export function HealthPill({ health }: { health: SourceHealth }) {
  const h = HEALTH[health];
  const Icon = h.icon;
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-semibold ring-1 ring-inset ${h.cls}`}>
      {health === 'sending' ? <span className="attn-call pulse-dot !h-1.5 !w-1.5" aria-hidden /> : Icon ? <Icon size={12} aria-hidden /> : null}
      {h.label}
    </span>
  );
}

export function ChannelIcon({ channel, size = 30 }: { channel: 'email' | 'whatsapp'; size?: number }) {
  return channel === 'whatsapp' ? (
    <span style={{ width: size, height: size }} className="inline-flex shrink-0 items-center justify-center rounded-[10px] bg-gradient-to-br from-[#25d366] to-[#128c7e] text-white" title="WhatsApp">
      <MessageCircle size={Math.round(size * 0.52)} aria-hidden />
    </span>
  ) : (
    <span style={{ width: size, height: size }} className="inline-flex shrink-0 items-center justify-center rounded-[10px] bg-gradient-to-br from-indigo-500 to-violet-500 text-white" title="Email">
      <Mail size={Math.round(size * 0.52)} aria-hidden />
    </span>
  );
}

export function RangeSwitch({ range, hrefFor }: { range: Range; hrefFor: (r: Range) => string }) {
  return (
    <nav className="seg seg-sm" aria-label="Period">
      {(Object.keys(RANGES) as Range[]).map((r) => (
        <Link key={r} href={hrefFor(r)} aria-current={r === range ? 'page' : undefined} scroll={false}>
          {RANGES[r].label}
        </Link>
      ))}
    </nav>
  );
}

function SourceRow({ s, detail }: { s: SourceScore; detail: boolean }) {
  const quiet = s.sent + s.replies + s.meetings + s.won === 0;
  return (
    <li className="card relative transition-shadow hover:shadow-[var(--shadow-pop)]">
      {detail ? (
        <Link href={`/campaigns/${encodeURIComponent(s.slug)}`} className="absolute inset-0 z-0 rounded-[inherit]" aria-label={`Details for ${s.name}`} />
      ) : (
        <Link href={`/leads?view=all&campaign=${encodeURIComponent(s.slug)}`} className="absolute inset-0 z-0 rounded-[inherit]" aria-label={`Leads from ${s.name}`} />
      )}
      <div className="pointer-events-none relative z-10 flex flex-col gap-3 p-3.5 md:flex-row md:items-center md:gap-4 md:px-4">
        <div className="flex min-w-0 items-center gap-3 md:w-[36%]">
          <ChannelIcon channel={s.channel} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[14.5px] font-semibold text-ink">{s.name}</div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-ink-3">
              <HealthPill health={s.health} />
              <span className="whitespace-nowrap">
                {s.lastSendAt ? `last sent ${relativeTime(s.lastSendAt)}` : 'nothing sent yet'}
                {s.remaining > 0 ? ` · ${n(s.remaining)} to contact` : ''}
              </span>
            </div>
          </div>
        </div>
        <dl className={`grid flex-1 grid-cols-5 gap-1 text-center ${quiet ? 'opacity-60' : ''}`}>
          {METRICS.map((m) => {
            const v = s[m.key];
            return (
              <div key={m.key} className="min-w-0">
                <dd className={`text-[17px] font-bold leading-tight tabular ${v > 0 ? 'text-ink' : 'text-ink-3/70'}`}>{n(v)}</dd>
                <dt className="truncate text-[10.5px] font-medium text-ink-3">{m.label}</dt>
              </div>
            );
          })}
        </dl>
        <div className={`md:w-32 md:text-right ${s.needYou > 0 ? '' : 'hidden md:block'}`}>
          {s.needYou > 0 && (
            <Link
              href={`/leads?view=focus&campaign=${encodeURIComponent(s.slug)}`}
              className="attn-reply pointer-events-auto inline-flex min-h-8 items-center gap-1.5 whitespace-nowrap rounded-full bg-gradient-to-r from-indigo-50 to-pink-50 px-2.5 text-[12px] font-semibold text-indigo-700 ring-1 ring-inset ring-indigo-200/80 hover:from-indigo-100 hover:to-pink-100"
            >
              <span className="pulse-dot !h-1.5 !w-1.5" aria-hidden />
              {s.needYou} need{s.needYou === 1 ? 's' : ''} you
              <ArrowRight size={13} aria-hidden />
            </Link>
          )}
        </div>
      </div>
    </li>
  );
}

/**
 * `showAll` lists every source; otherwise sources with nothing in the period (and nothing that
 * needs you) fold into one line so the list stays short. A row opens that source's leads, or with
 * `detail` its full campaign page.
 */
export function Scoreboard({
  board,
  hrefFor,
  showAll = false,
  detail = false,
  moreHref,
}: {
  board: Board;
  hrefFor: (r: Range) => string;
  showAll?: boolean;
  detail?: boolean;
  moreHref?: string;
}) {
  const t = board.totals;
  const shown = showAll ? board.sources : board.sources.filter(isActive);
  const hidden = board.sources.length - shown.length;
  const wonMoney = t.wonValue > 0 ? money(t.wonValue, t.wonCurrency) : null;
  const period = board.range === 'today' ? 'today' : `in the last ${RANGES[board.range].label}`;
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-[16.5px] font-semibold tracking-tight text-ink">What we got</h2>
          <p className="text-[12.5px] text-ink-3">Across every email and WhatsApp source, {period}.</p>
        </div>
        <RangeSwitch range={board.range} hrefFor={hrefFor} />
      </div>

      <dl className="card grid grid-cols-5 divide-x divide-line overflow-hidden">
        {METRICS.map((m) => {
          const Icon = m.icon;
          return (
            <div key={m.key} className={`${m.tint} relative px-1.5 pb-3 pt-3.5 text-center sm:px-3`}>
              <span className="absolute inset-x-0 top-0 h-[3px] bg-gradient-to-r from-[var(--g1)] to-[var(--g2)]" aria-hidden />
              <dt className="flex items-center justify-center gap-1 text-[10.5px] font-semibold text-ink-2 sm:text-[12px]">
                <Icon size={12} className="hidden text-ink-3 sm:block" aria-hidden />
                {m.label}
              </dt>
              <dd className="mt-1 text-[22px] font-bold leading-none tracking-tight text-ink tabular sm:text-[28px]">{n(t[m.key])}</dd>
              <dd className="mt-1 hidden truncate text-[11px] text-ink-3 sm:block">
                {m.key === 'sent' ? `${n(t.reached)} new people` : m.key === 'interested' ? 'replies that need you' : m.key === 'won' ? (wonMoney ?? ' ') : ' '}
              </dd>
            </div>
          );
        })}
      </dl>
      <p className="mt-2 text-[12px] text-ink-3 sm:hidden">
        {n(t.reached)} new people reached · Interested = replies that need you{wonMoney ? ` · ${wonMoney} won` : ''}
      </p>

      <ul className="mt-3 space-y-2">
        {shown.map((s) => (
          <SourceRow key={s.id} s={s} detail={detail} />
        ))}
      </ul>
      {shown.length === 0 && <div className="card mt-3 px-4 py-6 text-center text-[13.5px] text-ink-3">Nothing was sent and nobody replied {period}.</div>}
      {(hidden > 0 || moreHref) && (
        <p className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[12.5px] text-ink-3">
          <span>{hidden > 0 ? `${hidden} other source${hidden === 1 ? '' : 's'} with nothing ${period}.` : ''}</span>
          {moreHref && (
            <Link href={moreHref} className="flex items-center gap-1 font-medium text-brand hover:underline">
              Full results <ArrowRight size={14} aria-hidden />
            </Link>
          )}
        </p>
      )}
    </div>
  );
}
