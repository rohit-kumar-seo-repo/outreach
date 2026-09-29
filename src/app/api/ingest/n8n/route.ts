// Optional push endpoint: an n8n HTTP Request node can POST send results here right after
// a send. Authenticated with INGEST_KEY; idempotent, so n8n retries never double count.
import crypto from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { env } from '@/lib/env';
import { recordIntegrationError } from '@/lib/errors';
import { registry } from '@/lib/registry';
import { recordSendAttempt } from '@/lib/sync/record';
import { markSource } from '@/lib/sync/runs';

export const dynamic = 'force-dynamic';

const event = z.object({
  idempotencyKey: z.string().min(1).max(300).optional(),
  workflowId: z.string().max(100),
  executionId: z.union([z.string(), z.number()]).transform(String),
  campaign: z.string().max(100),
  channel: z.enum(['email', 'whatsapp']).default('email'),
  recipient: z.string().min(3).max(320),
  sender: z.string().max(320).optional(),
  step: z.coerce.number().int().min(0).max(20).default(0),
  result: z.enum(['accepted', 'failed', 'unknown']),
  providerStatus: z.string().max(500).optional(),
  error: z.string().max(1000).optional(),
  messageId: z.string().max(500).optional(),
  subject: z.string().max(500).optional(),
  occurredAt: z.string().datetime({ offset: true }).optional(),
  source: z.string().max(100).optional(),
  leadKey: z.string().max(300).optional(),
});

function authorized(req: NextRequest): boolean {
  if (!env.ingestKey) return false;
  const got = req.headers.get('x-ingest-key') ?? req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const a = crypto.createHash('sha256').update(got).digest();
  const b = crypto.createHash('sha256').update(env.ingestKey).digest();
  return crypto.timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  if (!env.ingestKey) return NextResponse.json({ error: 'ingest disabled (INGEST_KEY not set)' }, { status: 503 });
  if (!authorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const len = Number(req.headers.get('content-length') ?? 0);
  if (len > 1_000_000) return NextResponse.json({ error: 'payload too large' }, { status: 413 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  const items = Array.isArray(body) ? body : [body];
  const slugs = new Set(registry().campaigns.map((c) => c.slug));
  const results: { index: number; ok: boolean; id?: number; duplicate?: boolean; error?: string }[] = [];
  for (const [index, raw] of items.slice(0, 500).entries()) {
    const parsed = event.safeParse(raw);
    if (!parsed.success || !slugs.has(parsed.data.campaign)) {
      const error = parsed.success ? `unknown campaign "${parsed.data.campaign}"` : parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      results.push({ index, ok: false, error });
      // Rejected events are recorded, never silently dropped.
      await recordIntegrationError('ingest:push', `Rejected pushed event: ${error}`, { event: raw as Record<string, unknown> }, 'warning');
      continue;
    }
    const e = parsed.data;
    const at = e.occurredAt ? new Date(e.occurredAt) : new Date();
    const key = e.idempotencyKey ?? `push:${e.workflowId}:${e.executionId}:${e.recipient.toLowerCase()}:${e.step}`;
    const r = await recordSendAttempt({
      idempotencyKey: key,
      channel: e.channel,
      campaignSlug: e.campaign,
      sourceKey: e.source ?? null,
      leadRowKey: e.leadKey ?? null,
      sender: e.sender ?? null,
      recipient: e.recipient,
      step: e.step,
      result: e.result,
      provider: e.channel === 'whatsapp' ? 'waha' : null,
      providerStatus: e.providerStatus ?? null,
      errorMessage: e.error ?? null,
      messageId: e.messageId ?? null,
      subject: e.subject ?? null,
      source: 'n8n_push',
      n8n: { workflowId: e.workflowId, executionId: e.executionId, node: 'push', runIndex: 0, itemIndex: index },
      occurredAt: at,
      timeQuality: 'exact',
    });
    results.push({ index, ok: true, id: r.id, duplicate: !r.inserted });
  }
  await markSource('ingest:push', results.every((r) => r.ok), results.some((r) => !r.ok) ? 'Some pushed events were rejected' : null);
  const status = results.every((r) => r.ok) ? 200 : results.some((r) => r.ok) ? 207 : 422;
  return NextResponse.json({ results }, { status });
}
