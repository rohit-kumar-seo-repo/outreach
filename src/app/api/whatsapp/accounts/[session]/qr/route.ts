// Proxies a WAHA session's QR code image so it can be shown in the dashboard without ever
// putting WAHA_API_KEY in the browser. Requires an active dashboard login, same as every other
// page under /whatsapp.
import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth/session';
import { fetchQrImage } from '@/lib/whatsapp/accounts';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ session: string }> }) {
  await requireSession();
  const { session } = await params;
  const res = await fetchQrImage(session);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status || 502 });
  return new NextResponse(res.bytes, { headers: { 'content-type': res.contentType, 'cache-control': 'no-store' } });
}
