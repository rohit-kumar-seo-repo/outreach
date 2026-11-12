// Server-side display labels for lead cards (timezone-aware), so client components get plain strings.
import { env } from '../env';
import { localDate, relativeTime } from '../time';
import type { LeadCard } from './queries';

export type ReminderTone = 'overdue' | 'today' | 'soon' | 'later';

export interface LeadCardView extends LeadCard {
  whenLabel: string | null;
  reminderLabel: string | null;
  reminderTone: ReminderTone | null;
  lastCallLabel: string | null;
}

function hm(d: Date): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: env.timezone, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
}

function dayLabel(d: Date): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: env.timezone, weekday: 'short', day: 'numeric', month: 'short' }).format(d);
}

export function reminderLabel(at: Date | null, now = new Date()): { label: string; tone: ReminderTone } | null {
  if (!at) return null;
  const today = localDate(now);
  const day = localDate(at);
  const tomorrow = localDate(new Date(now.getTime() + 86400_000));
  if (at.getTime() < now.getTime()) {
    return { label: day === today ? `Due ${hm(at)}` : `Overdue · ${dayLabel(at)}`, tone: 'overdue' };
  }
  if (day === today) return { label: `Today ${hm(at)}`, tone: 'today' };
  if (day === tomorrow) return { label: `Tomorrow ${hm(at)}`, tone: 'soon' };
  return { label: dayLabel(at), tone: 'later' };
}

const CALL_WORD: Record<string, string> = { connected: 'Spoke', no_answer: 'No answer', busy: 'Busy', wrong_number: 'Wrong number' };

export function present(c: LeadCard, now = new Date()): LeadCardView {
  const latest = [c.lastReplyAt, c.lastActivityAt].filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0] ?? c.lastContactedAt;
  const r = reminderLabel(c.reminderAt, now);
  return {
    ...c,
    whenLabel: latest ? relativeTime(latest, now) : null,
    reminderLabel: r?.label ?? null,
    reminderTone: r?.tone ?? null,
    lastCallLabel: c.lastCallAt ? `${CALL_WORD[c.lastCallOutcome ?? ''] ?? 'Called'} · ${relativeTime(c.lastCallAt, now)}` : null,
  };
}

export function presentAll(cards: LeadCard[]): LeadCardView[] {
  const now = new Date();
  return cards.map((c) => present(c, now));
}

export function greeting(now = new Date()): string {
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: env.timezone, hour: '2-digit', hour12: false }).format(now));
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export function longToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: env.timezone, weekday: 'long', day: 'numeric', month: 'long' }).format(now);
}

export function money(value: number | null, currency: string | null): string | null {
  if (value === null || value === undefined) return null;
  try {
    return new Intl.NumberFormat(currency === 'INR' || !currency ? 'en-IN' : 'en-GB', {
      style: 'currency',
      currency: currency ?? 'INR',
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${currency ?? ''} ${value}`;
  }
}
