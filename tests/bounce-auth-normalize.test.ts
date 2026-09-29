import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { base32Encode, hotp, verifyTotp } from '@/lib/auth/totp';
import { redact } from '@/lib/errors';
import { isValidEmail, normalizeEmail, normalizeMessageId, normalizeSubject, parseAddress, toWaChatId } from '@/lib/normalize';
import { classifyInbound, parseBounce, parseDeliveryStatus } from '@/lib/sync/bounce';
import { dateOnlyToNoonLocal, localDate, parseSheetTimestamp } from '@/lib/time';

const DSN = [
  'From: Mail Delivery System <MAILER-DAEMON@mx.hostinger.com>',
  'To: agency@adssuspensionrecovery.com',
  'Subject: Undelivered Mail Returned to Sender',
  'Message-ID: <bounce1@mx.hostinger.com>',
  'MIME-Version: 1.0',
  'Content-Type: multipart/report; report-type=delivery-status; boundary="B"',
  '',
  '--B',
  'Content-Type: text/plain',
  '',
  'This is the mail system. Your message could not be delivered.',
  '--B',
  'Content-Type: message/delivery-status',
  '',
  'Reporting-MTA: dns; mx.hostinger.com',
  '',
  'Final-Recipient: rfc822; gone@nowhere.example',
  'Action: failed',
  'Status: 5.1.1',
  'Diagnostic-Code: smtp; 550 5.1.1 <gone@nowhere.example>: Recipient address rejected: User unknown',
  '',
  '--B',
  'Content-Type: text/rfc822-headers',
  '',
  'From: agency@adssuspensionrecovery.com',
  'To: gone@nowhere.example',
  'Message-ID: <Orig-1@adssuspensionrecovery.com>',
  'Subject: Hello',
  '',
  '--B--',
  '',
].join('\r\n');

describe('bounces', () => {
  it('parses a multipart/report DSN: recipient, hard type, and original Message-ID', async () => {
    const info = await parseBounce(DSN);
    expect(info.recipients).toEqual([
      expect.objectContaining({ email: 'gone@nowhere.example', status: '5.1.1', type: 'hard' }),
    ]);
    expect(info.originalMessageId).toBe('<orig-1@adssuspensionrecovery.com>');
  });

  it('ignores delayed notifications and classifies inbound mail', () => {
    expect(parseDeliveryStatus('Final-Recipient: rfc822; slow@x.example\nAction: delayed\nStatus: 4.4.1')).toEqual([]);
    expect(classifyInbound('mailer-daemon@mx.example', 'Mail Delivery System', 'Undelivered Mail Returned to Sender')).toBe('bounce');
    expect(classifyInbound('postmaster@x.example', null, 'Delivery Status Notification (Failure)')).toBe('bounce');
    expect(classifyInbound('ceo@client.example', 'CEO', 'Automatic reply: Quick question')).toBe('auto_reply');
    expect(classifyInbound('ceo@client.example', 'CEO', 'Out of Office')).toBe('auto_reply');
    expect(classifyInbound('ceo@client.example', 'CEO', 'Re: Quick question for your clinic')).toBe('message');
  });
});

describe('auth', () => {
  it('hashes and verifies passwords with scrypt', async () => {
    const h = await hashPassword('correct horse battery');
    expect(h.startsWith('scrypt:')).toBe(true);
    expect(h).not.toContain('$');
    expect(await verifyPassword('correct horse battery', h)).toBe(true);
    expect(await verifyPassword('wrong password here', h)).toBe(false);
    await expect(hashPassword('short')).rejects.toThrow();
  });

  it('matches the RFC 4226 / 6238 test vectors', () => {
    const secret = Buffer.from('12345678901234567890');
    expect(hotp(secret, 0)).toBe('755224');
    expect(hotp(secret, 1)).toBe('287082');
    const b32 = base32Encode(secret);
    expect(verifyTotp(b32, '287082', 59_000)).toBe(true); // T=1 at 59 s
    expect(verifyTotp(b32, '000000', 59_000)).toBe(false);
  });

  it('redacts credentials from stored error text', () => {
    expect(redact('Authorization: Bearer abc.def.ghi failed')).not.toContain('abc.def');
    expect(redact('X-Api-Key: ZK420xyz')).not.toContain('ZK420xyz');
    expect(redact('{"password":"hunter2"}')).not.toContain('hunter2');
  });
});

describe('normalization', () => {
  it('normalizes addresses and ids', () => {
    expect(normalizeEmail(' Info.Aesthetics@KCH.AE ')).toBe('info.aesthetics@kch.ae');
    expect(normalizeEmail('mailto:a@b.example')).toBe('a@b.example');
    expect(normalizeEmail('x@y.example, z@w.example')).toBe('x@y.example');
    expect(isValidEmail('a@b.example')).toBe(true);
    expect(isValidEmail('abc')).toBe(false);
    expect(isValidEmail('test@example.com')).toBe(false);
    expect(parseAddress('"Jane Doe" <Jane@Doe.example>')).toEqual({ name: 'Jane Doe', address: 'jane@doe.example' });
    expect(normalizeMessageId('Abc@Host')).toBe('<abc@host>');
    expect(normalizeSubject('RE: Fwd: Re:  Quick   question')).toBe('quick question');
    expect(toWaChatId('+91 98765 43210', 'india10')).toBeNull(); // the sender requires exactly 10 digits
    expect(toWaChatId('98765-43210', 'india10')).toBe('919876543210@c.us');
    expect(toWaChatId('9871530594.0', 'india10')).toBe('919871530594@c.us'); // numeric cell exported as float
  });

  it('never upgrades vague sheet times to exact ones', () => {
    expect(parseSheetTimestamp('2026-09-22T09:00:00Z').quality).toBe('exact');
    expect(parseSheetTimestamp('2026-09-22').quality).toBe('date_only');
    expect(parseSheetTimestamp('Tue 8:48pm IST').quality).toBe('unknown');
    const noon = dateOnlyToNoonLocal('2026-09-22', 'Asia/Kolkata');
    expect(noon.toISOString()).toBe('2026-09-22T06:30:00.000Z');
    expect(localDate(noon, 'Asia/Kolkata')).toBe('2026-09-22');
  });
});
