// Serves an uploaded WhatsApp template's media (image/document/video) by its random id, so WAHA
// — which runs outside this app and cannot read our database or send an admin cookie — can fetch
// it over plain HTTPS, the same way the existing n8n workflows already point WAHA at a public
// image URL. The id is an unguessable UUID; nothing else about the media (filename aside) is
// exposed, and this route is intentionally the only public thing this migration adds.
import { NextResponse } from 'next/server';
import { one } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{8,40}$/i.test(id)) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const row = await one<{ data: Buffer; mime_type: string; filename: string; byte_size: number }>('select data, mime_type, filename, byte_size from wa_media where id = $1', [id]);
  if (!row) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return new NextResponse(new Uint8Array(row.data), {
    headers: {
      'content-type': row.mime_type,
      'content-length': String(row.byte_size),
      'content-disposition': `inline; filename="${row.filename.replace(/["\r\n]/g, '')}"`,
      'cache-control': 'public, max-age=31536000, immutable',
    },
  });
}
