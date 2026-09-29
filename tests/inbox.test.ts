import { describe, expect, it } from 'vitest';
import { checkReplyInput, parseAddressList, replySubject } from '@/lib/mail/reply';
import { formatPhone } from '@/lib/normalize';
import { isInternalSubject } from '@/lib/sync/internal';
import { phoneFromJid, WA_AWAY, WA_GREETING } from '@/lib/sync/wa-store';

describe('reply input', () => {
  it('accepts plain and named addresses, deduplicates, and keeps Cc separate from To', () => {
    expect(parseAddressList('Sarah <Sarah@BrightPath.example>, sarah@brightpath.example; bob@x.example')).toEqual({
      valid: ['sarah@brightpath.example', 'bob@x.example'],
      invalid: [],
    });
    const ok = checkReplyInput({ to: 'a@x.example', cc: 'a@x.example, b@x.example', body: '  Thanks!\r\n' });
    expect(ok).toEqual({ ok: true, to: ['a@x.example'], cc: ['b@x.example'], body: 'Thanks!' });
  });
  it('refuses bad addresses, empty replies, too many recipients and oversized bodies', () => {
    expect(checkReplyInput({ to: 'not-an-address', cc: '', body: 'hi' })).toMatchObject({ ok: false });
    expect(checkReplyInput({ to: '', cc: '', body: 'hi' })).toEqual({ ok: false, error: 'Add at least one recipient.' });
    expect(checkReplyInput({ to: 'a@x.example', cc: '', body: '   ' })).toEqual({ ok: false, error: 'Write a reply first.' });
    const six = ['a', 'b', 'c', 'd', 'e', 'f'].map((n) => `${n}@x.example`).join(',');
    expect(checkReplyInput({ to: six, cc: '', body: 'hi' })).toMatchObject({ ok: false });
    expect(checkReplyInput({ to: 'a@x.example', cc: '', body: 'x'.repeat(20_001) })).toMatchObject({ ok: false });
  });
  it('keeps the subject so the reply stays in the thread', () => {
    expect(replySubject('SEO growth plan for BrightPath')).toBe('Re: SEO growth plan for BrightPath');
    expect(replySubject('RE: SEO growth plan')).toBe('RE: SEO growth plan');
  });
});

describe('internal / automation mail', () => {
  it('recognises reports, alerts and test messages but not prospects’ subjects', () => {
    for (const s of ['Daily Outreach Summary - 2026-09-29 (12 sent)', '[Outreach alert] 3 new alerts', 'Test', 'test email', 'Re: Testing 2', 'TEST - dispatcher'])
      expect(isInternalSubject(s), s).toBe(true);
    for (const s of ['Test results for your website', 'Re: SEO growth plan', 'Latest outreach ideas', 'Testimonials'])
      expect(isInternalSubject(s), s).toBe(false);
  });
});

describe('WhatsApp numbers', () => {
  it('reads the real number from WhatsApp addresses and formats it', () => {
    expect(phoneFromJid('919871530594@s.whatsapp.net')).toBe('919871530594');
    expect(phoneFromJid('919871530594:12@c.us')).toBe('919871530594');
    expect(phoneFromJid('271549709951039@lid')).toBeNull();
    expect(phoneFromJid('12036302@g.us')).toBeNull();
    expect(formatPhone('919871530594')).toBe('+91 98715 30594');
    expect(formatPhone('971501234567')).toBe('+971 50 123 4567');
    expect(formatPhone('14155550132')).toBe('+1 415 555 0132');
    expect(formatPhone('12')).toBeNull();
  });
  it('treats away messages as automatic, and greetings only when they arrive right after our message', () => {
    const away = new RegExp(WA_AWAY, 'i');
    const greet = new RegExp(WA_GREETING, 'i');
    expect(away.test("Thank you for your message. We're unavailable right now, but will respond as soon as possible.")).toBe(true);
    expect(away.test('We are currently closed. Our business hours are 9-6.')).toBe(true);
    expect(greet.test('Thank you for contacting Dental Smiles..dental & skin clinic')).toBe(true);
    expect(greet.test('👋 Welcome to First Tooth Dental Studio! Thank you for reaching out')).toBe(true);
    expect(away.test('Yes, please send the proposal')).toBe(false);
    expect(greet.test('Yes, please send the proposal')).toBe(false);
  });
});
