// Small presentational pieces for leads. No server imports: usable from server and client components.
import { AlarmClock, Mail, MessageCircle, Phone, Snowflake, Star } from 'lucide-react';
import { INTENT_META, INTENT_TINT, isIntent } from '@/lib/crm/intent';
import { STAGE_META, type Stage } from '@/lib/crm/stages';
import { initials } from '@/lib/crm/contact';
import type { ContactLinks } from '@/lib/crm/contact';

export function StageBadge({ stage, className = '' }: { stage: Stage | null; className?: string }) {
  if (!stage) return <span className={`inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2 py-0.5 text-[11.5px] font-medium text-ink-3 ring-1 ring-inset ring-slate-200 ${className}`}>Not in pipeline</span>;
  const m = STAGE_META[stage];
  return (
    <span title={m.help} className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-semibold ring-1 ring-inset ${m.chip} ${className}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} aria-hidden />
      {m.short}
    </span>
  );
}

/** Initials avatar filled with the stage's gradient (see .tint-* in globals.css). */
export function Avatar({ name, stage, size = 40 }: { name: string | null; stage: Stage | null; size?: number }) {
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }}
      className={`avatar-grad tint-${stage ?? 'none'} inline-flex shrink-0 items-center justify-center rounded-full font-semibold`}
    >
      {initials(name)}
    </span>
  );
}

/** Why a lead needs you: "Waiting 2 h" (they replied) or "Quiet 6 days" (a hot lead went silent). */
export function AttentionBadge({ attention, label }: { attention: 'reply' | 'due' | 'cold' | null; label: string | null }) {
  if (!label || !attention || attention === 'due') return null;
  if (attention === 'reply') {
    return (
      <span className="attn-reply inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-gradient-to-r from-indigo-50 to-pink-50 px-2 py-0.5 text-[11.5px] font-semibold text-indigo-700 ring-1 ring-inset ring-indigo-200/80">
        <span className="pulse-dot !h-1.5 !w-1.5" aria-hidden />
        {label}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-gradient-to-r from-sky-50 to-indigo-50 px-2 py-0.5 text-[11.5px] font-semibold text-sky-700 ring-1 ring-inset ring-sky-200">
      <Snowflake size={12} aria-hidden />
      {label}
    </span>
  );
}

export function ReminderBadge({ label, tone }: { label: string | null; tone: 'overdue' | 'today' | 'soon' | 'later' | null }) {
  if (!label || !tone) return null;
  const cls = {
    overdue: 'bg-critical-50 text-critical ring-red-200',
    today: 'bg-amber-50 text-amber-800 ring-amber-200',
    soon: 'bg-brand-50 text-brand ring-indigo-200',
    later: 'bg-slate-50 text-ink-2 ring-slate-200',
  }[tone];
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-medium ring-1 ring-inset ${cls}`}>
      <AlarmClock size={12} aria-hidden />
      {label}
    </span>
  );
}

export function StarMark({ on }: { on: boolean }) {
  if (!on) return null;
  return <Star size={14} className="shrink-0 fill-amber-400 text-amber-400" aria-label="Starred" />;
}

/**
 * Round call / WhatsApp / email buttons. `waHref` overrides the wa.me link (e.g. the in-app chat
 * on the business number the lead already talks to); `emailHref` likewise (the inbox thread).
 */
export function ContactButtons({
  links,
  waHref,
  emailHref,
  size = 'md',
  name,
}: {
  links: ContactLinks;
  waHref?: string | null;
  emailHref?: string | null;
  size?: 'md' | 'sm';
  name?: string | null;
}) {
  const wa = waHref ?? links.wa;
  const mail = emailHref ?? links.mailto;
  const dim = size === 'sm' ? 'h-8 w-8' : '';
  const who = name ? ` ${name}` : '';
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      {links.tel && (
        <a href={links.tel} className={`contact-btn ${dim} border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100`} aria-label={`Call${who}`} title={links.phoneLabel ?? 'Call'}>
          <Phone size={size === 'sm' ? 15 : 17} aria-hidden />
        </a>
      )}
      {wa && (
        <a
          href={wa}
          {...(wa.startsWith('http') ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
          className={`contact-btn ${dim} border-green-200 bg-green-50 text-green-700 hover:bg-green-100`}
          aria-label={`WhatsApp${who}`}
          title="WhatsApp"
        >
          <MessageCircle size={size === 'sm' ? 15 : 17} aria-hidden />
        </a>
      )}
      {mail && (
        <a href={mail} className={`contact-btn ${dim} text-brand hover:bg-brand-50`} aria-label={`Email${who}`} title={links.mailto?.replace('mailto:', '') ?? 'Email'}>
          <Mail size={size === 'sm' ? 15 : 17} aria-hidden />
        </a>
      )}
    </div>
  );
}

export function ChannelDot({ channel }: { channel: 'email' | 'whatsapp' | null }) {
  if (channel === 'whatsapp') return <MessageCircle size={13} className="mt-0.5 shrink-0 text-green-600" aria-label="WhatsApp" />;
  if (channel === 'email') return <Mail size={13} className="mt-0.5 shrink-0 text-brand" aria-label="Email" />;
  return null;
}

/** What a reply means (Interested, Asked a question, Wants a call, Not interested, …). */
export function IntentBadge({ intent, className = '' }: { intent: string | null | undefined; className?: string }) {
  if (!isIntent(intent)) return null;
  const m = INTENT_META[intent];
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-semibold ring-1 ring-inset ${m.chip} ${className}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} aria-hidden />
      {m.label}
    </span>
  );
}

/** Round initials avatar tinted by what their reply means. */
export function IntentAvatar({ name, intent, size = 40 }: { name: string | null; intent: string | null | undefined; size?: number }) {
  const tint = isIntent(intent) ? INTENT_TINT[intent] : 'tint-none';
  return (
    <span aria-hidden style={{ width: size, height: size, fontSize: Math.round(size * 0.36) }} className={`avatar-grad ${tint} inline-flex shrink-0 items-center justify-center rounded-full font-semibold`}>
      {initials(name)}
    </span>
  );
}
