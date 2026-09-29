import crypto from 'node:crypto';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx === -1) throw new Error('invalid base32');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function generateSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

export function hotp(secret: Buffer, counter: number): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', secret).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code = ((hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString();
  return code.padStart(6, '0');
}

/** RFC 6238 TOTP (30 s step, 6 digits, SHA-1) with ±1 step tolerance for clock drift. */
export function verifyTotp(secretB32: string, code: string, now: number = Date.now()): boolean {
  const clean = code.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(clean)) return false;
  const secret = base32Decode(secretB32);
  const counter = Math.floor(now / 1000 / 30);
  for (const delta of [-1, 0, 1]) {
    const expected = hotp(secret, counter + delta);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(clean))) return true;
  }
  return false;
}

export function otpauthUrl(secretB32: string, account: string, issuer = 'Rohit Kumar SEO Outreach'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
