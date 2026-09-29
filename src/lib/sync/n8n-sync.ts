import { one, q, tx } from '../db';
import { recordIntegrationError, redact, resolveIntegrationErrors } from '../errors';
import { registry } from '../registry';
import { listExecutions, listWorkflows, n8nConfigured } from './n8n-client';
import { extractFromExecution, senderNodesIn, type N8nExecution, type RunData } from './n8n-extract';
import { recordSendAttempt } from './record';
import { finishRun, markSource, startRun } from './runs';
import { recordWaMessage } from './wa-store';

const FINAL = new Set(['success', 'error', 'crashed', 'canceled']);
// Stop paging back once this many already-final executions are seen in a row.
const KNOWN_STREAK_STOP = 5;
const MAX_PAGES = 60;

async function executionIsKnownFinal(id: string): Promise<boolean> {
  // Failed runs stored before error messages were captured are fetched once more to record why they failed.
  const row = await one<{ final: boolean }>(
    `select final and not (status in ('error', 'crashed') and error_message is null) as final from n8n_executions where execution_id = $1`,
    [id],
  );
  return !!row?.final;
}

/** The error n8n reports for a failed run: the workflow-level error, else the first failing node's. */
export function executionError(exec: N8nExecution): string | null {
  const top = exec.data?.resultData?.error?.message;
  if (top) return redact(String(top)).slice(0, 500);
  for (const [node, runs] of Object.entries(exec.data?.resultData?.runData ?? {})) {
    for (const run of runs ?? []) {
      const msg = (run as { error?: { message?: string } }).error?.message;
      if (msg) return redact(`${node}: ${msg}`).slice(0, 500);
    }
  }
  return null;
}

async function saveExecution(exec: N8nExecution, extracted: number, parseError: string | null): Promise<void> {
  const final = FINAL.has(String(exec.status)) || (exec.finished === true && !exec.status);
  // '' marks a failed run whose error n8n did not report, so it is not fetched again.
  const error = exec.status === 'error' || exec.status === 'crashed' ? (executionError(exec) ?? '') : null;
  await q(
    `insert into n8n_executions (execution_id, workflow_id, status, mode, started_at, stopped_at, processed_at, attempts_extracted, parse_error, final, error_message)
     values ($1,$2,$3,$4,$5,$6,now(),$7,$8,$9,$10)
     on conflict (execution_id) do update set status = excluded.status, stopped_at = excluded.stopped_at,
       processed_at = now(), attempts_extracted = excluded.attempts_extracted, parse_error = excluded.parse_error, final = excluded.final,
       error_message = excluded.error_message`,
    [String(exec.id), exec.workflowId, exec.status ?? null, exec.mode ?? null, exec.startedAt ?? null, exec.stoppedAt ?? null, extracted, parseError, final, error],
  );
}

async function processSendExecution(exec: N8nExecution): Promise<number> {
  const wf = registry().workflows.find((w) => w.id === exec.workflowId);
  if (!wf) return 0;
  const { attempts, warnings } = extractFromExecution(exec, wf);
  await tx(async (c) => {
    for (const a of attempts) await recordSendAttempt(a, c);
  });
  for (const w of warnings.slice(0, 5)) {
    await recordIntegrationError(`n8n:wf:${wf.id}`, `${wf.name}: ${w}`, { executionId: exec.id }, 'warning');
  }
  return attempts.length;
}

/** WAHA inbound webhook executions → WhatsApp messages (history kept even if WAHA API is not connected). */
async function processWahaInbound(exec: N8nExecution, nodeName: string): Promise<number> {
  const runData: RunData = exec.data?.resultData?.runData ?? {};
  let n = 0;
  for (const run of runData[nodeName] ?? []) {
    for (const item of run.data?.main?.[0] ?? []) {
      const j = (item.json ?? {}) as Record<string, unknown>;
      const raw = (j.raw ?? {}) as Record<string, unknown>;
      const payload = (raw.payload ?? {}) as Record<string, unknown>;
      const event = String(j.event ?? raw.event ?? '');
      if (!/^message(\.any)?$/.test(event)) continue;
      const fromMe = j.fromMe === true || payload.fromMe === true;
      const chatId = String(fromMe ? (payload.to ?? '') : (j.from ?? payload.from ?? ''));
      const id = String(payload.id ?? '');
      if (!chatId || !id || chatId.endsWith('@g.us') || chatId === 'status@broadcast') continue;
      const ts = Number(j.timestamp ?? payload.timestamp);
      await recordWaMessage({
        session: String(j.session ?? raw.session ?? 'unknown'),
        messageId: id,
        chatId,
        fromMe,
        body: typeof j.body === 'string' ? j.body : typeof payload.body === 'string' ? payload.body : null,
        hasMedia: payload.hasMedia === true,
        ack: typeof payload.ack === 'number' ? payload.ack : null,
        sentAt: Number.isFinite(ts) ? new Date(ts * 1000) : new Date(exec.startedAt ?? Date.now()),
        source: 'n8n_webhook',
      });
      n++;
    }
  }
  return n;
}

async function syncWorkflowExecutions(workflowId: string, handler: (e: N8nExecution) => Promise<number>): Promise<{ seen: number; written: number }> {
  let cursor: string | undefined;
  let seen = 0;
  let written = 0;
  let knownStreak = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await listExecutions(workflowId, cursor);
    for (const exec of res.data) {
      seen++;
      const id = String(exec.id);
      if (await executionIsKnownFinal(id)) {
        knownStreak++;
        if (knownStreak >= KNOWN_STREAK_STOP) return { seen, written };
        continue;
      }
      knownStreak = 0;
      try {
        const n = await handler(exec);
        written += n;
        await saveExecution(exec, n, null);
      } catch (err) {
        const msg = (err as Error).message;
        await saveExecution({ ...exec, status: 'parse_error_retry' }, 0, msg);
        await recordIntegrationError(`n8n:wf:${workflowId}`, `Could not process execution ${id}: ${msg}`, { executionId: id });
      }
    }
    if (!res.nextCursor) break;
    cursor = res.nextCursor;
  }
  return { seen, written };
}

export async function syncN8nExecutions(): Promise<void> {
  const runId = await startRun('n8n_executions', 'n8n:executions');
  if (!n8nConfigured()) {
    await finishRun(runId, 'skipped', {}, 'N8N_BASE_URL / N8N_API_KEY not configured');
    await markSource('n8n:executions', false, 'Not connected: set N8N_BASE_URL and N8N_API_KEY on the server.');
    return;
  }
  const reg = registry();
  let seen = 0;
  let written = 0;
  const failures: string[] = [];
  for (const wf of reg.workflows) {
    try {
      const r = await syncWorkflowExecutions(wf.id, processSendExecution);
      seen += r.seen;
      written += r.written;
      await resolveIntegrationErrors(`n8n:wf:${wf.id}:fetch`);
    } catch (err) {
      failures.push(`${wf.name}: ${(err as Error).message}`);
      await recordIntegrationError(`n8n:wf:${wf.id}:fetch`, `Fetching executions for "${wf.name}" failed: ${(err as Error).message}`);
    }
  }
  for (const inbound of reg.inboundWorkflows) {
    try {
      const r = await syncWorkflowExecutions(inbound.id, (e) => processWahaInbound(e, inbound.node));
      seen += r.seen;
      written += r.written;
    } catch (err) {
      failures.push(`${inbound.name}: ${(err as Error).message}`);
      await recordIntegrationError(`n8n:wf:${inbound.id}:fetch`, `Fetching executions for "${inbound.name}" failed: ${(err as Error).message}`);
    }
  }
  const status = failures.length === 0 ? 'success' : failures.length < reg.workflows.length ? 'partial' : 'error';
  await finishRun(runId, status, { seen, written }, failures.join(' | ') || null);
  await markSource('n8n:executions', status !== 'error', failures.join(' | ') || null);
}

/** Refresh workflow active flags, detect sender workflows that the registry does not track. */
export async function scanN8nWorkflows(): Promise<void> {
  const runId = await startRun('n8n_workflows', 'n8n:workflows');
  if (!n8nConfigured()) {
    await finishRun(runId, 'skipped', {}, 'N8N_BASE_URL / N8N_API_KEY not configured');
    await markSource('n8n:workflows', false, 'Not connected: set N8N_BASE_URL and N8N_API_KEY on the server.');
    return;
  }
  try {
    const reg = registry();
    const tracked = new Set([...reg.workflows.map((w) => w.id), ...reg.inboundWorkflows.map((w) => w.id)]);
    const ignored = new Set(reg.ignoredWorkflows.ids);
    const all = await listWorkflows();
    for (const wf of all) {
      const senders = senderNodesIn(wf.nodes ?? []);
      await q(
        `insert into n8n_workflows (id, name, active, tracked, looks_like_sender, sender_nodes, updated_at, last_checked_at)
         values ($1,$2,$3,$4,$5,$6,$7,now())
         on conflict (id) do update set name = excluded.name, active = excluded.active, tracked = excluded.tracked,
           looks_like_sender = excluded.looks_like_sender, sender_nodes = excluded.sender_nodes,
           updated_at = excluded.updated_at, last_checked_at = now()`,
        [wf.id, wf.name, wf.active && !wf.isArchived, tracked.has(wf.id), senders.length > 0 && !ignored.has(wf.id), senders, wf.updatedAt ?? null],
      );
    }
    // Campaign status follows its workflows: active if any is active in n8n.
    for (const camp of reg.campaigns) {
      if (camp.workflowIds.length === 0) continue;
      await q(
        `update campaigns set status = case when exists (select 1 from n8n_workflows where id = any($2) and active) then 'active' else 'paused' end,
           updated_at = now() where slug = $1`,
        [camp.slug, camp.workflowIds],
      );
    }
    await finishRun(runId, 'success', { seen: all.length });
    await markSource('n8n:workflows', true, null, { rowCount: all.length });
  } catch (err) {
    await finishRun(runId, 'error', {}, (err as Error).message);
    await markSource('n8n:workflows', false, (err as Error).message);
    await recordIntegrationError('n8n:workflows', `Workflow scan failed: ${(err as Error).message}`);
  }
}
