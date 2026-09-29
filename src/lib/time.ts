import { env } from './env';

/** YYYY-MM-DD of `d` in the dashboard timezone. */
export function localDate(d: Date = new Date(), tz: string = env.timezone): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

export function formatDateTime(d: Date | string | null | undefined, tz: string = env.timezone): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

export function formatDate(d: Date | string | null | undefined, tz: string = env.timezone): string {
  if (!d) return '—';
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
    const [y, m, day] = d.split('-').map(Number);
    return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric' }).format(
      new Date(Date.UTC(y, m - 1, day)),
    );
  }
  const date = typeof d === 'string' ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: '2-digit', month: 'short', year: 'numeric' }).format(date);
}

export function formatShortDay(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short' }).format(new Date(Date.UTC(y, m - 1, d)));
}

export function relativeTime(d: Date | string | null | undefined, now: Date = new Date()): string {
  if (!d) return 'never';
  const date = typeof d === 'string' ? new Date(d) : d;
  const diff = Math.round((now.getTime() - date.getTime()) / 1000);
  const abs = Math.abs(diff);
  const suffix = diff >= 0 ? 'ago' : 'from now';
  if (abs < 60) return diff >= 0 ? 'just now' : 'in under a minute';
  if (abs < 3600) return `${Math.round(abs / 60)} min ${suffix}`;
  if (abs < 86400) return `${Math.round(abs / 3600)} h ${suffix}`;
  return `${Math.round(abs / 86400)} d ${suffix}`;
}

/**
 * Parse a timestamp found in a spreadsheet cell. Returns quality so callers never
 * present a guessed time as exact. Only unambiguous formats are accepted.
 */
export function parseSheetTimestamp(value: unknown): { at: Date | null; quality: 'exact' | 'date_only' | 'unknown' } {
  const s = String(value ?? '').trim();
  if (!s) return { at: null, quality: 'unknown' };
  // Full ISO 8601 with time and offset / Z
  const iso = s.match(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})/);
  if (iso) {
    const d = new Date(iso[0].replace(' ', 'T'));
    if (!Number.isNaN(d.getTime())) return { at: d, quality: 'exact' };
  }
  const dateOnly = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) return { at: dateOnlyToNoonLocal(s), quality: 'date_only' };
  return { at: null, quality: 'unknown' };
}

/**
 * Date-only values are anchored at 12:00 in the dashboard timezone so they fall
 * on the correct local day in charts; they are always flagged time_quality=date_only.
 */
export function dateOnlyToNoonLocal(isoDate: string, tz: string = env.timezone): Date {
  const [y, m, d] = isoDate.split('-').map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const offsetMin = tzOffsetMinutes(guess, tz);
  return new Date(guess.getTime() - offsetMin * 60_000);
}

export function tzOffsetMinutes(at: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - at.getTime()) / 60_000);
}
