// Tap-to-call / WhatsApp / email links for a lead. Pure functions, safe on client and server.

export interface ContactInput {
  phone?: string | null;
  phoneNorm?: string | null;
  waChatId?: string | null;
  email?: string | null;
  /** The source sheet's default country dialing code (registry `dialCode`), e.g. "91". */
  dialCode?: string | null;
}

export interface ContactLinks {
  /** tel: URI, or null when there is no usable number. */
  tel: string | null;
  /** Number as shown to a person. */
  phoneLabel: string | null;
  /** Digits in international form (no +), when known: what wa.me needs. */
  intlDigits: string | null;
  /** https://wa.me/<digits>, only when the international number is known. */
  wa: string | null;
  mailto: string | null;
}

const digits = (v: string | null | undefined) => String(v ?? '').trim().replace(/\.0+$/, '').replace(/\D/g, '');

/**
 * International digits are only claimed when they are certain: a WhatsApp chat id (always
 * international), a sheet value written with a leading "+" or "00", or a local number from a
 * sheet whose country is known (`dialCode`). Otherwise a bare local number (e.g. "020 7946 0958")
 * is still callable as typed, but gets no WhatsApp link: guessing the country code would message
 * the wrong person.
 */
export function contactLinks(c: ContactInput): ContactLinks {
  const raw = firstNumber(c.phone);
  const chatDigits = c.waChatId && /@c\.us$/.test(c.waChatId) ? digits(c.waChatId.split('@')[0]) : '';
  let intl: string | null = null;
  if (chatDigits.length >= 8) intl = chatDigits;
  else if (/^\s*\+/.test(raw) && digits(raw).length >= 8) intl = digits(raw);
  else if (/^\s*00/.test(raw) && digits(raw).length >= 10) intl = digits(raw).slice(2);
  else if (c.dialCode && digits(raw)) intl = withDialCode(digits(raw), c.dialCode);

  let tel: string | null = null;
  let phoneLabel: string | null = null;
  if (intl) {
    tel = `tel:+${intl}`;
    phoneLabel = formatIntl(intl);
  } else if (digits(raw).length >= 6) {
    tel = `tel:${digits(raw)}`;
    phoneLabel = raw.replace(/\.0+$/, '');
  }
  const email = (c.email ?? '').trim();
  return {
    tel,
    phoneLabel,
    intlDigits: intl,
    wa: intl ? `https://wa.me/${intl}` : null,
    mailto: email.includes('@') ? `mailto:${email}` : null,
  };
}

/** A cell can hold several numbers ("98765 43210, 99999 88888"); the first one is used. */
function firstNumber(v: string | null | undefined): string {
  const parts = String(v ?? '').split(/[,;/|]|\s{2,}|\bor\b/i);
  return (parts.find((p) => digits(p).length >= 6) ?? parts[0] ?? '').trim();
}

function withDialCode(d: string, code: string): string | null {
  if (d.startsWith(code) && d.length >= code.length + 9 && d.length <= 15) return d;
  const national = d.replace(/^0+/, '');
  return national.length >= 7 && national.length <= 10 ? `${code}${national}` : null;
}

function formatIntl(d: string): string {
  if (d.startsWith('91') && d.length === 12) return `+91 ${d.slice(2, 7)} ${d.slice(7)}`;
  if (d.startsWith('971') && d.length === 12) return `+971 ${d.slice(3, 5)} ${d.slice(5, 8)} ${d.slice(8)}`;
  if (d.startsWith('1') && d.length === 11) return `+1 ${d.slice(1, 4)} ${d.slice(4, 7)} ${d.slice(7)}`;
  if (d.startsWith('44') && d.length === 12) return `+44 ${d.slice(2, 4)} ${d.slice(4, 8)} ${d.slice(8)}`;
  if (d.startsWith('61') && d.length === 11) return `+61 ${d.slice(2, 3)} ${d.slice(3, 7)} ${d.slice(7)}`;
  return `+${d}`;
}

/** Up to two initials for an avatar: "Best Pest Control" → "BP", "a@b.com" → "A". */
export function initials(name: string | null | undefined): string {
  const words = String(name ?? '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return '?';
  return (words[0][0] + (words[1]?.[0] ?? '')).toUpperCase();
}
