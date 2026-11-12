import { describe, expect, it } from 'vitest';
import { contactLinks, initials } from '@/lib/crm/contact';
import { stageFromSheetText } from '@/lib/crm/stages';
import { replySnippet } from '@/lib/crm/queries';

describe('contactLinks', () => {
  it('uses the WhatsApp chat id as the international number', () => {
    const l = contactLinks({ phone: '98765 43210', waChatId: '919876543210@c.us' });
    expect(l.tel).toBe('tel:+919876543210');
    expect(l.wa).toBe('https://wa.me/919876543210');
    expect(l.phoneLabel).toBe('+91 98765 43210');
  });

  it('trusts a leading + or 00 in the sheet', () => {
    expect(contactLinks({ phone: '+44 20 7946 0958' }).wa).toBe('https://wa.me/442079460958');
    expect(contactLinks({ phone: '0044 20 7946 0958' }).intlDigits).toBe('442079460958');
    expect(contactLinks({ phone: '+1 (415) 555-0132' }).phoneLabel).toBe('+1 415 555 0132');
  });

  it("adds the sheet's dialing code to local numbers", () => {
    expect(contactLinks({ phone: '098765 43210', dialCode: '91' }).intlDigits).toBe('919876543210');
    expect(contactLinks({ phone: '9876543210.0', dialCode: '91' }).wa).toBe('https://wa.me/919876543210');
    expect(contactLinks({ phone: '919876543210', dialCode: '91' }).intlDigits).toBe('919876543210');
    expect(contactLinks({ phone: '050 123 4567', dialCode: '971' }).intlDigits).toBe('971501234567');
  });

  it('never guesses a country: a bare local number is callable but gets no WhatsApp link', () => {
    const l = contactLinks({ phone: '020 7946 0958' });
    expect(l.tel).toBe('tel:02079460958');
    expect(l.wa).toBeNull();
  });

  it('uses the first of several numbers in one cell', () => {
    expect(contactLinks({ phone: '98765 43210, 99999 88888', dialCode: '91' }).intlDigits).toBe('919876543210');
  });

  it('handles missing data', () => {
    expect(contactLinks({})).toMatchObject({ tel: null, wa: null, mailto: null, phoneLabel: null });
    expect(contactLinks({ email: 'a@b.co' }).mailto).toBe('mailto:a@b.co');
  });

  it('makes avatar initials', () => {
    expect(initials('Best Pest Control')).toBe('BP');
    expect(initials('ekta world')).toBe('EW');
    expect(initials('')).toBe('?');
  });
});

describe('stageFromSheetText', () => {
  it('maps the reply workflow’s Lead Stage text to a pipeline stage', () => {
    expect(stageFromSheetText('Booked - Rohit handling')).toBe('meeting');
    expect(stageFromSheetText('Handled by Rohit')).toBe('contacted');
    expect(stageFromSheetText('Interested - link sent (manual)')).toBe('interested');
    expect(stageFromSheetText('Not interested')).toBe('lost');
    expect(stageFromSheetText('Won')).toBe('won');
    expect(stageFromSheetText('Proposal sent')).toBe('proposal');
  });

  it('a booked meeting time means meeting, whatever the text', () => {
    expect(stageFromSheetText('', '2026-11-14 16:00')).toBe('meeting');
  });

  it('ignores text it does not understand', () => {
    expect(stageFromSheetText('ignored')).toBeNull();
    expect(stageFromSheetText(null)).toBeNull();
  });
});

describe('replySnippet', () => {
  it('keeps their words and drops the quoted thread', () => {
    const body = 'Dear Rohit,\nTell me.\n\nOn Mon, 26 Oct 2026 at 10:00, Rohit <hello@x.in> wrote:\n> Hi there\n> pitch';
    expect(replySnippet(body)).toBe('Dear Rohit, Tell me.');
  });

  it('stops at forwarded headers and signatures', () => {
    expect(replySnippet('Yes please call\n--\nShivam')).toBe('Yes please call');
    expect(replySnippet('Interested.\n-----Original Message-----\nFrom: x')).toBe('Interested.');
  });

  it('truncates long text', () => {
    expect(replySnippet('a'.repeat(500), 50)).toHaveLength(50);
  });
});
