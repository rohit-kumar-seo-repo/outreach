import Link from 'next/link';
import { PhoneCall } from 'lucide-react';
import type { LeadCardView } from '@/lib/crm/present';
import { DismissableItem, FocusActions } from './FocusActions';
import { AttentionBadge, Avatar, ChannelDot, ContactButtons, IntentBadge, ReminderBadge, StageBadge, StarMark } from './LeadBits';

function subline(l: LeadCardView): string {
  return [l.category, l.city, l.campaignName].filter(Boolean).join(' · ');
}

/**
 * A lead card. Colour-graded by stage (gradient avatar and left edge); a lead that needs you gets
 * a gradient ring in its reason's colours. With `actions`, it also offers Done / Later and folds
 * away once dealt with (used for the "Needs you" lists).
 */
export function LeadListItem({ lead, showStage = true, actions = false }: { lead: LeadCardView; showStage?: boolean; actions?: boolean }) {
  const name = lead.name || lead.email || lead.links.phoneLabel || `Lead #${lead.id}`;
  // With Done / Later, the contact buttons move down beside them so the badges get the full width.
  const withActions = actions && !!lead.attention;
  const contact = (
    <div className="pointer-events-auto">
      <ContactButtons links={lead.links} name={name} />
    </div>
  );
  const cls = `card accent-bar tint-${lead.stage ?? 'none'} ${lead.attention ? `ring-grad attn-${lead.attention}` : ''} relative transition-shadow hover:shadow-[var(--shadow-pop)]`;
  const body = (
    <>
      <Link href={`/leads/${lead.id}`} className="absolute inset-0 z-0 rounded-[inherit]" aria-label={`Open ${name}`} />
      <div className="pointer-events-none relative z-10 flex gap-3 p-3.5 sm:p-4">
        <Avatar name={name} stage={lead.stage} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-[15px] font-semibold text-ink">{name}</span>
              <StarMark on={lead.starred} />
            </span>
            {lead.whenLabel && <span className="ml-auto shrink-0 text-[11.5px] text-ink-3">{lead.whenLabel}</span>}
          </div>
          <div className="truncate text-[12.5px] text-ink-3">{subline(lead)}</div>
          {lead.replyText && (
            <p className="mt-1.5 flex gap-1.5 text-[13px] leading-snug text-ink-2">
              <ChannelDot channel={lead.replyChannel} />
              <span className="line-clamp-2">&ldquo;{lead.replyText}&rdquo;</span>
            </p>
          )}
          <div className="mt-2.5 flex items-center gap-2">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
              <AttentionBadge attention={lead.attention} label={lead.attentionLabel} />
              {showStage && <StageBadge stage={lead.stage} />}
              {(lead.stage === 'new' || !lead.stage || lead.attention === 'reply') && lead.replyIntent !== 'other' && <IntentBadge intent={lead.replyIntent} />}
              <ReminderBadge label={lead.reminderLabel} tone={lead.reminderTone} />
              {lead.lastCallLabel && (
                <span className="inline-flex items-center gap-1 text-[11.5px] text-ink-3">
                  <PhoneCall size={12} aria-hidden />
                  {lead.lastCallLabel}
                </span>
              )}
            </div>
            {!withActions && contact}
          </div>
        </div>
      </div>
      {/* Full card width (under the avatar too) so Done / Later and the contact buttons fit one row on a phone. */}
      {withActions && lead.attention && (
        <div className="pointer-events-none relative z-10 -mt-1 flex items-center justify-between gap-2 border-t border-dashed border-line px-3.5 pb-3 pt-3 sm:px-4">
          <FocusActions leadId={lead.id} attention={lead.attention} />
          {contact}
        </div>
      )}
    </>
  );
  if (withActions) return <DismissableItem className={cls}>{body}</DismissableItem>;
  return <li className={cls}>{body}</li>;
}

export function LeadList({ leads, showStage, actions }: { leads: LeadCardView[]; showStage?: boolean; actions?: boolean }) {
  return (
    <ul className="grid grid-cols-1 gap-2.5 xl:grid-cols-2">
      {leads.map((l) => (
        <LeadListItem key={l.id} lead={l} showStage={showStage} actions={actions} />
      ))}
    </ul>
  );
}
