import { simpleParser } from 'mailparser';
import { normalizeEmail, normalizeMessageId } from '../normalize';

const BOUNCE_FROM = /(mailer-daemon|postmaster|mail delivery (sub)?system|maildelivery)/i;
const BOUNCE_SUBJECT =
  /(undeliver|delivery status notification \(failure\)|returned mail|failure notice|mail delivery failed|delivery failure|could not be delivered|message not delivered|delivery has failed|address not found|rejected:|non[- ]delivery)/i;
const DELAY_SUBJECT = /(delayed|delivery status notification \(delay\)|warning: message .* delayed|still being retried)/i;
const AUTO_REPLY_SUBJECT =
  /^(auto(matic)?[ -]?(reply|response|antwort)|out of (the )?office|ooo\b|away from (the )?office|i am (currently )?out|abwesenheit|réponse automatique|on leave|thank you for (contacting|your (email|message|enquiry|inquiry)))/i;

export type MessageKind = 'message' | 'bounce' | 'auto_reply';

export function classifyInbound(fromAddr: string | null, fromName: string | null, subject: string | null): MessageKind {
  const s = subject ?? '';
  if (DELAY_SUBJECT.test(s) && BOUNCE_FROM.test(`${fromAddr ?? ''} ${fromName ?? ''}`)) return 'auto_reply';
  if (BOUNCE_FROM.test(`${fromAddr ?? ''} ${fromName ?? ''}`) && (BOUNCE_SUBJECT.test(s) || !s)) return 'bounce';
  if (BOUNCE_SUBJECT.test(s) && /^(undeliver|mail delivery failed|delivery status notification \(failure\))/i.test(s)) return 'bounce';
  const stripped = s.replace(/^\s*(re|aw|fw|fwd)\s*:\s*/i, '');
  if (AUTO_REPLY_SUBJECT.test(stripped)) return 'auto_reply';
  return 'message';
}

export interface BounceInfo {
  recipients: { email: string; status: string | null; diagnostic: string | null; type: 'hard' | 'soft' | 'unknown' }[];
  originalMessageId: string | null;
  text: string;
}

function typeFor(status: string | null, diagnostic: string | null): 'hard' | 'soft' | 'unknown' {
  const s = status ?? diagnostic?.match(/\b([245]\.\d{1,3}\.\d{1,3})\b/)?.[1] ?? diagnostic?.match(/\b([45])\d\d\b/)?.[1] ?? null;
  if (!s) return 'unknown';
  if (s.startsWith('5')) return 'hard';
  if (s.startsWith('4')) return 'soft';
  return 'unknown';
}

export function parseDeliveryStatus(dsn: string): BounceInfo['recipients'] {
  const out: BounceInfo['recipients'] = [];
  const blocks = dsn.split(/\r?\n\r?\n/);
  for (const block of blocks) {
    const recip = block.match(/^(?:final|original)-recipient:\s*(?:rfc822;)?\s*<?([^\s>]+@[^\s>]+)>?/im);
    if (!recip) continue;
    const action = block.match(/^action:\s*(\S+)/im)?.[1]?.toLowerCase() ?? null;
    if (action && action !== 'failed') continue; // delayed / delivered / relayed are not bounces
    const status = block.match(/^status:\s*([245]\.\d{1,3}\.\d{1,3})/im)?.[1] ?? null;
    const diag = block.match(/^diagnostic-code:\s*(?:smtp;)?\s*([\s\S]*?)(?:\r?\n(?!\s)|$)/im)?.[1]?.replace(/\s+/g, ' ').trim() ?? null;
    const email = normalizeEmail(recip[1]);
    if (email && !out.some((r) => r.email === email)) out.push({ email, status, diagnostic: diag, type: typeFor(status, diag) });
  }
  return out;
}

export async function parseBounce(source: string): Promise<BounceInfo> {
  const parsed = await simpleParser(source);
  let recipients: BounceInfo['recipients'] = [];
  let originalMessageId: string | null = null;
  for (const att of parsed.attachments ?? []) {
    const ct = att.contentType.toLowerCase();
    const content = att.content.toString('utf8');
    if (ct === 'message/delivery-status' || ct === 'message/global-delivery-status') recipients = parseDeliveryStatus(content);
    if (ct === 'message/rfc822' || ct === 'text/rfc822-headers' || ct === 'message/rfc822-headers') {
      const mid = content.match(/^message-id:\s*(<[^>]+>)/im);
      if (mid) originalMessageId = normalizeMessageId(mid[1]);
    }
  }
  const text = parsed.text ?? '';
  if (recipients.length === 0) {
    // Some servers inline the DSN in the text body.
    recipients = parseDeliveryStatus(text);
  }
  if (recipients.length === 0) {
    const failed = parsed.headers.get('x-failed-recipients');
    const list = typeof failed === 'string' ? failed.split(',') : [];
    for (const f of list) {
      const email = normalizeEmail(f);
      if (email) recipients.push({ email, status: null, diagnostic: null, type: 'unknown' });
    }
  }
  if (recipients.length === 0) {
    // Postfix style: "<user@example.com>: host mx.example.com said: 550 5.1.1 ..."
    for (const m of text.matchAll(/<([^\s<>@]+@[^\s<>]+)>:\s*([^\n]*(?:\n\s+[^\n]*)*)/g)) {
      const email = normalizeEmail(m[1]);
      const diag = m[2].replace(/\s+/g, ' ').trim();
      if (email && !recipients.some((r) => r.email === email)) recipients.push({ email, status: null, diagnostic: diag, type: typeFor(null, diag) });
    }
  }
  if (!originalMessageId) {
    const mid = text.match(/^message-id:\s*(<[^>]+>)/im);
    if (mid) originalMessageId = normalizeMessageId(mid[1]);
  }
  return { recipients, originalMessageId, text: text.slice(0, 20_000) };
}
