import { env } from '../env';
import { one, q, tx } from '../db';
import { recordIntegrationError, resolveIntegrationErrors } from '../errors';
import { registry, type SourceDef } from '../registry';
import { fetchJson } from './http';
import { campaignId, recordSendAttempt } from './record';
import { finishRun, markSource, startRun } from './runs';
import { mapRows, type LeadRecord } from './sheet-mapping';

export interface BridgeResponse {
  ok: boolean;
  source: string;
  kind?: string;
  title?: string;
  url?: string;
  fetchedAt?: string;
  rows: Record<string, unknown>[];
  error?: string;
}

export function bridgeConfigured(): boolean {
  return !!env.bridgeUrl && !!env.bridgeKey;
}

export async function fetchSource(key: string): Promise<BridgeResponse> {
  const res = await fetchJson<BridgeResponse | BridgeResponse[]>(env.bridgeUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Outreach-Bridge-Key': env.bridgeKey },
    body: JSON.stringify({ source: key }),
    timeoutMs: 90_000,
  });
  const body = Array.isArray(res) ? res[0] : res;
  if (!body || body.ok !== true || !Array.isArray(body.rows)) {
    throw new Error(`Bridge returned an error for ${key}: ${body?.error ?? 'unexpected response shape'}`);
  }
  return body;
}

async function upsertLead(sourceId: number, lead: LeadRecord, client: Parameters<typeof q>[2]): Promise<void> {
  const cid = await campaignId(lead.campaignSlug, client);
  if (!cid) throw new Error(`unknown campaign ${lead.campaignSlug}`);
  await q(
    `insert into leads (campaign_id, source_id, source_row_key, source_row_number, row_key_stable, name, email, email_norm, email_valid,
        phone, phone_norm, wa_chat_id, website, city, country, category, sheet_status, sheet_state, scheduled_send_at, scheduled_date,
        planned_sender, touch_number, max_touches, source_next_touch_at, raw, present_in_source, is_duplicate, updated_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,true,$26,now())
     on conflict (source_id, source_row_key) do update set
        campaign_id = excluded.campaign_id, source_row_number = excluded.source_row_number, row_key_stable = excluded.row_key_stable,
        name = excluded.name, email = excluded.email, email_norm = excluded.email_norm, email_valid = excluded.email_valid,
        phone = excluded.phone, phone_norm = excluded.phone_norm, wa_chat_id = excluded.wa_chat_id, website = excluded.website,
        city = excluded.city, country = excluded.country, category = excluded.category, sheet_status = excluded.sheet_status,
        sheet_state = excluded.sheet_state, scheduled_send_at = excluded.scheduled_send_at, scheduled_date = excluded.scheduled_date,
        planned_sender = excluded.planned_sender, touch_number = excluded.touch_number, max_touches = excluded.max_touches,
        source_next_touch_at = excluded.source_next_touch_at, raw = excluded.raw, present_in_source = true,
        is_duplicate = leads.is_duplicate or excluded.is_duplicate, updated_at = now()`,
    [
      cid,
      sourceId,
      lead.rowKey,
      lead.rowNumber,
      lead.rowKeyStable,
      lead.name,
      lead.email,
      lead.emailNorm,
      lead.emailValid,
      lead.phone,
      lead.phoneNorm,
      lead.waChatId,
      lead.website,
      lead.city,
      lead.country,
      lead.category,
      lead.sheetStatus,
      lead.sheetState,
      lead.scheduledSendAt,
      lead.scheduledDate,
      lead.plannedSender,
      lead.touchNumber,
      lead.maxTouches,
      lead.sourceNextTouchAt,
      JSON.stringify(lead.raw),
      lead.duplicateInSource,
    ],
    client,
  );
}

export async function syncOneSource(src: SourceDef): Promise<{ rows: number; history: number }> {
  const res = await fetchSource(src.key);
  const leads = mapRows(src, res.rows);
  const columns = Array.from(new Set(res.rows.flatMap((r) => Object.keys(r)))).filter((k) => k !== 'row_number');
  const source = await one<{ id: number; row_count: number | null }>('select id, row_count from sources where key = $1', [src.key]);
  if (!source) throw new Error(`source ${src.key} missing from DB (registry not synced?)`);

  // Guard against a transient empty read wiping the lead list.
  if (res.rows.length === 0 && (source.row_count ?? 0) > 10) {
    throw new Error(`Bridge returned 0 rows for ${src.key} but ${source.row_count} were present last time; keeping existing data`);
  }
  const missingCols = [src.columns.status, ...(src.columns.email ?? []).slice(0, 1)].filter((col) => res.rows.length > 0 && !columns.includes(col));
  if (missingCols.length) {
    await recordIntegrationError(`sheet:${src.key}:columns`, `${src.name}: expected column(s) not found: ${missingCols.join(', ')}`, { columns }, 'warning');
  } else {
    await resolveIntegrationErrors(`sheet:${src.key}:columns`);
  }
  // Workflow-specific check: the RKD Follow-up Engine reads "Date Sent".
  if (src.history === 'fu_status' && res.rows.length > 0 && !columns.includes('Date Sent')) {
    await recordIntegrationError(
      `sheet:${src.key}:date-sent`,
      `${src.name}: column "Date Sent" does not exist, but the RKD Follow-up Engine only sends a follow-up when "Date Sent" has a value. Follow-ups for this sheet cannot fire until the column exists.`,
      { columns },
      'warning',
    );
  }

  let history = 0;
  await tx(async (c) => {
    for (const lead of leads) {
      await upsertLead(source.id, lead, c);
      for (const h of lead.history) {
        await recordSendAttempt(h, c);
        history++;
      }
    }
    if (res.rows.length > 0) {
      await q(
        `update leads set present_in_source = false, updated_at = now()
          where source_id = $1 and present_in_source and not (source_row_key = any($2))`,
        [source.id, leads.map((l) => l.rowKey)],
        c,
      );
    }
    await q('update sources set external_url = coalesce($2, external_url) where id = $1', [source.id, res.url ?? null], c);
  });
  await markSource(src.key, true, null, { rowCount: res.rows.length, columns });
  return { rows: res.rows.length, history };
}

export async function syncSheets(): Promise<void> {
  const runId = await startRun('sheets', 'n8n:bridge');
  if (!bridgeConfigured()) {
    await finishRun(runId, 'skipped', {}, 'N8N_BRIDGE_URL / N8N_BRIDGE_KEY not configured');
    await markSource('n8n:bridge', false, 'Not connected: set N8N_BRIDGE_URL and N8N_BRIDGE_KEY on the server.');
    for (const src of registry().sources) await markSource(src.key, false, 'Not connected: the n8n Data Bridge is not configured.');
    return;
  }
  let rows = 0;
  let written = 0;
  const failures: string[] = [];
  for (const src of registry().sources) {
    try {
      const r = await syncOneSource(src);
      rows += r.rows;
      written += r.history;
      await resolveIntegrationErrors(`sheet:${src.key}`);
    } catch (err) {
      const msg = (err as Error).message;
      failures.push(`${src.key}: ${msg}`);
      await markSource(src.key, false, msg);
      await recordIntegrationError(`sheet:${src.key}`, `${src.name}: ${msg}`);
    }
  }
  const all = registry().sources.length;
  const status = failures.length === 0 ? 'success' : failures.length < all ? 'partial' : 'error';
  await finishRun(runId, status, { seen: rows, written }, failures.join(' | ') || null);
  await markSource('n8n:bridge', status !== 'error', failures.length ? `${failures.length}/${all} sources failed` : null);
}
