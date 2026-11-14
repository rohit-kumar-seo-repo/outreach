import Link from 'next/link';
import { Activity, AlarmClock, ArrowRight, BarChart3, Bell, Check, Filter, ListChecks, MessageSquareReply, PartyPopper, Phone, Snowflake, Trophy } from 'lucide-react';
import { LeadList } from '@/components/crm/LeadList';
import { ChannelIcon, HealthPill, Scoreboard } from '@/components/crm/Scoreboard';
import { AnimatedNumber, Reveal } from '@/components/motion';
import { ATTENTION_META, COLD_DAYS, type Attention } from '@/lib/crm/attention';
import { greeting, longToday, money, presentAll } from '@/lib/crm/present';
import { todayData, type LeadCard } from '@/lib/crm/queries';
import { OPEN_STAGES, STAGE_META } from '@/lib/crm/stages';
import { parseRange, scoreboard, sourceStates, type SourceState } from '@/lib/metrics/scoreboard';
import { relativeTime } from '@/lib/time';

export const metadata = { title: 'Today' };

const PER_SECTION = 30;
const FINISHED_RECENTLY_MS = 14 * 86400_000;

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

/** One sentence that says what needs you, or that nothing does. */
function summary(reply: number, due: number, cold: number): string {
  const parts: string[] = [];
  if (reply) parts.push(`${plural(reply, 'person is', 'people are')} waiting on you`);
  if (due) parts.push(plural(due, 'reminder is due', 'reminders are due'));
  if (cold) parts.push(`${plural(cold, 'hot lead is', 'hot leads are')} going quiet`);
  if (parts.length === 0) return 'Nothing needs you right now. Everyone else is waiting on their side or was filtered out.';
  const last = parts.pop();
  return `${parts.length ? `${parts.join(', ')} and ${last}` : last}.`;
}

/** Done today out of everything that needed you today. */
function ProgressRing({ done, left }: { done: number; left: number }) {
  const all = done + left;
  const R = 32;
  const C = 2 * Math.PI * R;
  const pct = all === 0 ? 1 : done / all;
  return (
    <div className="relative h-[76px] w-[76px] shrink-0" role="img" aria-label={all === 0 ? 'Nothing to do' : `${done} of ${all} done today`}>
      <svg width="76" height="76" viewBox="0 0 76 76" aria-hidden>
        <defs>
          <linearGradient id="ring-g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#34d399" />
            <stop offset="100%" stopColor="#22d3ee" />
          </linearGradient>
        </defs>
        <circle cx="38" cy="38" r={R} fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="7" />
        {pct > 0 && (
          <circle
            className="ring-progress"
            cx="38"
            cy="38"
            r={R}
            fill="none"
            stroke="url(#ring-g)"
            strokeWidth="7"
            strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={C * (1 - pct)}
            style={{ ['--ring-full' as string]: C }}
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        {all === 0 ? (
          <Check size={26} className="text-emerald-300" aria-hidden />
        ) : (
          <>
            <span className="text-[22px] font-bold tabular">{done}</span>
            <span className="mt-0.5 text-[10.5px] font-medium text-indigo-100/75">of {all} done</span>
          </>
        )}
      </div>
    </div>
  );
}

function HeroChip({ href, label, value, attn }: { href: string; label: string; value: number; attn: string }) {
  return (
    <Link href={href} className={`glass ${attn} flex items-center gap-2 px-2.5 py-2 sm:px-3`}>
      <span className="text-[19px] font-bold leading-none tabular sm:text-[22px]">
        <AnimatedNumber value={value} />
      </span>
      <span className="min-w-0 text-[11px] font-medium leading-tight text-indigo-100/80 sm:text-[12.5px]">{label}</span>
    </Link>
  );
}

const SECTION_ICON: Record<Attention, React.ReactNode> = {
  reply: <MessageSquareReply size={16} aria-hidden />,
  due: <AlarmClock size={16} aria-hidden />,
  cold: <Snowflake size={16} aria-hidden />,
};
const SECTION_ID: Record<Attention, string> = { reply: 'waiting', due: 'due', cold: 'quiet' };

function FocusSection({ attn, leads, total, delay }: { attn: Attention; leads: LeadCard[]; total: number; delay: number }) {
  if (leads.length === 0) return null;
  const m = ATTENTION_META[attn];
  return (
    <Reveal as="section" className="mt-6" delay={delay}>
      <span id={SECTION_ID[attn]} className="block scroll-mt-24" aria-hidden />
      <div className="mb-3 flex items-center gap-3">
        <span className={`icon-grad attn-${attn}`}>{SECTION_ICON[attn]}</span>
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 text-[16.5px] font-semibold tracking-tight text-ink">
            {m.title}
            <span className="rounded-full bg-white px-2 py-0.5 text-[12px] font-semibold text-ink-2 ring-1 ring-line tabular">{total}</span>
          </h2>
          <p className="text-[12.5px] text-ink-3">{m.help}</p>
        </div>
        {total > leads.length && (
          <Link href="/leads?view=focus" className="flex shrink-0 items-center gap-1 text-[13px] font-medium text-brand hover:underline">
            All <ArrowRight size={14} aria-hidden />
          </Link>
        )}
      </div>
      <LeadList leads={presentAll(leads.slice(0, PER_SECTION))} actions />
    </Reveal>
  );
}

/** Sources that stopped sending while leads are still waiting, or just ran out of leads. */
function OutreachCheck({ states }: { states: SourceState[] }) {
  const now = Date.now();
  const issues = states.filter((s) => s.health === 'idle' || (s.health === 'finished' && s.lastSendAt && now - s.lastSendAt.getTime() < FINISHED_RECENTLY_MS));
  if (issues.length === 0) return null;
  return (
    <Reveal as="section" className="mt-7" delay={0.1}>
      <div className="mb-3 flex items-center gap-3">
        <span className="icon-grad attn-due">
          <Activity size={16} aria-hidden />
        </span>
        <div>
          <h2 className="text-[16.5px] font-semibold tracking-tight text-ink">Outreach check</h2>
          <p className="text-[12.5px] text-ink-3">Sources that stopped sending or ran out of leads.</p>
        </div>
      </div>
      <ul className="grid grid-cols-1 gap-2 xl:grid-cols-2">
        {issues.map((s) => (
          <li key={s.id} className="card relative transition-shadow hover:shadow-[var(--shadow-pop)]">
            <Link href={`/campaigns/${s.slug}`} className="absolute inset-0 rounded-[inherit]" aria-label={`Open ${s.name}`} />
            <div className="pointer-events-none flex items-start gap-3 p-3.5">
              <ChannelIcon channel={s.channel} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-[14.5px] font-semibold text-ink">{s.name}</span>
                  <HealthPill health={s.health} />
                </div>
                <p className="mt-0.5 text-[12.5px] leading-snug text-ink-2">
                  {s.health === 'idle'
                    ? `${plural(s.remaining, 'lead is', 'leads are')} still waiting, but the last message went out ${s.lastSendAt ? relativeTime(s.lastSendAt) : 'at an unknown time'}. Check that its workflow is running.`
                    : `Everyone on its list has been contacted (last message ${relativeTime(s.lastSendAt)}). Add more leads to keep it going.`}
                </p>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </Reveal>
  );
}

export default async function TodayPage({ searchParams }: { searchParams: Promise<{ tab?: string; range?: string }> }) {
  const sp = await searchParams;
  const tab = sp.tab === 'results' ? 'results' : 'todo';
  const range = parseRange(sp.range);
  const [d, board, states] = await Promise.all([todayData(), tab === 'results' ? scoreboard(range) : null, tab === 'todo' ? sourceStates() : null]);
  const fc = d.focusCounts;
  const won = money(d.wonThisMonth.value, d.wonThisMonth.currency);
  const open = OPEN_STAGES.reduce((n, s) => n + d.counts[s], 0);

  return (
    <>
      {/* Midnight hero: what needs you, how far along you are, and the one big button for when you are free or on the road. */}
      <Reveal>
        <section className="hero -mx-1 px-5 pb-5 pt-5 sm:mx-0 sm:px-7 sm:pb-6 sm:pt-6">
          <span className="hero-blob -left-16 -top-12 h-48 w-48 bg-indigo-500" aria-hidden />
          <span className="hero-blob -right-10 top-8 h-40 w-40 bg-fuchsia-500 [animation-delay:-7s]" aria-hidden />
          <div className="flex flex-wrap items-center justify-between gap-2 text-[12.5px] text-indigo-100/80">
            <span className="font-medium">{longToday()}</span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 ring-1 ring-white/15">
              <span className={`h-1.5 w-1.5 rounded-full ${d.lastSyncAt ? 'bg-emerald-400' : 'bg-amber-400'}`} aria-hidden />
              {d.lastSyncAt ? `Synced ${relativeTime(d.lastSyncAt)}` : 'Not synced yet'}
            </span>
          </div>
          <div className="mt-3 flex items-center gap-4">
            <div className="min-w-0 flex-1">
              <h1 className="text-[26px] font-bold leading-[1.1] tracking-tight sm:text-[36px]">
                {greeting()}, <span className="text-aurora">Rohit</span>
              </h1>
              {/* On a phone the three chips below already say this, so the sentence only shows when all is clear. */}
              <p className={`mt-2 max-w-2xl text-[14px] leading-snug text-indigo-100/85 sm:block sm:text-[15.5px] ${fc.total > 0 ? 'hidden' : ''}`}>{summary(fc.reply, fc.due, fc.cold)}</p>
            </div>
            <ProgressRing done={d.doneToday} left={fc.total} />
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2">
            <HeroChip href="/#waiting" label="waiting on you" value={fc.reply} attn="attn-reply" />
            <HeroChip href="/#due" label="reminders due" value={fc.due} attn="attn-due" />
            <HeroChip href="/#quiet" label="going quiet" value={fc.cold} attn="attn-cold" />
          </div>

          <Link href="/call" className="grad-call btn-shine group mt-3 flex items-center gap-3.5 rounded-2xl px-4 py-3 transition-transform active:scale-[0.99] sm:px-5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/20 ring-1 ring-white/30">
              <Phone size={19} aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[16px] font-semibold">Start calling</span>
              <span className="block text-[12.5px] text-emerald-50/90">
                {d.callQueue > 0 ? `${plural(d.callQueue, 'lead', 'leads')} ready, one at a time` : 'Nobody to call right now'}
                {d.callsToday > 0 ? ` · ${plural(d.callsToday, 'call', 'calls')} today` : ''}
              </span>
            </span>
            <ArrowRight size={20} className="shrink-0 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </Link>
        </section>
      </Reveal>

      {/* The two questions this page answers. */}
      <span id="view" className="block scroll-mt-20" aria-hidden />
      <nav className="seg mt-4" aria-label="View">
        <Link href="/" aria-current={tab === 'todo' ? 'page' : undefined} scroll={false}>
          <ListChecks size={17} aria-hidden /> To do
          {fc.total > 0 && <span className={`rounded-full px-1.5 py-0.5 text-[11.5px] tabular ${tab === 'todo' ? 'bg-white/20' : 'bg-brand-50 text-brand'}`}>{fc.total}</span>}
        </Link>
        <Link href={`/?tab=results${range !== '7d' ? `&range=${range}` : ''}`} aria-current={tab === 'results' ? 'page' : undefined} scroll={false}>
          <BarChart3 size={17} aria-hidden /> What we got
        </Link>
      </nav>

      {tab === 'todo' ? (
        <>
          {d.openAlerts > 0 && (
            <Reveal className="mt-4">
              <Link href="/alerts" className="flex items-center gap-3 rounded-2xl border border-red-200 bg-critical-50 px-4 py-3 text-[13.5px] text-ink">
                <Bell size={17} className="text-critical" aria-hidden />
                <span className="flex-1">
                  {plural(d.openAlerts, 'system alert needs', 'system alerts need')} a look (failed runs, sync errors or limits)
                </span>
                <ArrowRight size={16} aria-hidden />
              </Link>
            </Reveal>
          )}

          {fc.total === 0 ? (
            <Reveal className="mt-6" delay={0.05}>
              <div className="card flex flex-col items-center px-6 py-10 text-center">
                <span className="icon-grad attn-call !h-12 !w-12 !rounded-2xl">
                  <PartyPopper size={22} aria-hidden />
                </span>
                <h2 className="mt-3 text-[17px] font-semibold text-ink">All clear</h2>
                <p className="mt-1 max-w-sm text-[13.5px] text-ink-2">
                  Nobody is waiting on you, no reminders are due and no hot lead has gone quiet. New replies that need you will show up here.
                </p>
                <Link href="/?tab=results" className="btn btn-primary mt-4">
                  See what we got <ArrowRight size={15} aria-hidden />
                </Link>
              </div>
            </Reveal>
          ) : (
            <>
              <FocusSection attn="reply" leads={d.focus.reply} total={fc.reply} delay={0.04} />
              <FocusSection attn="due" leads={d.focus.due} total={fc.due} delay={0.07} />
              <FocusSection attn="cold" leads={d.focus.cold} total={fc.cold} delay={0.1} />
            </>
          )}

          {states && <OutreachCheck states={states} />}

          {/* What was kept out of the way, so nothing feels hidden. */}
          <Reveal as="section" className="mt-7" delay={0.1}>
            <div className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:p-5">
              <span className="icon-grad attn-brand">
                <Filter size={15} aria-hidden />
              </span>
              <p className="flex-1 text-[13px] leading-relaxed text-ink-2">
                <strong className="font-semibold text-ink">Kept out of your way:</strong> {plural(fc.screened, 'reply', 'replies')} in the last 30 days that were only a hi, thanks, an auto-reply or a no
                {' · '}
                {plural(fc.waitingOnThem, 'open lead', 'open leads')} you already answered (waiting on them)
                {fc.parked > 0 ? ` · ${fc.parked} parked until a later reminder` : ''}. Hot leads come back here after {COLD_DAYS} quiet days.
              </p>
              <Link href="/inbox?view=screened" className="btn shrink-0 justify-center">
                Review screened
              </Link>
            </div>
          </Reveal>
        </>
      ) : (
        <>
          <Reveal className="mt-5" delay={0.04}>
            {board && <Scoreboard board={board} hrefFor={(r) => `/?tab=results${r !== '7d' ? `&range=${r}` : ''}`} moreHref="/campaigns" />}
          </Reveal>

          {/* Where every open lead stands right now: colour-graded tiles, one per stage, plus wins. */}
          <Reveal as="section" className="mt-8" delay={0.08}>
            <div className="mb-3 flex items-end justify-between gap-2">
              <div>
                <h2 className="text-[16.5px] font-semibold tracking-tight text-ink">In your pipeline now</h2>
                <p className="text-[12.5px] text-ink-3">Every lead that replied, by where it stands.</p>
              </div>
              <Link href="/leads" className="flex items-center gap-1 text-[13px] font-medium text-brand hover:underline">
                {open} open <ArrowRight size={14} aria-hidden />
              </Link>
            </div>
            <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-6">
              {OPEN_STAGES.map((s) => (
                <Link key={s} href={`/leads?view=${s}`} className={`tile tint-${s} px-3 pb-3 pt-3.5`}>
                  <span className="relative z-10 flex items-center gap-1.5 text-[12px] font-medium text-ink-2">
                    <span className="h-2 w-2 rounded-full bg-gradient-to-br from-[var(--g1)] to-[var(--g2)]" aria-hidden />
                    {STAGE_META[s].short}
                  </span>
                  <span className="relative z-10 mt-1.5 block text-[24px] font-bold leading-none tracking-tight text-ink tabular">
                    <AnimatedNumber value={d.counts[s]} />
                  </span>
                </Link>
              ))}
              <Link href="/leads?view=won" className="tile tint-won px-3 pb-3 pt-3.5">
                <span className="relative z-10 flex items-center gap-1.5 text-[12px] font-medium text-emerald-700">
                  <Trophy size={13} aria-hidden /> Won
                </span>
                <span className="relative z-10 mt-1.5 block text-[24px] font-bold leading-none tracking-tight text-ink tabular">
                  <AnimatedNumber value={d.wonThisMonth.n} />
                </span>
                <span className="relative z-10 mt-1 block truncate text-[11px] text-ink-3">{won ?? 'this month'}</span>
              </Link>
            </div>
          </Reveal>
        </>
      )}
    </>
  );
}
