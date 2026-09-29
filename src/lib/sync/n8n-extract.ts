// Turns one n8n execution (public API shape, includeData=true) into send attempts,
// using the per-workflow adapter from config/registry.json. Pure: no DB access.
import { campaignForRow, registry, type FieldRef, type SendNodeDef, type WorkflowDef } from '../registry';
import type { SendAttemptInput } from './record';

type Json = Record<string, unknown>;
interface N8nItem {
  json?: Json;
  pairedItem?: { item?: number; input?: number } | number | { item?: number; input?: number }[];
}
interface N8nRun {
  startTime?: number;
  executionTime?: number;
  source?: ({ previousNode: string; previousNodeOutput?: number; previousNodeRun?: number } | null)[];
  data?: { main?: (N8nItem[] | null)[] };
  error?: { message?: string; description?: string };
}
export type RunData = Record<string, N8nRun[]>;

export interface N8nExecution {
  id: string | number;
  workflowId: string;
  status?: string;
  mode?: string;
  startedAt?: string;
  stoppedAt?: string | null;
  finished?: boolean;
  data?: { resultData?: { runData?: RunData; error?: { message?: string } } };
}

export interface ExtractResult {
  attempts: SendAttemptInput[];
  warnings: string[];
}

function pairedIndex(item: N8nItem): { item: number; input: number } {
  const pi = item.pairedItem;
  const p = Array.isArray(pi) ? pi[0] : typeof pi === 'number' ? { item: pi } : pi;
  return { item: p?.item ?? 0, input: p?.input ?? 0 };
}

/** The input JSON that produced `item` in `run` (follows pairedItem back one node). */
export function inputJsonFor(runData: RunData, run: N8nRun, item: N8nItem): Json | null {
  const { item: idx, input } = pairedIndex(item);
  const src = run.source?.[input] ?? run.source?.[0];
  if (!src) return null;
  const prev = runData[src.previousNode]?.[src.previousNodeRun ?? 0];
  const items = prev?.data?.main?.[src.previousNodeOutput ?? 0] ?? [];
  return items[idx]?.json ?? null;
}

/** All input items that were fed into `run` (used when a node run failed as a whole). */
function allInputs(runData: RunData, run: N8nRun): Json[] {
  const src = run.source?.[0];
  if (!src) return [];
  const prev = runData[src.previousNode]?.[src.previousNodeRun ?? 0];
  return (prev?.data?.main?.[src.previousNodeOutput ?? 0] ?? []).map((i) => i.json ?? {});
}

export function resolveField(ref: FieldRef | undefined, json: Json | null): string | null {
  if (!ref) return null;
  if (ref.const !== undefined) return String(ref.const);
  if (ref.template) {
    return ref.template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_m, k: string) => String(json?.[k] ?? ''));
  }
  if (ref.field) {
    const v = json?.[ref.field];
    return v === undefined || v === null || v === '' ? null : String(v);
  }
  return null;
}

export function resolveStep(ref: FieldRef, json: Json | null): number {
  const raw = resolveField(ref, json);
  if (raw === null) return 0;
  let n: number;
  switch (ref.transform) {
    case 'minus_one':
      n = Number(raw) - 1;
      break;
    case 'plus_one':
      n = Number(raw) + 1;
      break;
    case 'fu_status': {
      const m = raw.match(/fu\s*(\d+)/i);
      n = m ? Number(m[1]) : 0;
      break;
    }
    default:
      n = Number(raw);
  }
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

interface Outcome {
  result: 'accepted' | 'failed' | 'unknown';
  providerStatus: string | null;
  messageId: string | null;
  error: string | null;
}

function errorText(json: Json): string {
  const e = json.error as Json | string | undefined;
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object') return String(e.message ?? e.description ?? JSON.stringify(e)).slice(0, 500);
  return String(json.message ?? JSON.stringify(json)).slice(0, 500);
}

export function classify(node: SendNodeDef, outputIndex: number, json: Json, recipient: string | null): Outcome {
  if (outputIndex >= 1) {
    return { result: 'failed', providerStatus: null, messageId: null, error: errorText(json) };
  }
  switch (node.detect) {
    case 'http_error_output':
    case 'http_never_error': {
      const code = typeof json.code === 'string' ? json.code : '';
      const hasErr = code.startsWith('ERR_') || (json.error !== undefined && json.error !== null && json.error !== '');
      if (hasErr) return { result: 'failed', providerStatus: code || null, messageId: null, error: errorText(json) };
      return {
        result: 'accepted',
        providerStatus: 'Hostinger Email API accepted the message (HTTP 2xx)',
        messageId: null,
        error: null,
      };
    }
    case 'smtp': {
      const accepted = Array.isArray(json.accepted) ? (json.accepted as unknown[]).map((x) => String(x).toLowerCase()) : [];
      const rejected = Array.isArray(json.rejected) ? (json.rejected as unknown[]).map((x) => String(x).toLowerCase()) : [];
      const response = typeof json.response === 'string' ? json.response : null;
      const messageId = typeof json.messageId === 'string' ? json.messageId : null;
      const r = recipient?.toLowerCase() ?? '';
      if ((r && rejected.includes(r)) || (accepted.length === 0 && rejected.length > 0)) {
        return { result: 'failed', providerStatus: response, messageId, error: `SMTP server rejected recipient ${rejected.join(', ')}` };
      }
      if (accepted.length > 0 || (response && /^2\d\d/.test(response))) {
        return { result: 'accepted', providerStatus: response, messageId, error: null };
      }
      return { result: 'unknown', providerStatus: response, messageId, error: 'SMTP result had no accepted/rejected list' };
    }
    case 'waha_key': {
      const key = json.key as Json | undefined;
      if (key && key.id) {
        // NOWEB engine: key.id is the WhatsApp message id; the chat history API later
        // reports it as "<fromMe>_<chatId>_<key.id>", matched by suffix in the WAHA sync.
        const id = String(key.id);
        return { result: 'accepted', providerStatus: 'WAHA accepted (message key returned)', messageId: id, error: null };
      }
      return { result: 'failed', providerStatus: null, messageId: null, error: JSON.stringify(json).slice(0, 300) };
    }
  }
}

export function extractFromExecution(exec: N8nExecution, wf: WorkflowDef): ExtractResult {
  const attempts: SendAttemptInput[] = [];
  const warnings: string[] = [];
  const runData = exec.data?.resultData?.runData ?? {};
  const executionId = String(exec.id);
  const reg = registry();
  const campaignSource = wf.campaign.fromSource ? reg.sources.find((s) => s.key === wf.campaign.fromSource) : null;
  const leadSourceKey = wf.campaign.source ?? wf.campaign.fromSource ?? null;
  const channel = reg.campaigns.find((c) => c.slug === wf.campaign.slug)?.channel ?? (wf.sendNodes[0]?.provider === 'waha' ? 'whatsapp' : 'email');

  for (const node of wf.sendNodes) {
    const runs = runData[node.node];
    if (!runs) continue;
    runs.forEach((run, runIndex) => {
      const at = run.startTime ? new Date(run.startTime) : exec.startedAt ? new Date(exec.startedAt) : null;
      const build = (json: Json | null, outcome: Outcome, itemIndex: number, outputIndex: number) => {
        const recipient = resolveField(node.recipient, json);
        if (!recipient) {
          warnings.push(`${node.node} run ${runIndex} item ${itemIndex}: no recipient found in input`);
          return;
        }
        const slug = wf.campaign.slug ?? (campaignSource && json ? campaignForRow(campaignSource, json) : null);
        attempts.push({
          idempotencyKey: `n8n:${executionId}:${node.node}:${runIndex}:${outputIndex}:${itemIndex}`,
          channel,
          campaignSlug: slug,
          sourceKey: leadSourceKey,
          leadRowKey: resolveField(node.leadKey, json),
          leadName: resolveField(node.name, json),
          sender: resolveField(node.sender, json),
          recipient,
          step: resolveStep(node.step, json),
          result: outcome.result,
          provider: node.provider,
          providerStatus: outcome.providerStatus,
          errorMessage: outcome.error,
          messageId: outcome.messageId,
          subject: resolveField(node.subject, json),
          source: 'n8n_execution',
          n8n: { workflowId: wf.id, executionId, node: node.node, runIndex, itemIndex },
          occurredAt: at,
          timeQuality: at ? 'exact' : 'unknown',
        });
      };

      if (run.error) {
        // The node failed as a whole (no continueErrorOutput). Some items may already have
        // been sent before the failure, so the per-item outcome is genuinely unknown.
        const inputs = allInputs(runData, run);
        const msg = `Node "${node.node}" failed: ${run.error.message ?? 'unknown error'} (per-item outcome unknown)`;
        warnings.push(msg);
        inputs.forEach((json, i) => build(json, { result: 'unknown', providerStatus: null, messageId: null, error: msg }, i, 9));
        return;
      }
      const outputs = run.data?.main ?? [];
      outputs.forEach((items, outputIndex) => {
        (items ?? []).forEach((item, itemIndex) => {
          const json = inputJsonFor(runData, run, item);
          if (!json) warnings.push(`${node.node} run ${runIndex}: could not trace input for item ${itemIndex}`);
          const recipient = resolveField(node.recipient, json);
          build(json, classify(node, outputIndex, item.json ?? {}, recipient), itemIndex, outputIndex);
        });
      });
    });
  }
  return { attempts, warnings };
}

/** Heuristic used by the workflow scan: does this workflow contain nodes that send messages? */
export function senderNodesIn(nodes: { name: string; type: string; disabled?: boolean; parameters?: Json }[]): string[] {
  return nodes
    .filter((n) => !n.disabled)
    .filter((n) => {
      if (n.type === 'n8n-nodes-base.emailSend' || n.type === 'n8n-nodes-base.gmail' || n.type === 'n8n-nodes-base.whatsApp') return true;
      if (n.type === 'n8n-nodes-base.httpRequest') {
        const url = String(n.parameters?.url ?? '');
        return /api\.mail\.hostinger\.com\/.*\/send/.test(url) || /\/api\/send(Text|Image|File|Voice|Video)?\b/.test(url);
      }
      return false;
    })
    .map((n) => n.name);
}
