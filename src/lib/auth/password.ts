import crypto from 'node:crypto';

// Format: scrypt:N:r:p:<salt b64url>:<hash b64url>  (':' so the value is safe in shell and
// Docker Compose .env files, where '$' would be treated as a variable reference)
const N = 2 ** 15;
const R = 8;
const P = 1;
const KEYLEN = 64;

function scrypt(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, KEYLEN, { N: n, r, p, maxmem: 256 * n * r }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 12) throw new Error('Use a password of at least 12 characters.');
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, N, R, P);
  return ['scrypt', N, R, P, salt.toString('base64url'), key.toString('base64url')].join(':');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.trim().split(stored.includes(':') ? ':' : '$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, 'base64url');
  const key = await scrypt(password, Buffer.from(saltB64, 'base64url'), Number(n), Number(r), Number(p));
  return expected.length === key.length && crypto.timingSafeEqual(expected, key);
}
