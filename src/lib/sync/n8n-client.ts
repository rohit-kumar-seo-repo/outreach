import { env } from '../env';
import { fetchJson } from './http';
import type { N8nExecution } from './n8n-extract';

export interface N8nWorkflowSummary {
  id: string;
  name: string;
  active: boolean;
  updatedAt?: string;
  isArchived?: boolean;
  nodes?: { name: string; type: string; disabled?: boolean; parameters?: Record<string, unknown> }[];
}

function headers(): Record<string, string> {
  return { 'X-N8N-API-KEY': env.n8nApiKey, accept: 'application/json' };
}

export function n8nConfigured(): boolean {
  return !!env.n8nBaseUrl && !!env.n8nApiKey;
}

export async function listExecutions(workflowId: string, cursor?: string, limit = 20): Promise<{ data: N8nExecution[]; nextCursor?: string | null }> {
  const url = new URL(`${env.n8nBaseUrl}/api/v1/executions`);
  url.searchParams.set('workflowId', workflowId);
  url.searchParams.set('includeData', 'true');
  url.searchParams.set('limit', String(limit));
  if (cursor) url.searchParams.set('cursor', cursor);
  return fetchJson(url.toString(), { headers: headers(), timeoutMs: 60_000 });
}

export async function listWorkflows(): Promise<N8nWorkflowSummary[]> {
  const out: N8nWorkflowSummary[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 20; page++) {
    const url = new URL(`${env.n8nBaseUrl}/api/v1/workflows`);
    url.searchParams.set('limit', '100');
    if (cursor) url.searchParams.set('cursor', cursor);
    const res = await fetchJson<{ data: N8nWorkflowSummary[]; nextCursor?: string | null }>(url.toString(), { headers: headers() });
    out.push(...res.data);
    if (!res.nextCursor) break;
    cursor = res.nextCursor;
  }
  return out;
}
