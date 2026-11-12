import Link from 'next/link';
import { AlarmClock, ArrowRight, Bell, Flame, MessageSquareReply, Phone, Sparkles, Trophy } from 'lucide-react';
import { LeadList } from '@/components/crm/LeadList';
import { AnimatedNumber, Reveal } from '@/components/motion';
import { greeting, longToday, money, presentAll } from '@/lib/crm/present';
import { todayData } from '@/lib/crm/queries';
import { OPEN_STAGES, STAGE_META } from '@/lib/crm/stages';
import { relativeTime } from '@/lib/time';

export const metadata = { title: 'Today' };

function Section({ title, icon, count, href, hrefLabel, children }: { title: string; icon: React.ReactNode; count?: number; href?: string; hrefLabel?: string; children: React.ReactNode }) {
  return (
    <Reveal as="section" className="mt-7" delay={0.05}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-[16px] font-semibold text-ink">
          {icon}
          {title}
          {count !== undefined && count > 0 && <span className="rounded-full bg-slate-200/70 px-2 py-0.5 text-[12px] font-semibold text-ink-2 tabular">{count}</span>}
        </h2>
        {href && (
          <Link href={href} className="flex items-center gap-1 text-[13px] font-medium text-brand hover:underline">
            {hrefLabel ?? 'See all'} <ArrowRight size={14} aria-hidden />
          </Link>
        )}
      </div>
      {children}
    </Reveal>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="card px-4 py-6 text-center text-[13.5px] text-ink-3">{children}</div>;
}

export default async function TodayPage() {
  const d = await todayData();
  const open = OPEN_STAGES.reduce((n, s) => n + d.counts[s], 0);
  const won = money(d.wonThisMonth.value, d.wonThisMonth.currency);
  return (
    <>
      <header className="mb-5">
        <p className="text-[13px] font-medium text-ink-3">{longToday()}</p>
        <h1 className="mt-0.5 text-[26px] font-bold tracking-tight text-ink sm:text-[30px]">{greeting()}, Rohit</h1>
        <p className="mt-1 text-[14px] text-ink-2">
          {d.remindersTotal > 0 || d.newRepliesTotal > 0 ? (
            <>
              {d.remindersTotal > 0 && (
                <>
                  <strong className="font-semibold text-ink">{d.remindersTotal}</strong> reminder{d.remindersTotal === 1 ? '' : 's'} due
                </>
              )}
              {d.remindersTotal > 0 && d.newRepliesTotal > 0 && ' · '}
              {d.newRepliesTotal > 0 && (
                <>
                  <strong className="font-semibold text-ink">{d.newRepliesTotal}</strong> new repl{d.newRepliesTotal === 1 ? 'y' : 'ies'} to handle
                </>
              )}
            </>
          ) : (
            'You are all caught up.'
          )}
        </p>
      </header>

      {/* Start calling: the one big button for when you are free or on the road. */}
      <Reveal>
        <Link
          href="/call"
          className="group flex items-center gap-4 overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-700 p-4 text-white shadow-lg shadow-emerald-700/20 transition-transform active:scale-[0.99] sm:p-5"
        >
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/20 ring-1 ring-white/30">
            <Phone size={22} aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[17px] font-semibold">Start calling</span>
            <span className="block text-[13px] text-emerald-50/90">
              {d.callQueue > 0 ? `${d.callQueue} lead${d.callQueue === 1 ? '' : 's'} ready, one at a time` : 'Nobody to call right now'}
              {d.callsToday > 0 ? ` · ${d.callsToday} call${d.callsToday === 1 ? '' : 's'} logged today` : ''}
            </span>
          </span>
          <ArrowRight size={20} className="shrink-0 transition-transform group-hover:translate-x-0.5" aria-hidden />
        </Link>
      </Reveal>

      {/* Pipeline at a glance. */}
      <Reveal className="mt-4" delay={0.04}>
        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-6 sm:px-0">
          {OPEN_STAGES.map((s) => (
            <Link key={s} href={`/leads?view=${s}`} className="card min-w-[108px] shrink-0 px-3.5 py-3 transition-shadow hover:shadow-[var(--shadow-pop)]">
              <span className="flex items-center gap-1.5 text-[12px] font-medium text-ink-3">
                <span className={`h-2 w-2 rounded-full ${STAGE_META[s].dot}`} aria-hidden />
                {STAGE_META[s].short}
              </span>
              <span className="mt-1 block text-[22px] font-semibold leading-none text-ink">
                <AnimatedNumber value={d.counts[s]} />
              </span>
            </Link>
          ))}
          <Link href="/leads?view=won" className="card min-w-[108px] shrink-0 bg-gradient-to-br from-emerald-50 to-white px-3.5 py-3 transition-shadow hover:shadow-[var(--shadow-pop)]">
            <span className="flex items-center gap-1.5 text-[12px] font-medium text-emerald-700">
              <Trophy size={13} aria-hidden /> Won this month
            </span>
            <span className="mt-1 block text-[22px] font-semibold leading-none text-ink">
              <AnimatedNumber value={d.wonThisMonth.n} />
            </span>
            {won && <span className="mt-0.5 block text-[11.5px] text-ink-3">{won}</span>}
          </Link>
        </div>
        <p className="mt-2 text-[12px] text-ink-3">
          {open} open lead{open === 1 ? '' : 's'} in your pipeline · data synced {d.lastSyncAt ? relativeTime(d.lastSyncAt) : 'never'}
        </p>
      </Reveal>

      {d.openAlerts > 0 && (
        <Reveal className="mt-4">
          <Link href="/alerts" className="flex items-center gap-3 rounded-xl border border-red-200 bg-critical-50 px-4 py-3 text-[13.5px] text-ink">
            <Bell size={17} className="text-critical" aria-hidden />
            <span className="flex-1">
              {d.openAlerts} system alert{d.openAlerts === 1 ? '' : 's'} need a look (failed runs, sync errors or limits)
            </span>
            <ArrowRight size={16} aria-hidden />
          </Link>
        </Reveal>
      )}

      <Section title="Reminders due" icon={<AlarmClock size={18} className="text-amber-600" aria-hidden />} count={d.remindersTotal} href={d.remindersTotal > d.reminders.length ? '/leads?view=contacts&due=1' : undefined}>
        {d.reminders.length === 0 ? <Empty>No reminders due today. Set one from any lead after a call.</Empty> : <LeadList leads={presentAll(d.reminders)} />}
      </Section>

      <Section title="New replies" icon={<MessageSquareReply size={18} className="text-sky-600" aria-hidden />} count={d.newRepliesTotal} href="/leads?view=new" hrefLabel="All new">
        {d.newReplies.length === 0 ? (
          <Empty>
            <Sparkles size={18} className="mx-auto mb-1 text-ink-3" aria-hidden />
            Every reply has been handled.
          </Empty>
        ) : (
          <LeadList leads={presentAll(d.newReplies)} showStage={false} />
        )}
      </Section>

      {d.inPlay.length > 0 && (
        <Section title="In play" icon={<Flame size={18} className="text-orange-500" aria-hidden />} href="/leads" hrefLabel="Pipeline">
          <LeadList leads={presentAll(d.inPlay)} />
        </Section>
      )}
    </>
  );
}
