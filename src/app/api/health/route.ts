import { NextResponse } from 'next/server';
import { one } from '@/lib/db';

export const dynamic = 'force-dynamic';

// Liveness/readiness for Docker and uptime checks. Reveals nothing about the data.
export async function GET() {
  try {
    await one('select 1');
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
