'use server';

// Write side of the lead workspace. Every change is one small transaction plus an audit entry;
// none of this sends anything to a lead.
import { revalidatePath } from 'next/cache';
import { assertSameOrigin, requireSession } from '@/lib/auth/session';
import { one, q, tx } from '@/lib/db';
import { env } from '@/lib/env';
import { addDays, localDate } from '@/lib/time';
import { STAGE_OUTCOME, STAGE_SQL, type CallOutcome, type ReminderPick, type Stage, isCallOutcome, isStage } from '@/lib/crm/stages';

export type ActionResult = { ok: true } | { ok: false; error: string };

async function guard(): Promise<string> {
  await assertSameOrigin();
  return (await requireSession()).email;
}

function leadIdOk(id: unknown): id is number {
  return typeof id === 'number' && Number.isInteger(id) && id > 0;
}

function refresh(leadId: number) {
  revalidatePath(`/leads/${leadId}`);
  revalidatePath('/leads');
  revalidatePath('/call');
  revalidatePath('/');
}

/** A reminder choice → { at } (exact instant) or { local } ("YYYY-MM-DD HH:MM" in the app timezone). */
export type ReminderInput = ReminderPick | `date:${string}` | 'clear' | 'keep';

function reminderTarget(pick: ReminderInput): { at: Date | null; local: string | null } | 'clear' | 'keep' | null {
  if (pick === 'keep') return 'keep';
  if (pick === 'clear') return 'clear';
  const today = localDate();
  if (pick === 'later') return { at: new Date(Date.now() + 3 * 3600_000), local: null };
  if (pick === 'tomorrow') return { at: null, local: `${addDays(today, 1)} 10:00` };
  if (pick === 'in3') return { at: null, local: `${addDays(today, 3)} 10:00` };
  if (pick === 'week') return { at: null, local: `${addDays(today, 7)} 10:00` };
  const m = /^date:(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?$/.exec(pick);
  if (m && m[1] >= today && m[1] <= addDays(today, 730)) return { at: null, local: `${m[1]} ${m[2] ?? '10:00'}` };
  return null;
}

type Client = Parameters<typeof q>[2];

async function applyReminder(leadId: number, pick: ReminderInput, actor: string, client: Client): Promise<void> {
  const t = reminderTarget(pick);
  if (t === null || t === 'keep') return;
  if (t === 'clear') {
    const had = await one<{ id: number }>(`update leads set manual_followup_at = null where id = $1 and manual_followup_at is not null returning id`, [leadId], client);
    if (had) await q(`insert into lead_activities (lead_id, kind, outcome, created_by) values ($1, 'reminder', 'cleared', $2)`, [leadId, actor], client);
    return;
  }
  const row = await one<{ at: Date }>(
    `update leads set manual_followup_at = coalesce($2::timestamptz, ($3::timestamp at time zone $4)) where id = $1 returning manual_followup_at as at`,
    [leadId, t.at, t.local, env.timezone],
    client,
  );
  if (row) await q(`insert into lead_activities (lead_id, kind, outcome, body, created_by) values ($1, 'reminder', 'set', $2, $3)`, [leadId, row.at.toISOString(), actor], client);
}

async function applyStage(leadId: number, stage: Stage, actor: string, client: Client): Promise<boolean> {
  const cur = await one<{ st: string | null; campaign_id: number }>(`select ${STAGE_SQL} as st, l.campaign_id from leads l where l.id = $1`, [leadId], client);
  if (!cur) return false;
  await q(
    `update leads set stage = $2, stage_source = 'manual', stage_changed_at = now(), last_activity_at = now(),
            manual_followup_at = case when $2 in ('won', 'lost') then null else manual_followup_at end
      where id = $1`,
    [leadId, stage],
    client,
  );
  if (cur.st === stage) return true;
  await q(`insert into lead_activities (lead_id, kind, outcome, body, created_by) values ($1, 'stage', $2, $3, $4)`, [leadId, stage, cur.st, actor], client);
  // Keep campaign results (which count lead_outcomes) in step with the pipeline.
  const outcome = STAGE_OUTCOME[stage];
  if (outcome) {
    await q(
      `insert into lead_outcomes (lead_id, campaign_id, outcome, occurred_on, note, recorded_by) values ($1, $2, $3, $4::date, 'Pipeline stage change', $5)`,
      [leadId, cur.campaign_id, outcome, localDate(), actor],
      client,
    );
    await q(`update leads set outcome = $2, outcome_on = $3::date where id = $1`, [leadId, outcome, localDate()], client);
  }
  return true;
}

async function audit(actor: string, action: string, leadId: number, detail: Record<string, unknown>, client?: Client) {
  await q('insert into audit_log (actor, action, target, detail) values ($1,$2,$3,$4)', [actor, action, `lead:${leadId}`, JSON.stringify(detail)], client);
}

export async function setStage(leadId: number, stage: string): Promise<ActionResult> {
  const actor = await guard();
  if (!leadIdOk(leadId) || !isStage(stage)) return { ok: false, error: 'Invalid stage' };
  const ok = await tx(async (c) => {
    const done = await applyStage(leadId, stage, actor, c);
    if (done) await audit(actor, 'set_stage', leadId, { stage }, c);
    return done;
  });
  if (!ok) return { ok: false, error: 'Lead not found' };
  refresh(leadId);
  return { ok: true };
}

export async function logCall(input: {
  leadId: number;
  outcome: string;
  note?: string;
  reminder?: ReminderInput;
  stage?: string | null;
}): Promise<ActionResult> {
  const actor = await guard();
  const { leadId } = input;
  if (!leadIdOk(leadId) || !isCallOutcome(input.outcome)) return { ok: false, error: 'Invalid call outcome' };
  const outcome: CallOutcome = input.outcome;
  const note = (input.note ?? '').trim().slice(0, 4000) || null;
  const stage = input.stage && isStage(input.stage) ? input.stage : null;
  const ok = await tx(async (c) => {
    const cur = await one<{ st: string | null }>(`select ${STAGE_SQL} as st from leads l where l.id = $1`, [leadId], c);
    if (!cur) return false;
    await q(`insert into lead_activities (lead_id, kind, outcome, body, created_by) values ($1, 'call', $2, $3, $4)`, [leadId, outcome, note, actor], c);
    await q(
      `update leads set last_call_at = now(), last_call_outcome = $2, call_count = call_count + 1, last_activity_at = now() where id = $1`,
      [leadId, outcome],
      c,
    );
    // A call puts a lead in the pipeline: unstaged or "new" leads become "contacted" once you spoke.
    const next: Stage | null = stage ?? (outcome === 'connected' && (cur.st === null || cur.st === 'new') ? 'contacted' : null);
    if (next) await applyStage(leadId, next, actor, c);
    // Calls that did not connect get an automatic retry reminder unless one was chosen.
    const reminder: ReminderInput = input.reminder ?? (outcome === 'no_answer' ? 'tomorrow' : outcome === 'busy' ? 'later' : 'keep');
    if (reminder === 'keep') {
      // The call is what a due reminder asked for, so it is done; a future reminder stays.
      const cleared = await one<{ id: number }>(`update leads set manual_followup_at = null where id = $1 and manual_followup_at <= now() returning id`, [leadId], c);
      if (cleared) await q(`insert into lead_activities (lead_id, kind, outcome, body, created_by) values ($1, 'reminder', 'cleared', 'Done by call', $2)`, [leadId, actor], c);
    } else if (!(next === 'won' || next === 'lost')) {
      await applyReminder(leadId, reminder, actor, c);
    }
    await audit(actor, 'log_call', leadId, { outcome, stage: next, reminder }, c);
    return true;
  });
  if (!ok) return { ok: false, error: 'Lead not found' };
  refresh(leadId);
  return { ok: true };
}

export async function setReminder(leadId: number, pick: string): Promise<ActionResult> {
  const actor = await guard();
  if (!leadIdOk(leadId)) return { ok: false, error: 'Invalid lead' };
  if (reminderTarget(pick as ReminderInput) === null) return { ok: false, error: 'Pick a date from today onwards' };
  await tx(async (c) => {
    await applyReminder(leadId, pick as ReminderInput, actor, c);
    await q(`update leads set last_activity_at = now() where id = $1`, [leadId], c);
    await audit(actor, 'set_reminder', leadId, { pick }, c);
  });
  refresh(leadId);
  return { ok: true };
}

export async function addNote(leadId: number, body: string): Promise<ActionResult> {
  const actor = await guard();
  const text = String(body ?? '').trim().slice(0, 4000);
  if (!leadIdOk(leadId) || !text) return { ok: false, error: 'Write something first' };
  await tx(async (c) => {
    await q(`insert into lead_activities (lead_id, kind, body, created_by) values ($1, 'note', $2, $3)`, [leadId, text, actor], c);
    await q(`update leads set last_activity_at = now() where id = $1`, [leadId], c);
    await audit(actor, 'add_note', leadId, {}, c);
  });
  refresh(leadId);
  return { ok: true };
}

export async function deleteActivity(activityId: number): Promise<ActionResult> {
  const actor = await guard();
  if (!leadIdOk(activityId)) return { ok: false, error: 'Invalid entry' };
  const row = await one<{ lead_id: number; kind: string; body: string | null }>(
    `delete from lead_activities where id = $1 and kind in ('note', 'call') returning lead_id, kind, body`,
    [activityId],
  );
  if (!row) return { ok: false, error: 'Only notes and calls can be removed' };
  await audit(actor, 'delete_activity', row.lead_id, { kind: row.kind, body: row.body });
  refresh(row.lead_id);
  return { ok: true };
}

export async function toggleStar(leadId: number): Promise<ActionResult> {
  const actor = await guard();
  if (!leadIdOk(leadId)) return { ok: false, error: 'Invalid lead' };
  const row = await one<{ starred: boolean }>(`update leads set starred = not starred where id = $1 returning starred`, [leadId]);
  if (!row) return { ok: false, error: 'Lead not found' };
  await audit(actor, row.starred ? 'star' : 'unstar', leadId, {});
  refresh(leadId);
  return { ok: true };
}

const CURRENCIES = new Set(['INR', 'USD', 'AED', 'GBP', 'EUR', 'CAD', 'AUD']);

export async function setDeal(leadId: number, value: string, currency: string): Promise<ActionResult> {
  const actor = await guard();
  if (!leadIdOk(leadId)) return { ok: false, error: 'Invalid lead' };
  const cleaned = String(value ?? '').replace(/[,\s]/g, '');
  const num = cleaned === '' ? null : Number(cleaned);
  if (num !== null && (!Number.isFinite(num) || num < 0 || num > 1e12)) return { ok: false, error: 'Enter a number' };
  const cur = CURRENCIES.has(currency) ? currency : 'INR';
  await q(`update leads set deal_value = $2, deal_currency = case when $2::numeric is null then null else $3 end, last_activity_at = now() where id = $1`, [
    leadId,
    num,
    cur,
  ]);
  await audit(actor, 'set_deal', leadId, { value: num, currency: cur });
  refresh(leadId);
  return { ok: true };
}
