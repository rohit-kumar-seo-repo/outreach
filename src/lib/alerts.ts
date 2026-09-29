// Alerts: evaluated by the worker every few minutes. Each rule returns the alerts that should be
// open right now; open alerts are updated in place (one per fingerprint) and resolve on their own
// once their rule stops returning them. Alerts never trigger any outreach.
import { env } from './env';
import { one, q } from './db';
import { recordIntegrationError, resolveIntegrationErrors } from './errors';
import { dailyVolumes, UNKNOWN_SENDER } from './metrics/sending';
import { formatDateTime, localDate } from './time';

export type AlertKind = 'n8n_failed_run' | 'sync_failed' | 'followups_overdue' | 'bounce_spike' | 'volume_limit';
export type AlertSeverity = 'warning' | 'critical';

export interface AlertSettings {
  /** A domain needs at least this many bounces in 24 h before a spike is considered. */
  bounceMinCount: number;
  /** …and a bounce rate of at least this % of its sends in the last 48 h, */
  bounceRatePct: number;
  /** …or at least this many times its usual daily bounces (previous 14 days). */
  bounceSpikeMultiplier: number;
  /** Follow-ups count as overdue once their due date is more than this many days in the past. */
  overdueGraceDays: number;
  /** POST new alerts to the n8n "Outreach Dashboard — Alerts" webhook, which can notify you. */
  notifyN8n: boolean;
}

export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  bounceMinCount: 5,
  bounceRatePct: 5,
  bounceSpikeMultiplier: 3,
  overdueGraceDays: 0,
  notifyN8n: false,
};

export async function alertSettings(): Promise<AlertSettings> {
  const row = await one<{ value: Partial<AlertSettings> }>(`select value from app_state where key = 'alert_settings'`);
  return { ...DEFAULT_ALERT_SETTINGS, ...(row?.value ?? {}) };
}

export interface AlertCandidate {
  kind: AlertKind;
  severity: AlertSeverity;
  fingerprint: string;
  title: string;
  detail: string;
  context?: Record<string, unknown>;
  link?: string;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** n8n sender workflows whose most recent run failed (last 7 days). */
async function n8nFailures(): Promise<AlertCandidate[]> {
  const rows = await q<{
    workflow_id: string;
    name: string | null;
    failures: number;
    last_failed: Date;
    last_error: string | null;
    last_exec: string;
    last_success: Date | null;
  }>(
    `with f as (
       select e.workflow_id, count(*)::int as failures, max(e.started_at) as last_failed,
              (array_agg(e.error_message order by e.started_at desc) filter (where coalesce(e.error_message, '') <> ''))[1] as last_error,
              (array_agg(e.execution_id order by e.started_at desc))[1] as last_exec
         from n8n_executions e
        where e.status in ('error', 'crashed') and e.started_at > now() - interval '7 days'
        group by e.workflow_id)
     select f.*, w.name,
            (select max(s.started_at) from n8n_executions s where s.workflow_id = f.workflow_id and s.status = 'success') as last_success
       from f left join n8n_workflows w on w.id = f.workflow_id`,
  );
  return rows
    .filter((r) => !r.last_success || r.last_success < r.last_failed)
    .map((r) => ({
      kind: 'n8n_failed_run' as const,
      severity: 'critical' as const,
      fingerprint: `n8n_failed_run:${r.workflow_id}`,
      title: `n8n workflow failing: ${r.name ?? r.workflow_id}`,
      detail:
        `${plural(r.failures, 'failed run')} in the last 7 days, latest ${formatDateTime(r.last_failed)} (execution ${r.last_exec}). ` +
        (r.last_success ? `Last successful run ${formatDateTime(r.last_success)}.` : 'No successful run in the synced history.') +
        (r.last_error ? ` Error: ${r.last_error}` : ''),
      context: { workflowId: r.workflow_id, executionId: r.last_exec, failures: r.failures },
      link: '/integrations',
    }));
}

/** Mailboxes and integrations whose last sync failed (not "Not connected", which is a setup state). */
async function syncFailures(): Promise<AlertCandidate[]> {
  const out: AlertCandidate[] = [];
  const boxes = await q<{ address: string; last_error: string | null; last_success_at: Date | null }>(
    `select address, last_error, last_success_at from mailboxes where last_status = 'error' order by address`,
  );
  for (const b of boxes) {
    const stale = !b.last_success_at || b.last_success_at.getTime() < Date.now() - 6 * 3600_000;
    out.push({
      kind: 'sync_failed',
      severity: stale ? 'critical' : 'warning',
      fingerprint: `sync_failed:mailbox:${b.address}`,
      title: `Mailbox sync failing: ${b.address}`,
      detail: `${b.last_error ?? 'Unknown error'}. Last successful sync: ${b.last_success_at ? formatDateTime(b.last_success_at) : 'never'}. Replies and bounces for this mailbox are not being recorded.`,
      context: { mailbox: b.address },
      link: '/integrations',
    });
  }
  const sources = await q<{ key: string; name: string; kind: string; last_error: string | null; last_success_at: Date | null }>(
    `select key, name, kind, last_error, last_success_at from sources
      where last_status = 'error' and coalesce(last_error, '') not like 'Not connected%' order by key`,
  );
  const sheets = sources.filter((s) => s.kind === 'google_sheet' || s.kind === 'n8n_data_table');
  if (sheets.length) {
    out.push({
      kind: 'sync_failed',
      severity: 'warning',
      fingerprint: 'sync_failed:sheets',
      title: `Spreadsheet sync failing for ${plural(sheets.length, 'source')}`,
      detail: sheets.map((s) => `${s.name}: ${s.last_error ?? 'error'}`).join(' · '),
      context: { sources: sheets.map((s) => s.key) },
      link: '/spreadsheets',
    });
  }
  for (const s of sources.filter((x) => !sheets.includes(x))) {
    const stale = !s.last_success_at || s.last_success_at.getTime() < Date.now() - 6 * 3600_000;
    out.push({
      kind: 'sync_failed',
      severity: stale ? 'critical' : 'warning',
      fingerprint: `sync_failed:source:${s.key}`,
      title: `Sync failing: ${s.name}`,
      detail: `${s.last_error ?? 'Unknown error'}. Last successful sync: ${s.last_success_at ? formatDateTime(s.last_success_at) : 'never'}.`,
      context: { source: s.key },
      link: '/integrations',
    });
  }
  return out;
}

/** Follow-ups whose due date passed (beyond the grace period) and that were not sent. */
async function overdueFollowups(settings: AlertSettings): Promise<AlertCandidate[]> {
  const rows = await q<{ name: string; slug: string; n: number; oldest: string }>(
    `select c.name, c.slug, count(*)::int as n, min((l.next_followup_at at time zone $1)::date)::text as oldest
       from leads l join campaigns c on c.id = l.campaign_id
      where l.status = 'followup_due' and (l.next_followup_at at time zone $1)::date < $2::date - $3::int
      group by c.name, c.slug order by n desc`,
    [env.timezone, localDate(), Math.max(0, settings.overdueGraceDays)],
  );
  if (!rows.length) return [];
  const total = rows.reduce((n, r) => n + r.n, 0);
  const oldest = rows.map((r) => r.oldest).sort()[0];
  const daysLate = Math.round((Date.parse(localDate()) - Date.parse(oldest)) / 86_400_000);
  return [
    {
      kind: 'followups_overdue',
      severity: daysLate > 7 ? 'critical' : 'warning',
      fingerprint: 'followups_overdue',
      title: `${plural(total, 'follow-up')} overdue`,
      detail: `${rows.map((r) => `${r.name}: ${r.n}`).join(' · ')}. Oldest was due ${oldest} (${plural(daysLate, 'day')} ago). The dashboard does not send them; check the campaign's n8n workflow or sheet.`,
      context: { total, campaigns: rows.map((r) => ({ slug: r.slug, n: r.n })) },
      link: '/leads?followup=overdue',
    },
  ];
}

/** Per sending domain: bounces in the last 24 h compared with its sends and its own recent history. */
async function bounceSpikes(settings: AlertSettings): Promise<AlertCandidate[]> {
  const rows = await q<{ domain: string; recent: number; base: number; sends: number }>(
    `with b as (
       select mb.domain,
              count(*) filter (where vb.occurred_at > now() - interval '24 hours')::int as recent,
              count(*) filter (where vb.occurred_at <= now() - interval '24 hours')::int as base
         from v_bounces vb join mailboxes mb on mb.id = vb.mailbox_id
        where vb.occurred_at > now() - interval '15 days'
        group by mb.domain),
     s as (
       select coalesce(mb.domain, split_part(lower(v.sender), '@', 2)) as domain, count(*)::int as sends
         from v_sends v left join mailboxes mb on mb.id = v.mailbox_id
        where v.channel = 'email' and v.occurred_at > now() - interval '48 hours' and v.time_quality <> 'unknown'
        group by 1)
     select b.domain, b.recent, b.base, coalesce(s.sends, 0) as sends from b left join s on s.domain = b.domain where b.recent > 0`,
  );
  const out: AlertCandidate[] = [];
  for (const r of rows) {
    if (r.recent < settings.bounceMinCount) continue;
    const usual = r.base / 14;
    const rate = r.sends > 0 ? r.recent / r.sends : null;
    const byRate = rate !== null && rate * 100 >= settings.bounceRatePct;
    const byJump = r.recent >= settings.bounceSpikeMultiplier * Math.max(usual, 1);
    if (!byRate && !byJump) continue;
    out.push({
      kind: 'bounce_spike',
      severity: rate !== null && rate * 100 >= settings.bounceRatePct * 2 ? 'critical' : 'warning',
      fingerprint: `bounce_spike:${r.domain}`,
      title: `Bounce spike on ${r.domain}`,
      detail:
        `${plural(r.recent, 'bounce')} in the last 24 h` +
        (rate !== null ? ` against ${plural(r.sends, 'send')} in the last 48 h (${(rate * 100).toFixed(1)}%)` : ' with no recorded sends in the last 48 h') +
        `; usual ≈ ${usual.toFixed(1)} a day over the previous 14 days. Check list quality and the domain's sending reputation before the next batch.`,
      context: { domain: r.domain, recent: r.recent, sends: r.sends, usualPerDay: usual },
      link: '/sending',
    });
  }
  return out;
}

/** Mailboxes and domains at or over their configured daily limit today. */
async function volumeLimits(): Promise<AlertCandidate[]> {
  const { mailboxes, domains } = await dailyVolumes(1);
  const today = localDate();
  return [...domains, ...mailboxes]
    .filter((r) => r.key !== UNKNOWN_SENDER && (r.state === 'near' || r.state === 'over') && r.limit)
    .map((r) => ({
      kind: 'volume_limit' as const,
      severity: r.state === 'over' ? ('critical' as const) : ('warning' as const),
      fingerprint: `volume_limit:${r.scope}:${r.key}:${today}`,
      title: `${r.state === 'over' ? 'Over' : 'Near'} daily limit: ${r.key}`,
      detail: `${r.today.total} sent today (${r.today.outreach} outreach + ${r.today.other} other) of a ${r.limit!.dailyLimit}/day limit${
        r.state === 'near' ? ` (warning at ${r.limit!.warnPct}%)` : ''
      }. The dashboard does not pause sending; adjust the n8n workflow or the sheet queue if needed.`,
      context: { scope: r.scope, key: r.key, total: r.today.total, limit: r.limit!.dailyLimit },
      link: '/sending',
    }));
}

const RULES: { kind: AlertKind; run: (s: AlertSettings) => Promise<AlertCandidate[]> }[] = [
  { kind: 'n8n_failed_run', run: n8nFailures },
  { kind: 'sync_failed', run: syncFailures },
  { kind: 'followups_overdue', run: overdueFollowups },
  { kind: 'bounce_spike', run: bounceSpikes },
  { kind: 'volume_limit', run: volumeLimits },
];

/** Upserts the candidates and resolves open alerts that no longer apply. Returns the alerts opened. */
export async function applyAlerts(candidates: AlertCandidate[], evaluatedKinds: AlertKind[]): Promise<number[]> {
  const opened: number[] = [];
  for (const c of candidates) {
    const row = await one<{ id: number; inserted: boolean }>(
      `insert into alerts (kind, severity, fingerprint, title, detail, context, link)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (fingerprint) where resolved_at is null do update
         set severity = excluded.severity, title = excluded.title, detail = excluded.detail, context = excluded.context,
             link = excluded.link, last_seen_at = now(), checks = alerts.checks + 1,
             -- an alert that becomes critical is shown (and notified) again even if it was acknowledged
             acknowledged_at = case when alerts.severity = 'warning' and excluded.severity = 'critical' then null else alerts.acknowledged_at end,
             notified_at = case when alerts.severity = 'warning' and excluded.severity = 'critical' then null else alerts.notified_at end
       returning id, (xmax = 0) as inserted`,
      [c.kind, c.severity, c.fingerprint, c.title, c.detail, JSON.stringify(c.context ?? {}), c.link ?? null],
    );
    if (row?.inserted) opened.push(row.id);
  }
  if (evaluatedKinds.length) {
    await q(
      `update alerts set resolved_at = now()
        where resolved_at is null and kind = any($1::text[]) and not (fingerprint = any($2::text[]))`,
      [evaluatedKinds, candidates.map((c) => c.fingerprint)],
    );
  }
  return opened;
}

/** Sends alerts that were never notified to the optional n8n alerts webhook (same header key as the bridge). */
async function notifyN8n(): Promise<void> {
  if (!env.n8nBaseUrl || !env.bridgeKey) return;
  const pending = await q<{ id: number; kind: string; severity: string; title: string; detail: string; link: string | null; first_seen_at: Date }>(
    `select id, kind, severity, title, detail, link, first_seen_at from alerts
      where resolved_at is null and notified_at is null and acknowledged_at is null order by id limit 20`,
  );
  if (!pending.length) return;
  const url = `${env.n8nBaseUrl}/webhook/outreach-dashboard-alerts`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Outreach-Bridge-Key': env.bridgeKey },
      body: JSON.stringify({
        dashboardUrl: env.publicUrl,
        alerts: pending.map((a) => ({ ...a, url: a.link ? `${env.publicUrl}${a.link}` : `${env.publicUrl}/alerts` })),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await q(`update alerts set notified_at = now() where id = any($1::bigint[])`, [pending.map((a) => a.id)]);
    await resolveIntegrationErrors('alerts:notify');
  } catch (err) {
    await recordIntegrationError('alerts:notify', `Could not send alerts to the n8n alerts webhook: ${(err as Error).message}`, {}, 'warning');
  }
}

export async function evaluateAlerts(): Promise<{ open: number; opened: number }> {
  const settings = await alertSettings();
  const candidates: AlertCandidate[] = [];
  const evaluated: AlertKind[] = [];
  for (const rule of RULES) {
    try {
      candidates.push(...(await rule.run(settings)));
      evaluated.push(rule.kind);
      await resolveIntegrationErrors(`alerts:${rule.kind}`);
    } catch (err) {
      // Keep this rule's open alerts as they are rather than resolving them on a failed check.
      await recordIntegrationError(`alerts:${rule.kind}`, `Alert check "${rule.kind}" failed: ${(err as Error).message}`);
    }
  }
  const opened = await applyAlerts(candidates, evaluated);
  if (settings.notifyN8n) await notifyN8n();
  const open = (await one<{ n: number }>(`select count(*)::int as n from alerts where resolved_at is null`))?.n ?? 0;
  return { open, opened: opened.length };
}

export interface AlertRow {
  id: number;
  kind: AlertKind;
  severity: AlertSeverity;
  title: string;
  detail: string | null;
  link: string | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  acknowledgedAt: Date | null;
  acknowledgedBy: string | null;
  resolvedAt: Date | null;
  notifiedAt: Date | null;
}

const ALERT_COLS = `id, kind, severity, title, detail, link, first_seen_at as "firstSeenAt", last_seen_at as "lastSeenAt",
  acknowledged_at as "acknowledgedAt", acknowledged_by as "acknowledgedBy", resolved_at as "resolvedAt", notified_at as "notifiedAt"`;

export async function openAlerts(): Promise<AlertRow[]> {
  return q<AlertRow>(
    `select ${ALERT_COLS} from alerts where resolved_at is null
      order by (acknowledged_at is null) desc, (severity = 'critical') desc, first_seen_at desc`,
  );
}

export async function resolvedAlerts(days = 30): Promise<AlertRow[]> {
  return q<AlertRow>(`select ${ALERT_COLS} from alerts where resolved_at > now() - make_interval(days => $1) order by resolved_at desc limit 100`, [days]);
}

/** Open alerts not yet acknowledged, by severity (sidebar badge and overview banner). */
export async function alertCounts(): Promise<{ critical: number; warning: number }> {
  const r = await one<{ critical: number; warning: number }>(
    `select count(*) filter (where severity = 'critical')::int as critical, count(*) filter (where severity = 'warning')::int as warning
       from alerts where resolved_at is null and acknowledged_at is null`,
  );
  return r ?? { critical: 0, warning: 0 };
}
