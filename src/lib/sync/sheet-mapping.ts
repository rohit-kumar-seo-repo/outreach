// Maps rows from a registered spreadsheet / data table onto leads, and derives the send
// history the sheet itself records (e.g. "Sent 2026-09-22T…", "FU2 Sent", TouchNumber).
// Pure functions: unit-tested in tests/sheet-mapping.test.ts.
import { digitsOnly, isValidEmail, normalizeEmail, normalizeMessageId, toWaChatId } from '../normalize';
import { campaignForRow, type SheetState, type SourceDef } from '../registry';
import { dateOnlyToNoonLocal, parseSheetTimestamp } from '../time';
import type { SendAttemptInput } from './record';

type Row = Record<string, unknown>;

export interface LeadRecord {
  campaignSlug: string;
  rowKey: string;
  rowKeyStable: boolean;
  rowNumber: number | null;
  duplicateInSource: boolean;
  name: string | null;
  email: string | null;
  emailNorm: string | null;
  emailValid: boolean | null;
  phone: string | null;
  phoneNorm: string | null;
  waChatId: string | null;
  website: string | null;
  city: string | null;
  country: string | null;
  category: string | null;
  sheetStatus: string;
  sheetState: SheetState;
  scheduledSendAt: Date | null;
  scheduledDate: string | null;
  plannedSender: string | null;
  touchNumber: number | null;
  maxTouches: number | null;
  sourceNextTouchAt: Date | null;
  raw: Row;
  history: SendAttemptInput[];
}

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());

function first(row: Row, cols: string[] | undefined): string | null {
  for (const c of cols ?? []) {
    const v = str(row[c]);
    if (v) return v;
  }
  return null;
}

function intOrNull(v: unknown): number | null {
  const n = Number.parseInt(str(v), 10);
  return Number.isFinite(n) ? n : null;
}

export function sheetStateFor(src: SourceDef, status: string): SheetState {
  if (!status) return src.blankStatus;
  for (const rule of src.statusRules) {
    if (new RegExp(rule.match, 'i').test(status)) return rule.state;
  }
  return 'unknown';
}

function isoDate(v: unknown): string | null {
  const s = str(v);
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
}

function cleanRaw(src: SourceDef, row: Row): Row {
  const omit = new Set([...(src.omitColumns ?? []), 'row_number']);
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    if (omit.has(k)) continue;
    out[k] = typeof v === 'string' && v.length > 500 ? `${v.slice(0, 500)}…` : v;
  }
  return out;
}

export function rowKeyFor(src: SourceDef, row: Row): { key: string; stable: boolean } {
  const [primary, ...fallbacks] = src.rowKey;
  const pv = str(row[primary]);
  if (pv) {
    if (src.rowKeyNormalize === 'email') return { key: normalizeEmail(pv) ?? pv.toLowerCase(), stable: true };
    if (src.rowKeyNormalize === 'phone') return { key: digitsOnly(pv) || pv, stable: true };
    return { key: pv, stable: true };
  }
  for (const col of fallbacks) {
    const v = str(row[col]);
    if (v) return { key: `${col}:${v.toLowerCase()}`, stable: true };
  }
  return { key: `row:${str(row.row_number) || str(row.id) || 'unknown'}`, stable: false };
}

/** Sends recorded by the sheet itself. Times are only as precise as the sheet (often unknown). */
function historyFor(src: SourceDef, lead: Omit<LeadRecord, 'history'>, row: Row): SendAttemptInput[] {
  const out: SendAttemptInput[] = [];
  const recipient = src.channel === 'whatsapp' ? lead.waChatId : lead.emailNorm;
  if (!recipient) return out;
  const base = (step: number, result: 'accepted' | 'failed', at: Date | null, quality: SendAttemptInput['timeQuality'], extra: Partial<SendAttemptInput> = {}): SendAttemptInput => ({
    idempotencyKey: `sheet:${src.key}:${lead.rowKey}:${step}:${result}`,
    channel: src.channel,
    campaignSlug: lead.campaignSlug,
    sourceKey: src.key,
    leadRowKey: lead.rowKey,
    sender: lead.plannedSender,
    recipient,
    step,
    result,
    provider: src.channel === 'whatsapp' ? 'waha' : null,
    providerStatus: `Recorded in sheet as "${lead.sheetStatus}"`,
    source: 'sheet_status',
    occurredAt: at,
    timeQuality: at ? quality : 'unknown',
    subject: str(row[src.columns.subject ?? '']) || null,
    ...extra,
  });
  const state = lead.sheetState;
  const status = lead.sheetStatus;

  switch (src.history) {
    case 'status_sent_iso': {
      // "Sent 2026-09-22T…"; bounce/reply notes keep the original "… - Sent <time>" text.
      const sentPart = status.match(/\bsent\b\s*(.*)$/i);
      if (state === 'sent' || ((state === 'bounced' || state === 'replied') && sentPart)) {
        const t = parseSheetTimestamp(sentPart ? sentPart[1] : '');
        out.push(base(0, 'accepted', t.at, t.quality));
      } else if (state === 'failed') {
        out.push(base(0, 'failed', null, 'unknown', { errorMessage: status }));
      }
      break;
    }
    case 'touch_sequence': {
      const touch = lead.touchNumber ?? 1;
      let sent = 0;
      if (state === 'completed' || state === 'sent' || state === 'replied') sent = touch;
      else if (state === 'queued' || state === 'excluded') sent = Math.max(0, touch - 1);
      const last = parseSheetTimestamp(row[src.columns.lastSentAt ?? '']);
      for (let i = 0; i < sent; i++) {
        const isLast = i === sent - 1;
        out.push(base(i, 'accepted', isLast ? last.at : null, isLast ? last.quality : 'unknown'));
      }
      break;
    }
    case 'status_sent_date': {
      const date = isoDate(row[src.columns.lastSentDate ?? '']) ?? lead.scheduledDate;
      const notes = str(row[src.columns.notes ?? '']);
      const msg = notes.match(/msg\s+(<[^>]+>)/i);
      const via = notes.match(/sent via\s+([^\s,]+@[^\s,]+)/i);
      if (state === 'sent' || state === 'replied') {
        out.push(
          base(0, 'accepted', date ? dateOnlyToNoonLocal(date) : null, 'date_only', {
            messageId: msg ? normalizeMessageId(msg[1]) : null,
            sender: via ? via[1].toLowerCase() : lead.plannedSender,
            provider: msg ? 'smtp' : null,
          }),
        );
      } else if (state === 'failed') {
        out.push(base(0, 'failed', null, 'unknown', { errorMessage: status }));
      }
      break;
    }
    case 'fu_status': {
      const m = status.match(/^fu\s*(\d)\s*sent/i);
      const lastStep = /^email sent/i.test(status) ? 0 : m ? Number(m[1]) : state === 'replied' ? 0 : -1;
      const date = isoDate(row[src.columns.lastSentDate ?? '']) ?? isoDate(row[src.columns.lastSentDateFallback ?? '']);
      for (let i = 0; i <= lastStep; i++) {
        const isLast = i === lastStep && state !== 'replied';
        out.push(base(i, 'accepted', isLast && date ? dateOnlyToNoonLocal(date) : null, isLast && date ? 'date_only' : 'unknown'));
      }
      if (state === 'failed') out.push(base(0, 'failed', null, 'unknown', { errorMessage: status }));
      break;
    }
    case 'stage_counter': {
      const stage = intOrNull(row[src.columns.stage ?? '']) ?? 0;
      for (let i = 1; i <= stage; i++) out.push(base(i, 'accepted', null, 'unknown'));
      break;
    }
    case 'wa_status': {
      if (state === 'sent' || state === 'replied') out.push(base(0, 'accepted', null, 'unknown'));
      else if (state === 'failed') out.push(base(0, 'failed', null, 'unknown', { errorMessage: status }));
      break;
    }
  }
  return out;
}

/** Splits a follow-up row's key ("seo-acme-fu2") into its lead key and step, per the source's touchRows rule. */
export function touchRowOf(src: Pick<SourceDef, 'touchRows'>, value: unknown): { base: string; step: number } | null {
  if (!src.touchRows) return null;
  const m = str(value).match(new RegExp(src.touchRows.pattern, 'i'));
  if (!m) return null;
  const step = Number(m[2]);
  return m[1] && Number.isFinite(step) && step > 0 ? { base: m[1], step } : null;
}

export function mapRows(src: SourceDef, rows: Row[]): LeadRecord[] {
  const seenKeys = new Map<string, number>();
  const out: LeadRecord[] = [];
  // Sources that store each follow-up as its own row (LeadID "…-fu1") fold those rows into the lead.
  const touches: { base: string; step: number; row: Row }[] = [];
  const byBase = new Map<string, LeadRecord>();
  for (const row of rows) {
    const t = src.touchRows ? touchRowOf(src, row[src.touchRows.column]) : null;
    if (t) {
      touches.push({ ...t, row });
      continue;
    }
    const { key, stable } = rowKeyFor(src, row);
    const rowNumber = intOrNull(row.row_number) ?? intOrNull(row.id);
    let rowKey = key;
    let duplicateInSource = false;
    if (seenKeys.has(key)) {
      // Same key twice in one sheet: keep both rows but mark the later one as a duplicate.
      duplicateInSource = true;
      rowKey = `${key}#row${rowNumber ?? seenKeys.get(key)! + 1}`;
      seenKeys.set(key, seenKeys.get(key)! + 1);
    } else {
      seenKeys.set(key, 1);
    }
    const lead = mapRow(src, row, rowKey, stable, duplicateInSource);
    out.push(lead);
    if (src.touchRows && !duplicateInSource) byBase.set(str(row[src.touchRows.column]), lead);
  }

  touches.sort((a, b) => a.step - b.step);
  for (const t of touches) {
    const col = src.touchRows!.column;
    let lead = byBase.get(t.base);
    if (!lead) {
      // Follow-up rows whose original row is missing still describe one lead.
      const { key, stable } = rowKeyFor(src, { ...t.row, [col]: t.base });
      lead = { ...mapRow(src, { ...t.row, [col]: t.base }, key, stable, false), history: [] };
      out.push(lead);
      byBase.set(t.base, lead);
    }
    const touch = mapRow(src, t.row, lead.rowKey, true, false);
    for (const h of touch.history) {
      lead.history.push({
        ...h,
        step: t.step,
        idempotencyKey: `sheet:${src.key}:${lead.rowKey}:${t.step}:${h.result}`,
        leadRowKey: lead.rowKey,
        campaignSlug: lead.campaignSlug,
      });
    }
    if (touch.sheetState === 'queued' && touch.scheduledSendAt) {
      if (!lead.sourceNextTouchAt || touch.scheduledSendAt < lead.sourceNextTouchAt) lead.sourceNextTouchAt = touch.scheduledSendAt;
    }
    if (touch.sheetState === 'replied' || (touch.sheetState === 'bounced' && lead.sheetState !== 'replied')) {
      lead.sheetState = touch.sheetState;
      lead.sheetStatus = touch.sheetStatus;
    }
  }
  return out;
}

function mapRow(src: SourceDef, row: Row, rowKey: string, stable: boolean, duplicateInSource: boolean): LeadRecord {
  const c = src.columns;
  const rowNumber = intOrNull(row.row_number) ?? intOrNull(row.id);
  {
    const sheetStatus = str(row[c.status]);
    let sheetState = sheetStateFor(src, sheetStatus);
    const emailRaw = first(row, c.email);
    const emailNorm = normalizeEmail(emailRaw);
    const phone = first(row, c.phone);
    const phoneNorm = phone ? digitsOnly(phone) || null : null;
    const waChatId = src.channel === 'whatsapp' && phone ? toWaChatId(phone, src.phoneRule ?? 'any') : null;
    const scheduled = c.scheduledAt ? parseSheetTimestamp(row[c.scheduledAt]) : { at: null, quality: 'unknown' as const };
    const scheduledDate = c.scheduledDate ? isoDate(row[c.scheduledDate]) : null;
    const touchNumber = c.touchNumber ? intOrNull(row[c.touchNumber]) : null;
    const draft = c.draft ? str(row[c.draft]) : 'n/a';

    if (src.requireDraft && sheetState === 'ready' && !draft) sheetState = 'new';
    // Approved rows without a send time are skipped by the dispatchers, so they are not queued.
    if (sheetState === 'queued' && (c.scheduledAt || c.scheduledDate) && !scheduled.at && !scheduledDate) sheetState = 'ready';
    if (c.stopFlag && /^y(es)?$/i.test(str(row[c.stopFlag])) && sheetState === 'queued') sheetState = 'completed';

    let sourceNextTouchAt: Date | null = null;
    if (src.history === 'touch_sequence' && sheetState === 'queued' && (touchNumber ?? 1) > 1) sourceNextTouchAt = scheduled.at;
    if (c.nextTouchDate && sheetState === 'sent') {
      const d = isoDate(row[c.nextTouchDate]);
      if (d) sourceNextTouchAt = dateOnlyToNoonLocal(d);
    }

    const lead: Omit<LeadRecord, 'history'> = {
      campaignSlug: campaignForRow(src, row),
      rowKey,
      rowKeyStable: stable,
      rowNumber,
      duplicateInSource,
      name: first(row, c.name),
      email: emailRaw,
      emailNorm,
      emailValid: src.channel === 'email' ? isValidEmail(emailNorm) : emailNorm ? isValidEmail(emailNorm) : null,
      phone,
      phoneNorm,
      waChatId,
      website: first(row, c.website),
      city: first(row, c.city),
      country: first(row, c.country),
      category: first(row, c.category),
      sheetStatus,
      sheetState,
      scheduledSendAt: scheduled.at,
      scheduledDate,
      plannedSender: c.sender ? str(row[c.sender]).toLowerCase() || null : null,
      touchNumber,
      maxTouches: c.maxTouches ? intOrNull(row[c.maxTouches]) : null,
      sourceNextTouchAt,
      raw: cleanRaw(src, row),
    };
    return { ...lead, history: historyFor(src, lead, row) };
  }
}
