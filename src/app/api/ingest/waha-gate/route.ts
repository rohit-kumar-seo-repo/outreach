// Read by the n8n WhatsApp send workflows right before their final "Send via WAHA" step (see
// docs/WHATSAPP.md). Whatever this returns is the one real effect of a dashboard pause or daily
// cap — nothing else in n8n currently checks the dashboard, so if this endpoint is unreachable
// the workflow's own IF node fails closed (see the note in the docs) rather than sending anyway.
// Authenticated the same way as /api/ingest/n8n (a shared INGEST_KEY), because it is the same
// direction of call: an n8n workflow reading the dashboard's server, not the other way round.
import crypto from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { env } from '@/lib/env';
import { checkGate } from '@/lib/whatsapp/gate';

export const dynamic = 'force-dynamic';

function authorized(req: NextRequest): boolean {
  if (!env.ingestKey) return false;
  const got = req.headers.get('x-ingest-key') ?? req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  const a = crypto.createHash('sha256').update(got).digest();
  const b = crypto.createHash('sha256').update(env.ingestKey).digest();
  return crypto.timingSafeEqual(a, b);
}

export async function GET(req: NextRequest) {
  // Fails OPEN (allowed: true) when INGEST_KEY is simply not set yet, so adding this gate check to
  // an n8n workflow changes nothing until the dashboard is configured for it — see docs/WHATSAPP.md.
  // Once configured, an auth failure or any other error fails CLOSED (allowed: false) instead.
  if (!env.ingestKey) return NextResponse.json({ allowed: true, reason: 'ok', message: 'INGEST_KEY is not set on the dashboard server yet, so this check has no effect.' }, { status: 200 });
  if (!authorized(req)) return NextResponse.json({ allowed: false, reason: 'unauthorized', message: 'The gate key n8n sent does not match INGEST_KEY.' }, { status: 401 });
  const campaign = req.nextUrl.searchParams.get('campaign') ?? '';
  if (!campaign) return NextResponse.json({ allowed: false, reason: 'not_found', message: 'campaign query param is required' }, { status: 400 });
  const result = await checkGate(campaign);
  return NextResponse.json(result, { status: result.reason === 'not_found' ? 404 : 200 });
}
