import { env } from '../env';
import { addDays, localDate } from '../time';

export class Params {
  readonly values: unknown[] = [];
  add(v: unknown): string {
    this.values.push(v);
    return `$${this.values.length}`;
  }
}

export interface Filters {
  from: string; // YYYY-MM-DD, dashboard timezone, inclusive
  to: string; // YYYY-MM-DD, inclusive
  campaign: string | null; // slug
  domain: string | null; // sending domain
  mailbox: string | null; // address
  channel: 'all' | 'email' | 'whatsapp';
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseFilters(sp: Record<string, string | string[] | undefined>, defaultDays = 30): Filters {
  const get = (k: string) => {
    const v = sp[k];
    return (Array.isArray(v) ? v[0] : v)?.trim() || null;
  };
  const today = localDate();
  let to = get('to');
  let from = get('from');
  if (!to || !DATE.test(to)) to = today;
  if (!from || !DATE.test(from)) from = addDays(to, -(defaultDays - 1));
  if (from > to) [from, to] = [to, from];
  // Cap ranges at ~2 years to keep queries cheap.
  if (addDays(from, 731) < to) from = addDays(to, -730);
  const channel = get('channel');
  return {
    from,
    to,
    campaign: get('campaign'),
    domain: get('domain')?.toLowerCase() ?? null,
    mailbox: get('mailbox')?.toLowerCase() ?? null,
    channel: channel === 'email' || channel === 'whatsapp' ? channel : 'all',
  };
}

export function filtersToQuery(f: Partial<Filters>, extra: Record<string, string | null | undefined> = {}): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...f, ...extra })) if (v && v !== 'all') u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : '';
}

/**
 * WHERE fragments for rows that carry campaign_id / mailbox_id / channel.
 * `alias` names the table alias; campaigns are joined as `c`, mailboxes as `mb`.
 */
export function scopeSql(f: Filters, p: Params, alias: string, opts: { channelCol?: string | null } = {}): string {
  const parts: string[] = [];
  if (f.campaign) parts.push(`c.slug = ${p.add(f.campaign)}`);
  if (f.domain) parts.push(`mb.domain = ${p.add(f.domain)}`);
  if (f.mailbox) parts.push(`mb.address = ${p.add(f.mailbox)}`);
  const ch = opts.channelCol === undefined ? `${alias}.channel` : opts.channelCol;
  if (f.channel !== 'all' && ch) parts.push(`${ch} = ${p.add(f.channel)}`);
  return parts.length ? ` and ${parts.join(' and ')}` : '';
}

export function localDaySql(col: string, p: Params): string {
  return `(${col} at time zone ${p.add(env.timezone)})::date`;
}
