import Link from 'next/link';
import { ArrowRight, MessageCircle, PartyPopper, PhoneCall, SkipForward, StickyNote, X } from 'lucide-react';
import { CallButton, CallLogger } from '@/components/crm/CallMode';
import { AttentionBadge, Avatar, IntentBadge, ReminderBadge, StageBadge } from '@/components/crm/LeadBits';
import { one } from '@/lib/db';
import { present } from '@/lib/crm/present';
import { callQueueIds, cardsByIds } from '@/lib/crm/queries';
import { relativeTime } from '@/lib/time';

export const metadata = { title: 'Call mode' };

export default async function CallModePage({ searchParams }: { searchParams: Promise<{ skip?: string }> }) {
  const sp = await searchParams;
  const skipped = new Set(
    (sp.skip ?? '')
      .split(',')
      .map(Number)
      .filter((n) => Number.isInteger(n) && n > 0),
  );
  const queue = (await callQueueIds()).filter((id) => !skipped.has(id));
  const [cards, note] = await Promise.all([
    cardsByIds(queue.slice(0, 4)),
    queue[0]
      ? one<{ body: string; at: Date }>(`select body, occurred_at as at from lead_activities where lead_id = $1 and kind in ('note', 'call') and body is not null order by occurred_at desc limit 1`, [queue[0]])
      : null,
  ]);
  const lead = cards[0] ? present(cards[0]) : null;
  const upNext = cards.slice(1).map((c) => present(c));
  const skipHref = (id: number) => `/call?skip=${[...skipped, id].join(',')}`;

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2.5 text-[22px] font-bold tracking-tight text-ink">
            <span className="grad-call flex h-8 w-8 items-center justify-center rounded-xl">
              <PhoneCall size={16} aria-hidden />
            </span>
            Call mode
          </h1>
          <p className="text-[13px] text-ink-3">{queue.length > 0 ? `${queue.length} to call · due reminders first, then new replies` : 'Queue is empty'}</p>
        </div>
        <Link href="/" className="icon-btn" aria-label="Exit call mode">
          <X size={20} aria-hidden />
        </Link>
      </div>

      {!lead ? (
        <div className="card flex flex-col items-center px-6 py-12 text-center">
          <PartyPopper size={36} className="mb-3 text-emerald-600" aria-hidden />
          <h2 className="text-[18px] font-semibold text-ink">Nobody left to call</h2>
          <p className="mt-1 max-w-sm text-[13.5px] text-ink-2">
            Everyone with a number is called, scheduled for later, or closed. {skipped.size > 0 ? 'Skipped leads come back when you restart.' : ''}
          </p>
          <div className="mt-5 flex gap-2">
            {skipped.size > 0 && (
              <Link href="/call" className="btn">
                Restart queue
              </Link>
            )}
            <Link href="/" className="btn btn-primary">
              Back to Today
            </Link>
          </div>
        </div>
      ) : (
        <>
          <article className={`card overflow-hidden ${lead.attention ? `ring-grad attn-${lead.attention}` : ''}`}>
            <div className={`stage-wash tint-${lead.stage ?? 'none'} p-5`}>
              <div className="flex items-start gap-3.5">
                <Avatar name={lead.name} stage={lead.stage} size={60} />
                <div className="min-w-0 flex-1">
                  <Link href={`/leads/${lead.id}`} className="block text-[22px] font-bold leading-tight tracking-tight text-ink hover:underline [overflow-wrap:anywhere]">
                    {lead.name || lead.email || `Lead #${lead.id}`}
                  </Link>
                  <p className="mt-0.5 text-[13.5px] text-ink-3">{[lead.category, lead.city].filter(Boolean).join(' · ') || lead.campaignName}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <StageBadge stage={lead.stage} />
                    <AttentionBadge attention={lead.attention} label={lead.attentionLabel} />
                    {lead.replyIntent !== 'other' && <IntentBadge intent={lead.replyIntent} />}
                    <ReminderBadge label={lead.reminderLabel} tone={lead.reminderTone} />
                  </div>
                </div>
              </div>
              {lead.replyText && (
                <blockquote className="mt-4 rounded-2xl rounded-tl-sm bg-white/80 px-4 py-3 text-[15px] leading-relaxed text-ink shadow-sm ring-1 ring-line">
                  &ldquo;{lead.replyText}&rdquo;
                  <footer className="mt-1 text-[12px] text-ink-3">
                    {lead.replyChannel === 'whatsapp' ? 'WhatsApp' : 'Email'} reply · {lead.lastReplyAt ? relativeTime(lead.lastReplyAt) : ''}
                  </footer>
                </blockquote>
              )}
              {note && (
                <p className="mt-3 flex gap-2 rounded-xl bg-amber-50/70 px-3 py-2 text-[13px] text-ink-2 ring-1 ring-amber-100">
                  <StickyNote size={15} className="mt-0.5 shrink-0 text-amber-600" aria-hidden />
                  <span>
                    {note.body} <span className="text-ink-3">· {relativeTime(note.at)}</span>
                  </span>
                </p>
              )}
              {lead.lastCallLabel && <p className="mt-2 text-[12.5px] text-ink-3">Last call: {lead.lastCallLabel}</p>}
            </div>
            <div className="space-y-2 border-t border-line bg-gradient-to-b from-slate-50/70 to-white p-4">
              {lead.links.tel && <CallButton tel={lead.links.tel} label={lead.links.phoneLabel ?? ''} />}
              <div className="grid grid-cols-2 gap-2">
                {lead.links.wa ? (
                  <a href={lead.links.wa} target="_blank" rel="noopener noreferrer" className="btn btn-lg justify-center">
                    <MessageCircle size={18} className="text-green-600" aria-hidden /> WhatsApp
                  </a>
                ) : (
                  <Link href={`/leads/${lead.id}`} className="btn btn-lg justify-center">
                    Open lead
                  </Link>
                )}
                <Link href={skipHref(lead.id)} className="btn btn-lg justify-center text-ink-2">
                  <SkipForward size={18} aria-hidden /> Skip
                </Link>
              </div>
            </div>
          </article>

          <section className="card mt-4 p-4 sm:p-5">
            <CallLogger key={lead.id} leadId={lead.id} stage={lead.stage} />
          </section>

          {upNext.length > 0 && (
            <section className="mt-5">
              <h2 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-ink-3">Up next</h2>
              <ul className="space-y-1.5">
                {upNext.map((n) => (
                  <li key={n.id}>
                    <Link href={`/leads/${n.id}`} className="flex items-center gap-3 rounded-xl bg-white/70 px-3 py-2.5 ring-1 ring-line hover:bg-white">
                      <Avatar name={n.name} stage={n.stage} size={32} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-medium text-ink">{n.name || n.email}</span>
                        <span className="block truncate text-[12px] text-ink-3">{n.replyText ?? n.campaignName}</span>
                      </span>
                      <ArrowRight size={15} className="text-ink-3" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
