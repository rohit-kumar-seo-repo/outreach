// Instagram push endpoint: the n8n Instagram bots POST each comment / message here (one event or an array).
// Authenticated with INGEST_KEY like /api/ingest/n8n; idempotent on extId, so retries never double up.
import crypto from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { env } from '@/lib/env';
import { recordIntegrationError } from '@/lib/errors';
import { igEvent, ingestIg } from '@/lib/instagram/ingest';
import { markSource } from '@/lib/sync/runs';

export const dynamic = 'force-dynamic';

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
  if (Number(req.headers.get('content-length') ?? 0) > 1_000_000) return NextResponse.json({ error: 'payload too large' }, { status: 413 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON' }, { status: 400 });
  }
  const items = Array.isArray(body) ? body : [body];
  const results: { index: number; ok: boolean; leadId?: number; duplicate?: boolean; error?: string }[] = [];
  for (const [index, raw] of items.slice(0, 500).entries()) {
    const parsed = igEvent.safeParse(raw);
    if (!parsed.success) {
      const error = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      results.push({ index, ok: false, error });
      await recordIntegrationError('ingest:instagram', `Rejected Instagram event: ${error}`, { event: raw as Record<string, unknown> }, 'warning');
      continue;
    }
    try {
      const r = await ingestIg(parsed.data);
      results.push({ index, ok: true, leadId: r.leadId, duplicate: !r.inserted });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      results.push({ index, ok: false, error });
      await recordIntegrationError('ingest:instagram', `Instagram event failed: ${error}`, { event: raw as Record<string, unknown> }, 'warning');
    }
  }
  await markSource('ingest:instagram', results.every((r) => r.ok), results.some((r) => !r.ok) ? 'Some Instagram events were rejected' : null);
  const status = results.every((r) => r.ok) ? 200 : results.some((r) => r.ok) ? 207 : 422;
  return NextResponse.json({ results }, { status });
}
