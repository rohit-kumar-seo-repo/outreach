import Link from 'next/link';
import { Download } from 'lucide-react';
import { LeadList } from '@/components/crm/LeadList';
import { LeadFilters } from '@/components/crm/LeadFilters';
import { PipelineBoard } from '@/components/crm/PipelineBoard';
import { EmptyState, fmt } from '@/components/ui';
import { campaignOptions } from '@/lib/metrics/campaigns';
import { presentAll } from '@/lib/crm/present';
import { listPipeline, stageCounts, type PipelineQuery, type PipelineView } from '@/lib/crm/queries';
import { OPEN_STAGES, STAGES, STAGE_META, isStage, type Stage } from '@/lib/crm/stages';
import { LEAD_STATUS } from '@/components/status';

export const metadata = { title: 'Leads' };

type SP = Record<string, string | undefined>;
const PAGE = 60;

function qs(sp: SP, patch: SP): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...sp, ...patch })) if (v) u.set(k, v);
  u.delete('focus');
  const s = u.toString();
  return s ? `/leads?${s}` : '/leads';
}

export default async function LeadsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const legacy = !!(sp.status || sp.followup || sp.outcome);
  const rawView = sp.view ?? (legacy ? 'contacts' : 'open');
  const view: PipelineView = rawView === 'focus' || rawView === 'all' || rawView === 'contacts' || rawView === 'open' || isStage(rawView) ? (rawView as PipelineView) : 'open';
  const followup = sp.followup === 'due' || sp.followup === 'today' || sp.followup === 'overdue' ? sp.followup : null;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const channel = sp.channel === 'email' || sp.channel === 'whatsapp' ? sp.channel : null;
  const base: Omit<PipelineQuery, 'view'> = {
    campaign: sp.campaign || null,
    channel,
    search: sp.q || null,
    due: sp.due === '1',
    starred: sp.starred === '1',
    status: sp.status || null,
    followup,
    outcome: sp.outcome || null,
  };
  const board = sp.mode === 'board' && view !== 'contacts' && view !== 'focus';
  const boardStages: Stage[] = view === 'all' || view === 'open' ? [...OPEN_STAGES, 'won'] : isStage(view) ? [view] : OPEN_STAGES;

  const [counts, campaigns, data] = await Promise.all([
    stageCounts(base),
    campaignOptions(),
    board
      ? Promise.all(boardStages.map((s) => listPipeline({ ...base, view: s, limit: 40 }).then((r) => [s, r] as const)))
      : listPipeline({ ...base, view, limit: PAGE, offset: (page - 1) * PAGE }),
  ]);
  const openTotal = OPEN_STAGES.reduce((n, s) => n + counts[s], 0);
  const tabs: { key: PipelineView; label: string; n: number; dot?: string }[] = [
    { key: 'focus', label: 'Needs you', n: counts.focus, dot: 'pulse' },
    { key: 'open', label: 'Open', n: openTotal },
    ...STAGES.map((s) => ({ key: s as PipelineView, label: STAGE_META[s].short, n: counts[s], dot: STAGE_META[s].dot })),
    { key: 'contacts', label: 'All contacts', n: counts.contacts },
  ];

  let list = null;
  let total = 0;
  if (!Array.isArray(data)) {
    const d = data as Awaited<ReturnType<typeof listPipeline>>;
    total = d.total;
    list = presentAll(d.rows);
  }

  return (
    <>
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight text-ink">Leads</h1>
          <p className="mt-0.5 text-[13.5px] text-ink-2">
            {view === 'focus' ? 'Only the leads waiting on you, with a reminder due, or going quiet. Mark them done as you go.' : 'Everyone who responded to outreach, by stage. Tap a lead to call, message or update it.'}
          </p>
        </div>
        <a className="btn hidden sm:inline-flex" href={`/api/export/leads${qs(sp, {}).replace('/leads', '')}`}>
          <Download size={15} aria-hidden /> Export
        </a>
      </div>

      <div className="pb-3">
        <LeadFilters campaigns={campaigns.map((c) => ({ value: c.slug, label: c.name }))} showModeToggle={view !== 'contacts' && view !== 'focus'} />
      </div>

      <nav className="no-scrollbar -mx-4 mb-4 flex gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0" aria-label="Stages">
        {tabs.map((t) => (
          <Link key={t.key} href={qs(sp, { view: t.key === 'open' ? undefined : t.key, page: undefined, status: undefined, followup: undefined, outcome: undefined })} aria-current={view === t.key ? 'page' : undefined} className="chip">
            {t.dot === 'pulse' ? (
              <span className="attn-reply pulse-dot !h-2 !w-2" aria-hidden />
            ) : (
              t.dot && <span className={`h-2 w-2 rounded-full ${t.dot}`} aria-hidden />
            )}
            {t.label}
            <span className={`tabular ${view === t.key ? 'text-white/70' : 'text-ink-3'}`}>{fmt(t.n)}</span>
          </Link>
        ))}
      </nav>

      {legacy && (
        <p className="mb-3 text-[12.5px] text-ink-3">
          Showing {sp.status ? `status “${LEAD_STATUS[sp.status]?.label ?? sp.status}”` : ''}
          {sp.followup ? ` sequence follow-ups ${sp.followup}` : ''}
          {sp.outcome ? ` outcome ${sp.outcome}` : ''}.{' '}
          <Link href="/leads" className="link">
            Clear
          </Link>
        </p>
      )}

      {board ? (
        <PipelineBoard
          stages={boardStages}
          columns={Object.fromEntries((data as (readonly [Stage, Awaited<ReturnType<typeof listPipeline>>])[]).map(([s, r]) => [s, presentAll(r.rows)]))}
          totals={Object.fromEntries((data as (readonly [Stage, Awaited<ReturnType<typeof listPipeline>>])[]).map(([s, r]) => [s, r.total]))}
        />
      ) : list && list.length > 0 ? (
        <>
          <LeadList leads={list} showStage={!isStage(view)} actions={view === 'focus'} />
          {total > PAGE && (
            <div className="mt-5 flex items-center justify-between text-[13px] text-ink-2">
              {page > 1 ? (
                <Link className="btn" href={qs(sp, { page: String(page - 1) })}>
                  ← Previous
                </Link>
              ) : (
                <span />
              )}
              <span className="tabular">
                {fmt((page - 1) * PAGE + 1)}–{fmt(Math.min(page * PAGE, total))} of {fmt(total)}
              </span>
              {page * PAGE < total ? (
                <Link className="btn" href={qs(sp, { page: String(page + 1) })}>
                  Next →
                </Link>
              ) : (
                <span />
              )}
            </div>
          )}
        </>
      ) : (
        <div className="card">
          <EmptyState title={sp.q ? `Nothing matches “${sp.q}”` : view === 'focus' ? 'Nothing needs you right now' : view === 'new' ? 'No new replies' : 'No leads here yet'}>
            {view === 'focus' && !sp.q
              ? 'Nobody is waiting on you, no reminders are due and no hot lead has gone quiet. The Open tab has your whole pipeline.'
              : sp.q
              ? 'Try a shorter name, part of the phone number, or the “All contacts” tab.'
              : view === 'contacts'
                ? 'Leads appear once the spreadsheets sync through the n8n Data Bridge.'
                : 'Leads land in the pipeline when they reply, or when you log a call or set a stage on them.'}
          </EmptyState>
        </div>
      )}
    </>
  );
}
