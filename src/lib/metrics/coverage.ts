// Historical-data coverage: for every campaign and day, how trustworthy the dashboard's numbers are.
//
//   complete     the day is inside a source that records every send with its time:
//                - n8n execution history (from the earliest execution the dashboard has synced,
//                  as long as the n8n sync keeps succeeding), or
//                - the synced Sent folders of every mailbox the campaign sends from (campaigns that
//                  send through the Hostinger Email API, which keeps a Sent copy of each message).
//   approximate  outside those windows, but the lead sheets record sends on that day
//                (exact timestamps or dates only); rows later overwritten or deleted are missing.
//   unknown      no source covers the day; a zero there does not mean nothing was sent.
// Sends whose date is recorded nowhere are counted separately per campaign ("undated").
import { env } from '../env';
import { one, q } from '../db';
import { registry } from '../registry';
import { addDays, localDate } from '../time';

export type CoverageStatus = 'complete' | 'approximate' | 'unknown';

export interface CoverageCell {
  day: string;
  status: CoverageStatus;
  sends: number;
  exact: number;
  dateOnly: number;
  via: 'n8n' | 'mailbox' | 'sheet' | null;
}

export interface CampaignCoverage {
  slug: string;
  name: string;
  channel: string;
  cells: CoverageCell[];
  undated: number;
  completeFrom: string | null;
  completeVia: string | null;
  counts: Record<CoverageStatus, number>;
}

export interface SourceCoverage {
  n8n: { executions: number; earliest: Date | null; latest: Date | null; lastSuccess: Date | null; healthy: boolean };
  sheets: { sources: number; ok: number; rows: number; lastSuccess: Date | null; exact: number; dateOnly: number; undated: number };
  mailboxes: { total: number; connected: number; messages: number; earliest: Date | null; lastSuccess: Date | null };
  whatsapp: { messages: number; earliest: Date | null; lastSuccess: Date | null };
}

/** Pure rule used for every cell (exported for tests). */
export function cellStatus(
  day: string,
  sends: { n: number; dateOnly: number },
  windows: { n8nFrom: string | null; n8nUntil: string | null; mailFrom: string | null },
): { status: CoverageStatus; via: CoverageCell['via'] } {
  if (windows.n8nFrom && day >= windows.n8nFrom && (!windows.n8nUntil || day <= windows.n8nUntil)) return { status: 'complete', via: 'n8n' };
  if (windows.mailFrom && day >= windows.mailFrom) return { status: 'complete', via: 'mailbox' };
  if (sends.n > 0) return { status: 'approximate', via: 'sheet' };
  return { status: 'unknown', via: null };
}

export async function coverageGrid(days = 45): Promise<{ dayList: string[]; campaigns: CampaignCoverage[] }> {
  const tz = env.timezone;
  const today = localDate();
  const from = addDays(today, -(days - 1));
  const dayList = Array.from({ length: days }, (_, i) => addDays(from, i));
  const reg = registry();

  const n8n = await one<{ earliest: string | null; last_success: string | null; healthy: boolean }>(
    `select (select (min(started_at) at time zone $1)::date::text from n8n_executions) as earliest,
            (select (last_success_at at time zone $1)::date::text from sources where key = 'n8n:executions') as last_success,
            coalesce((select last_status = 'ok' from sources where key = 'n8n:executions'), false) as healthy`,
    [tz],
  );
  // Sent-folder coverage per mailbox: from its oldest synced Sent message, if the mailbox syncs.
  const boxes = await q<{ address: string; start: string | null; ok: boolean }>(
    `select mb.address, (select (min(m.sent_at) at time zone $1)::date::text from mail_messages m
                          where m.mailbox_id = mb.id and m.folder ~* 'sent') as start,
            mb.last_success_at is not null and coalesce(mb.last_status, '') = 'ok' as ok
       from mailboxes mb`,
    [tz],
  );
  const boxStart = new Map(boxes.map((b) => [b.address, b.ok ? b.start : null]));
  const senders = await q<{ campaign_id: number; addresses: string[] }>(
    `select sa.campaign_id, array_agg(distinct coalesce(mb.address, lower(sa.sender))) as addresses
       from send_attempts sa left join mailboxes mb on mb.id = sa.mailbox_id
      where sa.result = 'accepted' and sa.channel = 'email' and coalesce(mb.address, sa.sender) is not null
      group by sa.campaign_id`,
  );
  const campaigns = await q<{ id: number; slug: string; name: string; channel: string }>(`select id, slug, name, channel from campaigns order by channel, name`);
  const counts = await q<{ campaign_id: number; day: string; n: number; date_only: number }>(
    `select v.campaign_id, (v.occurred_at at time zone $1)::date::text as day, count(*)::int as n,
            count(*) filter (where v.time_quality = 'date_only')::int as date_only
       from v_sends v
      where v.occurred_at is not null and v.time_quality <> 'unknown' and (v.occurred_at at time zone $1)::date between $2::date and $3::date
      group by 1, 2`,
    [tz, from, today],
  );
  const undated = await q<{ campaign_id: number; n: number }>(
    `select campaign_id, count(*)::int as n from v_sends where occurred_at is null or time_quality = 'unknown' group by campaign_id`,
  );

  // n8n history counts as complete up to the last successful sync (or through today while healthy).
  const n8nUntil = n8n?.healthy ? null : (n8n?.last_success ?? null);
  const out: CampaignCoverage[] = campaigns.map((c) => {
    const def = reg.campaigns.find((x) => x.slug === c.slug);
    const workflows = reg.workflows.filter((w) => def?.workflowIds.includes(w.id) || w.campaign.slug === c.slug);
    const viaN8n = workflows.length > 0 && !!n8n?.earliest && !!n8n.last_success;
    const apiOnly = workflows.length > 0 && workflows.every((w) => w.sendNodes.every((n) => n.provider === 'hostinger_api'));
    const addrs = senders.find((s) => s.campaign_id === c.id)?.addresses ?? [];
    const starts = addrs.map((a) => boxStart.get(a) ?? null);
    const mailFrom = apiOnly && addrs.length > 0 && starts.every(Boolean) ? (starts as string[]).sort().at(-1)! : null;
    const windows = { n8nFrom: viaN8n ? n8n!.earliest : null, n8nUntil: viaN8n ? n8nUntil : null, mailFrom };
    const cells = dayList.map((day) => {
      const r = counts.find((x) => x.campaign_id === c.id && x.day === day);
      const sends = { n: r?.n ?? 0, dateOnly: r?.date_only ?? 0 };
      const s = cellStatus(day, sends, windows);
      return { day, status: s.status, via: s.via, sends: sends.n, dateOnly: sends.dateOnly, exact: sends.n - sends.dateOnly };
    });
    const froms = [windows.n8nFrom && { d: windows.n8nFrom, via: 'n8n execution history' }, windows.mailFrom && { d: windows.mailFrom, via: 'Sent folders' }].filter(
      Boolean,
    ) as { d: string; via: string }[];
    const first = froms.sort((a, b) => a.d.localeCompare(b.d))[0];
    return {
      slug: c.slug,
      name: c.name,
      channel: c.channel,
      cells,
      undated: undated.find((u) => u.campaign_id === c.id)?.n ?? 0,
      completeFrom: first?.d ?? null,
      completeVia: first?.via ?? null,
      counts: {
        complete: cells.filter((x) => x.status === 'complete').length,
        approximate: cells.filter((x) => x.status === 'approximate').length,
        unknown: cells.filter((x) => x.status === 'unknown').length,
      },
    };
  });
  return { dayList, campaigns: out };
}

export async function sourceCoverage(): Promise<SourceCoverage> {
  const r = await one<{
    n8n_count: number;
    n8n_earliest: Date | null;
    n8n_latest: Date | null;
    n8n_success: Date | null;
    n8n_ok: boolean;
    sheet_sources: number;
    sheet_ok: number;
    sheet_rows: number;
    sheet_success: Date | null;
    sheet_exact: number;
    sheet_date_only: number;
    sheet_undated: number;
    mb_total: number;
    mb_connected: number;
    mb_messages: number;
    mb_earliest: Date | null;
    mb_success: Date | null;
    wa_messages: number;
    wa_earliest: Date | null;
    wa_success: Date | null;
  }>(
    `select
       (select count(*)::int from n8n_executions) as n8n_count,
       (select min(started_at) from n8n_executions) as n8n_earliest,
       (select max(started_at) from n8n_executions) as n8n_latest,
       (select last_success_at from sources where key = 'n8n:executions') as n8n_success,
       coalesce((select last_status = 'ok' from sources where key = 'n8n:executions'), false) as n8n_ok,
       (select count(*)::int from sources where kind in ('google_sheet', 'n8n_data_table')) as sheet_sources,
       (select count(*)::int from sources where kind in ('google_sheet', 'n8n_data_table') and last_status = 'ok') as sheet_ok,
       (select coalesce(sum(row_count), 0)::int from sources where kind in ('google_sheet', 'n8n_data_table')) as sheet_rows,
       (select max(last_success_at) from sources where kind in ('google_sheet', 'n8n_data_table')) as sheet_success,
       (select count(*)::int from send_attempts where source = 'sheet_status' and result = 'accepted' and time_quality = 'exact') as sheet_exact,
       (select count(*)::int from send_attempts where source = 'sheet_status' and result = 'accepted' and time_quality = 'date_only') as sheet_date_only,
       (select count(*)::int from send_attempts where source = 'sheet_status' and result = 'accepted' and time_quality = 'unknown') as sheet_undated,
       (select count(*)::int from mailboxes) as mb_total,
       (select count(*)::int from mailboxes where last_status = 'ok') as mb_connected,
       (select count(*)::int from mail_messages) as mb_messages,
       (select min(sent_at) from mail_messages) as mb_earliest,
       (select max(last_success_at) from mailboxes) as mb_success,
       (select count(*)::int from wa_messages) as wa_messages,
       (select min(sent_at) from wa_messages) as wa_earliest,
       (select last_success_at from sources where key = 'waha') as wa_success`,
  );
  return {
    n8n: { executions: r?.n8n_count ?? 0, earliest: r?.n8n_earliest ?? null, latest: r?.n8n_latest ?? null, lastSuccess: r?.n8n_success ?? null, healthy: !!r?.n8n_ok },
    sheets: {
      sources: r?.sheet_sources ?? 0,
      ok: r?.sheet_ok ?? 0,
      rows: r?.sheet_rows ?? 0,
      lastSuccess: r?.sheet_success ?? null,
      exact: r?.sheet_exact ?? 0,
      dateOnly: r?.sheet_date_only ?? 0,
      undated: r?.sheet_undated ?? 0,
    },
    mailboxes: { total: r?.mb_total ?? 0, connected: r?.mb_connected ?? 0, messages: r?.mb_messages ?? 0, earliest: r?.mb_earliest ?? null, lastSuccess: r?.mb_success ?? null },
    whatsapp: { messages: r?.wa_messages ?? 0, earliest: r?.wa_earliest ?? null, lastSuccess: r?.wa_success ?? null },
  };
}
