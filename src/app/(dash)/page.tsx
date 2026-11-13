import Link from 'next/link';
import { AlarmClock, ArrowRight, Bell, Filter, MessageSquareReply, Phone, PhoneCall, PartyPopper, Snowflake, Trophy } from 'lucide-react';
import { LeadList } from '@/components/crm/LeadList';
import { AnimatedNumber, Reveal } from '@/components/motion';
import { ATTENTION_META, COLD_DAYS, type Attention } from '@/lib/crm/attention';
import { greeting, longToday, money, presentAll } from '@/lib/crm/present';
import { todayData, type LeadCard } from '@/lib/crm/queries';
import { OPEN_STAGES, STAGE_META } from '@/lib/crm/stages';
import { relativeTime } from '@/lib/time';

export const metadata = { title: 'Today' };

const PER_SECTION = 30;

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

function HeroStat({ href, label, value, attn, icon }: { href?: string; label: string; value: number; attn: string; icon: React.ReactNode }) {
  const inner = (
    <>
      <span className={`icon-grad ${attn} !h-7 !w-7 !rounded-lg`}>{icon}</span>
      <span className="mt-2.5 block text-[26px] font-bold leading-none tracking-tight tabular sm:text-[30px]">
        <AnimatedNumber value={value} />
      </span>
      <span className="mt-1 block text-[12px] font-medium text-indigo-100/80">{label}</span>
    </>
  );
  return href && value > 0 ? (
    <a href={href} className="glass block p-3 sm:p-3.5">
      {inner}
    </a>
  ) : (
    <div className="glass p-3 sm:p-3.5">{inner}</div>
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
    <Reveal as="section" className="mt-7 scroll-mt-20" delay={delay}>
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

export default async function TodayPage() {
  const d = await todayData();
  const fc = d.focusCounts;
  const won = money(d.wonThisMonth.value, d.wonThisMonth.currency);
  const open = OPEN_STAGES.reduce((n, s) => n + d.counts[s], 0);

  return (
    <>
      {/* Midnight hero: what needs you, in numbers, and the one big button for when you are free or on the road. */}
      <Reveal>
        <section className="hero -mx-1 px-5 pb-5 pt-5 sm:mx-0 sm:px-7 sm:pb-7 sm:pt-7">
          <span className="hero-blob -left-16 -top-12 h-48 w-48 bg-indigo-500" aria-hidden />
          <span className="hero-blob -right-10 top-8 h-40 w-40 bg-fuchsia-500 [animation-delay:-7s]" aria-hidden />
          <div className="flex flex-wrap items-center justify-between gap-2 text-[12.5px] text-indigo-100/80">
            <span className="font-medium">{longToday()}</span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 ring-1 ring-white/15">
              <span className={`h-1.5 w-1.5 rounded-full ${d.lastSyncAt ? 'bg-emerald-400' : 'bg-amber-400'}`} aria-hidden />
              {d.lastSyncAt ? `Synced ${relativeTime(d.lastSyncAt)}` : 'Not synced yet'}
            </span>
          </div>
          <h1 className="mt-3 text-[28px] font-bold leading-[1.1] tracking-tight sm:text-[38px]">
            {greeting()}, <span className="text-aurora">Rohit</span>
          </h1>
          <p className="mt-2 max-w-2xl text-[14.5px] leading-snug text-indigo-100/85 sm:text-[15.5px]">{summary(fc.reply, fc.due, fc.cold)}</p>

          <div className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <HeroStat href="#waiting" label="Waiting on you" value={fc.reply} attn="attn-reply" icon={<MessageSquareReply size={15} aria-hidden />} />
            <HeroStat href="#due" label="Reminders due" value={fc.due} attn="attn-due" icon={<AlarmClock size={15} aria-hidden />} />
            <HeroStat href="#quiet" label="Going quiet" value={fc.cold} attn="attn-cold" icon={<Snowflake size={15} aria-hidden />} />
            <HeroStat label={d.repliesHandledToday > 0 ? `Calls today · ${d.repliesHandledToday} replies handled` : 'Calls today'} value={d.callsToday} attn="attn-call" icon={<PhoneCall size={15} aria-hidden />} />
          </div>

          <Link href="/call" className="grad-call btn-shine group mt-4 flex items-center gap-3.5 rounded-2xl px-4 py-3.5 transition-transform active:scale-[0.99] sm:px-5">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/20 ring-1 ring-white/30">
              <Phone size={21} aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[16.5px] font-semibold">Start calling</span>
              <span className="block text-[12.5px] text-emerald-50/90">
                {d.callQueue > 0 ? `${plural(d.callQueue, 'lead', 'leads')} ready, one at a time` : 'Nobody to call right now'}
              </span>
            </span>
            <ArrowRight size={20} className="shrink-0 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </Link>
        </section>
      </Reveal>

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
        <Reveal className="mt-7" delay={0.05}>
          <div className="card flex flex-col items-center px-6 py-10 text-center">
            <span className="icon-grad attn-call !h-12 !w-12 !rounded-2xl">
              <PartyPopper size={22} aria-hidden />
            </span>
            <h2 className="mt-3 text-[17px] font-semibold text-ink">All clear</h2>
            <p className="mt-1 max-w-sm text-[13.5px] text-ink-2">Nobody is waiting on you, no reminders are due and no hot lead has gone quiet. New replies that need you will show up here.</p>
          </div>
        </Reveal>
      ) : (
        <>
          <FocusSection attn="reply" leads={d.focus.reply} total={fc.reply} delay={0.04} />
          <FocusSection attn="due" leads={d.focus.due} total={fc.due} delay={0.07} />
          <FocusSection attn="cold" leads={d.focus.cold} total={fc.cold} delay={0.1} />
        </>
      )}

      {/* Pipeline at a glance: colour-graded bento tiles, one per open stage, plus wins. */}
      <Reveal as="section" className="mt-8" delay={0.08}>
        <div className="mb-3 flex items-end justify-between gap-2">
          <h2 className="text-[16.5px] font-semibold tracking-tight text-ink">Pipeline</h2>
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

      {/* What was kept out of the way, so nothing feels hidden. */}
      <Reveal as="section" className="mt-6" delay={0.1}>
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
  );
}
