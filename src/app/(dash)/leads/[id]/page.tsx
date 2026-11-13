import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  AlarmClock,
  ArrowLeft,
  ArrowRightLeft,
  ExternalLink,
  Mail,
  MessageCircle,
  Phone,
  Reply,
  Send,
  ShieldAlert,
  StickyNote,
  XCircle,
} from 'lucide-react';
import { AttentionBadge, Avatar, IntentBadge, ReminderBadge, StageBadge } from '@/components/crm/LeadBits';
import { FocusActions } from '@/components/crm/FocusActions';
import { ATTENTION_META } from '@/lib/crm/attention';
import { DealEditor, DeleteActivityButton, LeadActionBar, LogCallPanel, NoteComposer, ReminderPicker, StagePicker, StarButton } from '@/components/crm/LeadControls';
import { present } from '@/lib/crm/present';
import { one } from '@/lib/db';
import { leadWorkspace, type TimelineItem } from '@/lib/crm/queries';
import { CALL_OUTCOMES, STAGE_META, isStage } from '@/lib/crm/stages';
import { formatDate, formatDateTime } from '@/lib/time';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  const row = Number.isInteger(id) ? await one<{ name: string | null }>('select name from leads where id = $1', [id]) : null;
  return { title: row?.name ?? 'Lead' };
}

function Panel({ title, children, className = '', action }: { title?: string; children: React.ReactNode; className?: string; action?: React.ReactNode }) {
  return (
    <section className={`card p-4 sm:p-5 ${className}`}>
      {title && (
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-[14px] font-semibold text-ink">{title}</h2>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

const ICON: Record<TimelineItem['kind'], { icon: typeof Phone; cls: string }> = {
  call: { icon: Phone, cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  note: { icon: StickyNote, cls: 'bg-amber-50 text-amber-700 ring-amber-200' },
  stage: { icon: ArrowRightLeft, cls: 'bg-indigo-50 text-indigo-700 ring-indigo-200' },
  reminder: { icon: AlarmClock, cls: 'bg-slate-50 text-ink-2 ring-slate-200' },
  sent: { icon: Send, cls: 'bg-slate-50 text-ink-2 ring-slate-200' },
  send_failed: { icon: XCircle, cls: 'bg-critical-50 text-critical ring-red-200' },
  reply: { icon: Mail, cls: 'bg-sky-50 text-sky-700 ring-sky-200' },
  our_reply: { icon: Reply, cls: 'bg-brand-50 text-brand ring-indigo-200' },
  wa_in: { icon: MessageCircle, cls: 'bg-green-50 text-green-700 ring-green-200' },
  wa_out: { icon: MessageCircle, cls: 'bg-slate-50 text-ink-2 ring-slate-200' },
};

function titleFor(t: TimelineItem): string {
  if (t.kind === 'call') return `Call · ${CALL_OUTCOMES[t.outcome as keyof typeof CALL_OUTCOMES]?.label ?? 'logged'}`;
  if (t.kind === 'note') return 'Note';
  if (t.kind === 'stage') return `Moved to ${isStage(t.outcome) ? STAGE_META[t.outcome].label : t.outcome}`;
  if (t.kind === 'reminder') return t.outcome === 'cleared' ? 'Reminder cleared' : `Reminder set for ${t.body ? formatDateTime(t.body) : '—'}`;
  return t.title;
}

function Timeline({ items }: { items: TimelineItem[] }) {
  if (items.length === 0) return <p className="py-4 text-center text-[13px] text-ink-3">Nothing has happened with this lead yet.</p>;
  return (
    <ol className="relative">
      {items.map((t, i) => {
        const { icon: Icon, cls } = ICON[t.kind];
        const inbound = t.kind === 'reply' || t.kind === 'wa_in';
        const showBody = t.body && t.kind !== 'reminder' && t.kind !== 'stage';
        return (
          <li key={t.key} className="relative flex gap-3 pb-5 last:pb-0">
            {i < items.length - 1 && <span className="absolute left-[15px] top-8 bottom-0 w-px bg-line" aria-hidden />}
            <span className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-1 ring-inset ${cls}`}>
              <Icon size={15} aria-hidden />
            </span>
            <div className="min-w-0 flex-1 pt-1">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <span className={`text-[13.5px] ${inbound ? 'font-semibold text-ink' : 'font-medium text-ink'}`}>{titleFor(t)}</span>
                  <span className="ml-2 whitespace-nowrap text-[11.5px] text-ink-3">{t.at ? formatDateTime(t.at) : 'time unknown'}</span>
                </div>
                {t.activityId && (t.kind === 'note' || t.kind === 'call') && <DeleteActivityButton id={t.activityId} />}
              </div>
              {showBody && (
                <p className={`mt-1 whitespace-pre-wrap break-words text-[13px] leading-relaxed ${inbound ? 'rounded-xl rounded-tl-sm bg-slate-50 px-3 py-2 text-ink ring-1 ring-line' : 'text-ink-2'}`}>
                  {t.body}
                </p>
              )}
              {(t.meta || t.href) && (
                <div className="mt-1 flex flex-wrap items-center gap-x-3 text-[11.5px] text-ink-3">
                  {t.meta && t.kind !== 'reply' && t.kind !== 'our_reply' && <span>{t.meta}</span>}
                  {t.meta && (t.kind === 'reply' || t.kind === 'our_reply') && <span className="truncate">Subject: {t.meta}</span>}
                  {t.href && (
                    <Link href={t.href} className="font-medium text-brand hover:underline">
                      Open conversation
                    </Link>
                  )}
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  if (children === null || children === undefined || children === '') return null;
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line py-2 text-[13px] last:border-0">
      <dt className="shrink-0 text-ink-3">{label}</dt>
      <dd className="min-w-0 text-right text-ink [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const w = await leadWorkspace(id);
  if (!w) notFound();
  const l = present(w.card);
  const name = l.name || l.email || l.links.phoneLabel || `Lead #${l.id}`;
  const waHref = l.channel === 'whatsapp' && w.waChat ? `/whatsapp/inbox?chat=${encodeURIComponent(w.waChat.chatId)}&session=${encodeURIComponent(w.waChat.session)}` : null;
  const emailHref = w.latestThread ? `/inbox?thread=${encodeURIComponent(w.latestThread)}` : null;
  const replyHref = l.replyChannel === 'whatsapp' ? (w.waChat ? `/whatsapp/inbox?chat=${encodeURIComponent(w.waChat.chatId)}&session=${encodeURIComponent(w.waChat.session)}` : null) : emailHref;
  const website = w.website ? (/^https?:\/\//i.test(w.website) ? w.website : `https://${w.website}`) : null;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-3 flex items-center justify-between">
        <Link href="/leads" className="-ml-2 flex items-center gap-1 rounded-lg px-2 py-1.5 text-[13.5px] font-medium text-ink-2 hover:bg-white hover:text-ink">
          <ArrowLeft size={17} aria-hidden /> Leads
        </Link>
        <StarButton leadId={l.id} starred={l.starred} />
      </div>

      <header className="card overflow-hidden">
        <div className={`stage-wash tint-${l.stage ?? 'none'} p-4 sm:p-5`}>
          <div className="flex items-start gap-3.5">
            <Avatar name={name} stage={l.stage} size={56} />
            <div className="min-w-0 flex-1">
              <h1 className="text-[21px] font-bold leading-tight tracking-tight text-ink sm:text-[24px] [overflow-wrap:anywhere]">{name}</h1>
              <p className="mt-0.5 text-[13px] text-ink-3">{[l.category, l.city, w.country].filter(Boolean).join(' · ') || '—'}</p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <StageBadge stage={l.stage} />
                <AttentionBadge attention={l.attention} label={l.attentionLabel} />
                {l.attention === 'reply' && l.replyIntent !== 'other' && <IntentBadge intent={l.replyIntent} />}
                <ReminderBadge label={l.reminderLabel} tone={l.reminderTone} />
                <Link href={`/campaigns/${l.campaignSlug}`} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11.5px] font-medium text-ink-2 hover:bg-slate-200">
                  {l.campaignName}
                </Link>
              </div>
            </div>
          </div>
          {(l.links.phoneLabel || l.email) && (
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-ink-2">
              {l.links.phoneLabel && (
                <a href={l.links.tel ?? undefined} className="flex items-center gap-1.5 hover:text-ink">
                  <Phone size={13} aria-hidden /> {l.links.phoneLabel}
                </a>
              )}
              {l.email && (
                <a href={`mailto:${l.email}`} className="flex min-w-0 items-center gap-1.5 hover:text-ink">
                  <Mail size={13} aria-hidden /> <span className="truncate">{l.email}</span>
                </a>
              )}
            </div>
          )}
          <div className="mt-4">
            <LeadActionBar links={l.links} waHref={waHref} emailHref={emailHref} name={name} />
          </div>
        </div>
        {l.attention && (
          <div className={`attn-${l.attention} flex flex-col gap-2.5 border-t border-indigo-100 bg-gradient-to-r from-indigo-50/80 via-fuchsia-50/60 to-amber-50/50 px-4 py-3 sm:flex-row sm:items-center sm:gap-3`}>
            <span className="flex min-w-0 flex-1 items-start gap-2.5 text-[13px] text-ink">
              <span className="pulse-dot mt-1.5 shrink-0" aria-hidden />
              <span>
                <strong className="font-semibold">{ATTENTION_META[l.attention].label}.</strong> {ATTENTION_META[l.attention].help}
              </span>
            </span>
            <FocusActions leadId={l.id} attention={l.attention} tone="plain" />
          </div>
        )}
        {w.suppressed && (
          <div className="flex items-start gap-2 border-t border-red-200 bg-critical-50 px-4 py-2.5 text-[13px] text-ink">
            <ShieldAlert size={16} className="mt-0.5 shrink-0 text-critical" aria-hidden />
            Do not contact: on the suppression list ({w.suppressionReason}).
          </div>
        )}
      </header>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          {(l.replyText || w.sheetReplyNote) && (
            <Panel
              title={l.replyChannel === 'whatsapp' ? 'Their latest WhatsApp' : 'Their latest reply'}
              action={
                replyHref ? (
                  <Link href={replyHref} className="flex items-center gap-1 text-[13px] font-medium text-brand hover:underline">
                    <Reply size={14} aria-hidden /> Reply
                  </Link>
                ) : null
              }
            >
              {l.replyText && <p className="rounded-2xl rounded-tl-sm bg-sky-50/70 px-4 py-3 text-[14.5px] leading-relaxed text-ink ring-1 ring-sky-100">{l.replyText}</p>}
              <div className="mt-2 flex flex-wrap gap-x-3 text-[12px] text-ink-3">
                {l.lastReplyAt && <span>{formatDateTime(l.lastReplyAt)}</span>}
                {w.sheetReplyNote && <span>Sheet note: {w.sheetReplyNote}</span>}
              </div>
            </Panel>
          )}

          <Panel title="Stage">
            <StagePicker leadId={l.id} stage={l.stage} />
            {w.stageSource === 'sheet' && w.sheetStageText && <p className="mt-1 text-[12px] text-ink-3">Set from the sheet&rsquo;s Lead Stage: &ldquo;{w.sheetStageText}&rdquo;. Picking a stage here takes over.</p>}
            <div className="mt-4 border-t border-line pt-4">
              <ReminderPicker leadId={l.id} current={l.reminderLabel} />
            </div>
          </Panel>

          <Panel>
            <LogCallPanel leadId={l.id} stage={l.stage} />
          </Panel>

          <Panel title="Activity">
            <NoteComposer leadId={l.id} />
            <div className="mt-5">
              <Timeline items={w.timeline} />
            </div>
          </Panel>
        </div>

        <aside className="space-y-4">
          <Panel title="Details">
            <dl>
              <Detail label="Phone">{l.links.phoneLabel ?? l.phone}</Detail>
              <Detail label="Email">{l.email}</Detail>
              <Detail label="Website">
                {website && (
                  <a href={website} target="_blank" rel="noopener noreferrer" className="link inline-flex items-center gap-1">
                    {w.website?.replace(/^https?:\/\//i, '').replace(/\/$/, '')} <ExternalLink size={12} aria-hidden />
                  </a>
                )}
              </Detail>
              <Detail label="Location">{[l.city, w.country].filter(Boolean).join(', ')}</Detail>
              <Detail label="Category">{l.category}</Detail>
              <Detail label="Meeting">{w.sheetMeetingTime}</Detail>
              <Detail label="Calls">{l.callCount > 0 ? `${l.callCount}${l.lastCallLabel ? ` · last: ${l.lastCallLabel}` : ''}` : null}</Detail>
              <Detail label="Campaign">
                <Link href={`/campaigns/${l.campaignSlug}`} className="link">
                  {l.campaignName}
                </Link>
              </Detail>
              <Detail label="Sheet">
                {w.sourceName &&
                  (w.sourceUrl ? (
                    <a className="link inline-flex items-center gap-1" href={w.sourceUrl} target="_blank" rel="noopener noreferrer">
                      {w.sourceName}
                      {w.rowNumber ? `, row ${w.rowNumber}` : ''} <ExternalLink size={12} aria-hidden />
                    </a>
                  ) : (
                    `${w.sourceName}${w.rowNumber ? `, row ${w.rowNumber}` : ''}`
                  ))}
              </Detail>
            </dl>
            {w.otherCampaigns.length > 0 && (
              <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-[12.5px] text-ink-2">
                Also in:{' '}
                {w.otherCampaigns.map((o, i) => (
                  <span key={o.id}>
                    {i > 0 && ', '}
                    <Link className="link" href={`/leads/${o.id}`}>
                      {o.campaignName}
                    </Link>
                  </span>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="Deal value">
            <DealEditor leadId={l.id} value={l.dealValue} currency={l.dealCurrency} />
          </Panel>

          <Panel title="Outreach">
            <dl>
              <Detail label="Messages sent">
                {w.sendsAccepted}
                {w.followupsAccepted > 0 ? ` (${w.followupsAccepted} follow-up${w.followupsAccepted === 1 ? '' : 's'})` : ''}
              </Detail>
              <Detail label="First contacted">{w.firstContactedAt ? formatDate(w.firstContactedAt) : '—'}</Detail>
              <Detail label="Last contacted">{l.lastContactedAt ? formatDate(l.lastContactedAt) : '—'}</Detail>
              <Detail label="Next follow-up">{w.nextFollowupAt ? formatDate(w.nextFollowupAt) : 'None'}</Detail>
              <Detail label="Sheet status">{w.sheetStatus || '(blank)'}</Detail>
              <Detail label="Sheet lead stage">{w.sheetStageText}</Detail>
            </dl>
            {!w.presentInSource && <p className="mt-2 text-[12px] text-warn">This row is no longer in the sheet; its history is kept.</p>}
          </Panel>

          <details className="card px-4 py-3 text-[13px]">
            <summary className="cursor-pointer font-medium text-ink-2">Full sheet row</summary>
            <dl className="mt-2">
              {Object.entries(w.raw)
                .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== '')
                .map(([k, v]) => (
                  <Detail key={k} label={k}>
                    {String(v).slice(0, 400)}
                  </Detail>
                ))}
            </dl>
          </details>
        </aside>
      </div>
    </div>
  );
}
