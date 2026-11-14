import { describe, expect, it } from 'vitest';
import { nextStep } from '@/lib/crm/nextstep';
import { healthOf } from '@/lib/metrics/scoreboard';

const base = { id: 7, replyHref: '/inbox?thread=t1', hasPhone: true };

describe('nextStep', () => {
  it('sends a question or interest to the conversation', () => {
    expect(nextStep({ ...base, attention: 'reply', replyIntent: 'question' })).toEqual({ kind: 'reply', label: 'Answer their question', href: '/inbox?thread=t1' });
    expect(nextStep({ ...base, attention: 'reply', replyIntent: 'interested' })?.href).toBe('/inbox?thread=t1');
    expect(nextStep({ ...base, attention: 'reply', replyIntent: null })?.label).toBe('Read and reply');
  });

  it('sends a call request to the lead page, where the call is logged', () => {
    expect(nextStep({ ...base, attention: 'reply', replyIntent: 'callback' })).toEqual({ kind: 'call', label: 'They asked for a call', href: '/leads/7' });
    // No number on file: answer in the conversation instead.
    expect(nextStep({ ...base, hasPhone: false, attention: 'reply', replyIntent: 'callback' })?.href).toBe('/inbox?thread=t1');
  });

  it('falls back to the lead page when there is no conversation', () => {
    expect(nextStep({ ...base, replyHref: null, attention: 'reply', replyIntent: 'question' })?.href).toBe('/leads/7');
    expect(nextStep({ ...base, replyHref: null, attention: 'cold', replyIntent: 'interested' })).toEqual({ kind: 'checkin', label: 'Check in: gone quiet', href: '/leads/7' });
  });

  it('has a step for reminders and none for leads that do not need you', () => {
    expect(nextStep({ ...base, attention: 'due', replyIntent: 'question' })).toEqual({ kind: 'followup', label: 'Follow up now', href: '/leads/7' });
    expect(nextStep({ ...base, attention: null, replyIntent: 'question' })).toBeNull();
  });
});

describe('healthOf', () => {
  const now = new Date('2026-11-14T10:00:00Z');
  const ago = (days: number) => new Date(now.getTime() - days * 86400_000);
  it('reads a source in plain states', () => {
    expect(healthOf({ paused: true, remaining: 50, contacted: 10, lastSendAt: ago(0.1) }, now)).toBe('paused');
    expect(healthOf({ paused: false, remaining: 50, contacted: 10, lastSendAt: ago(1) }, now)).toBe('sending');
    expect(healthOf({ paused: false, remaining: 50, contacted: 10, lastSendAt: ago(5) }, now)).toBe('idle');
    expect(healthOf({ paused: false, remaining: 0, contacted: 10, lastSendAt: ago(5) }, now)).toBe('finished');
    expect(healthOf({ paused: false, remaining: 50, contacted: 0, lastSendAt: null }, now)).toBe('new');
  });
});
