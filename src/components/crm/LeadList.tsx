import Link from 'next/link';
import { PhoneCall } from 'lucide-react';
import type { LeadCardView } from '@/lib/crm/present';
import { Avatar, ChannelDot, ContactButtons, ReminderBadge, StageBadge, StarMark } from './LeadBits';

function subline(l: LeadCardView): string {
  return [l.category, l.city, l.campaignName].filter(Boolean).join(' · ');
}

export function LeadListItem({ lead, showStage = true }: { lead: LeadCardView; showStage?: boolean }) {
  const name = lead.name || lead.email || lead.links.phoneLabel || `Lead #${lead.id}`;
  return (
    <li className="card relative overflow-hidden transition-shadow hover:shadow-[var(--shadow-pop)]">
      <Link href={`/leads/${lead.id}`} className="absolute inset-0 z-0" aria-label={`Open ${name}`} />
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
              {showStage && <StageBadge stage={lead.stage} />}
              <ReminderBadge label={lead.reminderLabel} tone={lead.reminderTone} />
              {lead.lastCallLabel && (
                <span className="inline-flex items-center gap-1 text-[11.5px] text-ink-3">
                  <PhoneCall size={12} aria-hidden />
                  {lead.lastCallLabel}
                </span>
              )}
            </div>
            <div className="pointer-events-auto">
              <ContactButtons links={lead.links} name={name} />
            </div>
          </div>
        </div>
      </div>
    </li>
  );
}

export function LeadList({ leads, showStage }: { leads: LeadCardView[]; showStage?: boolean }) {
  return (
    <ul className="grid grid-cols-1 gap-2.5 xl:grid-cols-2">
      {leads.map((l) => (
        <LeadListItem key={l.id} lead={l} showStage={showStage} />
      ))}
    </ul>
  );
}
