// Daily sending volume per mailbox and per domain, and the configurable daily limits.
//
// A mailbox's daily total = outreach sends (v_sends, deduplicated, with a known date) sent from it
//                        + other mail in its Sent folders that is not linked to an outreach send
//                          (manual replies, internal digests...). Providers limit all mail, so both count.
import { env } from '../env';
import { q } from '../db';
import { addDays, localDate } from '../time';

export interface DayCount {
  day: string;
  outreach: number;
  outreachDateOnly: number;
  other: number;
  total: number;
}

export interface VolumeRow {
  key: string; // mailbox address or domain; '(unknown sender)' when a send has no known mailbox
  domain: string;
  scope: 'mailbox' | 'domain';
  mailboxes: number;
  days: DayCount[]; // oldest → newest, the last entry is today
  today: DayCount;
  limit: { dailyLimit: number; warnPct: number } | null;
  usage: number | null; // today.total / limit
  state: 'none' | 'ok' | 'near' | 'over';
}

export interface SendLimit {
  scope: 'mailbox' | 'domain';
  key: string;
  dailyLimit: number;
  warnPct: number;
}

export const UNKNOWN_SENDER = '(unknown sender)';

export async function sendLimits(): Promise<SendLimit[]> {
  return q<SendLimit>(`select scope, key, daily_limit as "dailyLimit", warn_pct as "warnPct" from send_limits order by scope, key`);
}

export function limitState(total: number, limit: { dailyLimit: number; warnPct: number } | null): VolumeRow['state'] {
  if (!limit) return 'none';
  if (total > limit.dailyLimit) return 'over';
  if (total >= Math.ceil((limit.dailyLimit * limit.warnPct) / 100)) return 'near';
  return 'ok';
}

/** Per-mailbox and per-domain totals for the last `days` local days (including today). */
export async function dailyVolumes(days = 14): Promise<{ mailboxes: VolumeRow[]; domains: VolumeRow[]; dayList: string[] }> {
  const today = localDate();
  const from = addDays(today, -(days - 1));
  const dayList = Array.from({ length: days }, (_, i) => addDays(from, i));
  const rows = await q<{ address: string | null; domain: string | null; day: string; outreach: number; date_only: number; other: number }>(
    `with outreach as (
       select coalesce(mb.address, lower(v.sender)) as address, coalesce(mb.domain, split_part(lower(v.sender), '@', 2)) as domain,
              (v.occurred_at at time zone $1)::date as day, count(*)::int as n,
              count(*) filter (where v.time_quality = 'date_only')::int as date_only
         from v_sends v left join mailboxes mb on mb.id = v.mailbox_id
        where v.channel = 'email' and v.occurred_at is not null and v.time_quality <> 'unknown'
          and (v.occurred_at at time zone $1)::date between $2::date and $3::date
        group by 1, 2, 3),
     other as (
       select mb.address, mb.domain, (m.sent_at at time zone $1)::date as day,
              count(distinct coalesce(m.message_id, m.folder || ':' || m.uid))::int as n
         from mail_messages m join mailboxes mb on mb.id = m.mailbox_id
        where m.direction = 'outbound' and m.send_attempt_id is null and m.folder ~* 'sent' and m.sent_at is not null
          and (m.sent_at at time zone $1)::date between $2::date and $3::date
        group by 1, 2, 3)
     select coalesce(o.address, x.address) as address, coalesce(o.domain, x.domain) as domain, coalesce(o.day, x.day)::text as day,
            coalesce(o.n, 0) as outreach, coalesce(o.date_only, 0) as date_only, coalesce(x.n, 0) as other
       from outreach o full join other x on x.address = o.address and x.day = o.day`,
    [env.timezone, from, today],
  );
  const known = await q<{ address: string; domain: string }>(`select address, domain from mailboxes order by domain, address`);
  const limits = await sendLimits();
  const limitFor = (scope: 'mailbox' | 'domain', key: string) => {
    const l = limits.find((x) => x.scope === scope && x.key === key);
    return l ? { dailyLimit: l.dailyLimit, warnPct: l.warnPct } : null;
  };

  const empty = (day: string): DayCount => ({ day, outreach: 0, outreachDateOnly: 0, other: 0, total: 0 });
  const byMailbox = new Map<string, { domain: string; days: Map<string, DayCount> }>();
  const ensure = (address: string, domain: string) => {
    if (!byMailbox.has(address)) byMailbox.set(address, { domain, days: new Map(dayList.map((d) => [d, empty(d)])) });
    return byMailbox.get(address)!;
  };
  for (const k of known) ensure(k.address, k.domain);
  for (const r of rows) {
    const address = r.address || UNKNOWN_SENDER;
    const entry = ensure(address, r.domain || (r.address ? r.address.split('@')[1] : UNKNOWN_SENDER));
    const d = entry.days.get(r.day);
    if (!d) continue;
    d.outreach += r.outreach;
    d.outreachDateOnly += r.date_only;
    d.other += r.other;
    d.total = d.outreach + d.other;
  }

  const toRow = (scope: 'mailbox' | 'domain', key: string, domain: string, days: DayCount[], mailboxes: number): VolumeRow => {
    const today = days[days.length - 1];
    const limit = key === UNKNOWN_SENDER ? null : limitFor(scope, key);
    return { key, domain, scope, mailboxes, days, today, limit, usage: limit ? today.total / limit.dailyLimit : null, state: limitState(today.total, limit) };
  };

  const mailboxes = [...byMailbox.entries()]
    .map(([address, v]) => toRow('mailbox', address, v.domain, dayList.map((d) => v.days.get(d)!), 1))
    .filter((r) => r.days.some((d) => d.total > 0) || r.limit || r.key !== UNKNOWN_SENDER);

  const domainMap = new Map<string, VolumeRow[]>();
  for (const m of mailboxes) domainMap.set(m.domain, [...(domainMap.get(m.domain) ?? []), m]);
  const domains = [...domainMap.entries()].map(([domain, members]) =>
    toRow(
      'domain',
      domain,
      domain,
      dayList.map((day, i) =>
        members.reduce<DayCount>(
          (acc, m) => ({
            day,
            outreach: acc.outreach + m.days[i].outreach,
            outreachDateOnly: acc.outreachDateOnly + m.days[i].outreachDateOnly,
            other: acc.other + m.days[i].other,
            total: acc.total + m.days[i].total,
          }),
          empty(day),
        ),
      ),
      members.filter((m) => m.key !== UNKNOWN_SENDER).length,
    ),
  );
  const order = (a: VolumeRow, b: VolumeRow) => b.today.total - a.today.total || sum(b) - sum(a) || a.key.localeCompare(b.key);
  return { mailboxes: mailboxes.sort(order), domains: domains.sort(order), dayList };
}

function sum(r: VolumeRow): number {
  return r.days.reduce((n, d) => n + d.total, 0);
}
