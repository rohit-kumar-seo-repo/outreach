import { describe, expect, it } from 'vitest';
import { classifyReply, needsYou, stripQuoted, type Intent } from '@/lib/crm/intent';

const cases: [string, Intent][] = [
  // Real replies seen on the WhatsApp India and email campaigns.
  ['No', 'not_interested'],
  ['no', 'not_interested'],
  ['Nahi', 'not_interested'],
  ['Not interested', 'not_interested'],
  ['No thanks', 'not_interested'],
  ['No sir', 'not_interested'],
  ['We already have an in-house team', 'not_interested'],
  ['Nahi chahiye', 'not_interested'],
  ['Wrong number', 'not_interested'],
  ['Stop', 'unsubscribe'],
  ['Please remove me from your list', 'unsubscribe'],
  ['Unsubscribe', 'unsubscribe'],
  ['Hi', 'greeting'],
  ['Hello sir', 'greeting'],
  ['Good morning 🙏', 'greeting'],
  ['hii', 'greeting'],
  ['Thanks', 'ack'],
  ['Thank you sir', 'ack'],
  ['Ok thanks', 'ack'],
  ['👍', 'ack'],
  ['🙏', 'ack'],
  ['Thank you for contacting Smile Dental! Please let us know how we can help you.', 'auto'],
  ["We're currently unavailable, we will respond as soon as possible.", 'auto'],
  ['call me', 'callback'],
  ['U can call now', 'callback'],
  ['Talk to my husband 9876543210', 'callback'],
  ['after Diwali contact me', 'later'],
  ['Yes sir/call later', 'later'],
  ['Busy right now, will get back', 'later'],
  ['What are your charges?', 'question'],
  ['Please share the price list', 'question'],
  ['kitna lagega', 'question'],
  ['Who is this?', 'question'],
  ['Hello?', 'question'],
  ['Dear Rohit, Tell me.', 'interested'],
  ['Yeah sure', 'interested'],
  ['Yes', 'interested'],
  ['Ok', 'interested'],
  ['Interested in the 10 day free trial', 'interested'],
  ['haan ji', 'interested'],
  ['We run three clinics in Pune and have been thinking about Google Ads for a while', 'other'],
];

describe('classifyReply', () => {
  it.each(cases)('%s → %s', (text, intent) => {
    expect(classifyReply(text)).toBe(intent);
  });

  it('treats a voice note or image with no text as needing you', () => {
    expect(classifyReply(null, { hasMedia: true })).toBe('other');
    expect(classifyReply('', { hasMedia: false })).toBe('ack');
  });

  it('reads only their words, not the quoted pitch below', () => {
    const body = 'Not interested.\n\nOn Mon, 3 Nov 2026 at 10:00, Rohit <hello@rkdigitalmedia.in> wrote:\n> Can I share pricing? Interested?';
    expect(classifyReply(body)).toBe('not_interested');
    expect(stripQuoted(body)).toBe('Not interested.');
    expect(classifyReply('Sounds good, send details\n\nOn Tue wrote:\n> hi')).toBe('question');
  });

  it('splits intents into needs-you and screened-out', () => {
    expect(needsYou('interested')).toBe(true);
    expect(needsYou('later')).toBe(true);
    expect(needsYou('other')).toBe(true);
    expect(needsYou(null)).toBe(true);
    expect(needsYou('not_interested')).toBe(false);
    expect(needsYou('greeting')).toBe(false);
    expect(needsYou('auto')).toBe(false);
  });
});
