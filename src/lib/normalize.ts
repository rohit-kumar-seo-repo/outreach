const EMAIL_RE = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*\.[a-z]{2,}$/;
const PLACEHOLDER_DOMAINS = new Set(['example.com', 'example.org', 'test.com', 'domain.com', 'email.com', 'yourdomain.com']);

/** Lower-cased first address found in a cell (handles "Name <a@b>", mailto:, lists). */
export function normalizeEmail(value: unknown): string | null {
  const s = String(value ?? '').trim();
  if (!s) return null;
  const angle = s.match(/<([^>]+)>/);
  let candidate = angle ? angle[1] : s;
  candidate = candidate.replace(/^mailto:/i, '');
  candidate = candidate.split(/[\s,;/|]+/).find((p) => p.includes('@')) ?? candidate;
  candidate = candidate.trim().toLowerCase().replace(/[.)\]]+$/, '');
  return candidate || null;
}

export function isValidEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  if (email.length > 254 || !EMAIL_RE.test(email)) return false;
  const domain = email.split('@')[1];
  return !PLACEHOLDER_DOMAINS.has(domain);
}

export function emailDomain(email: string | null | undefined): string | null {
  if (!email || !email.includes('@')) return null;
  return email.split('@')[1].toLowerCase();
}

export function digitsOnly(value: unknown): string {
  // Spreadsheet exports can render a phone stored as a number as "9871530594.0".
  return String(value ?? '').trim().replace(/\.0+$/, '').replace(/\D/g, '');
}

export type PhoneRule = 'india10' | 'uae' | 'any';

/**
 * Mirror of the n8n WAHA workflows' own toChatId() rules so the dashboard counts
 * exactly the rows the sender considers valid.
 */
export function toWaChatId(value: unknown, rule: PhoneRule): string | null {
  let digits = digitsOnly(value);
  if (!digits) return null;
  if (rule === 'india10') {
    return digits.length === 10 ? `91${digits}@c.us` : null;
  }
  if (rule === 'uae') {
    if (digits.length === 9) digits = `971${digits}`;
    return digits.startsWith('971') && digits.length === 12 ? `${digits}@c.us` : null;
  }
  return digits.length >= 8 && digits.length <= 15 ? `${digits}@c.us` : null;
}

export function chatIdToPhone(chatId: string): string {
  return chatId.replace(/@.*$/, '');
}

export function normalizeMessageId(value: unknown): string | null {
  const s = String(value ?? '').trim();
  if (!s) return null;
  const m = s.match(/<[^<>\s]+>/);
  const id = m ? m[0] : `<${s.replace(/^<|>$/g, '')}>`;
  return id.toLowerCase();
}

export function parseReferences(value: unknown): string[] {
  const s = String(value ?? '');
  return Array.from(s.matchAll(/<[^<>\s]+>/g)).map((m) => m[0].toLowerCase());
}

const SUBJECT_PREFIX = /^\s*((re|fw|fwd|aw|wg|sv|antw|tr|rif|vs|ynt)(\[\d+\])?\s*:|\[external\]|\[ext\])\s*/i;

export function normalizeSubject(value: unknown): string {
  let s = String(value ?? '').trim();
  let prev = '';
  while (s !== prev) {
    prev = s;
    s = s.replace(SUBJECT_PREFIX, '');
  }
  return s.replace(/\s+/g, ' ').trim().toLowerCase();
}

export function parseAddress(value: unknown): { name: string | null; address: string | null } {
  const s = String(value ?? '').trim();
  if (!s) return { name: null, address: null };
  const m = s.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim() || null, address: normalizeEmail(m[2]) };
  return { name: null, address: normalizeEmail(s) };
}

export function truncate(s: string | null | undefined, n: number): string {
  if (!s) return '';
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
