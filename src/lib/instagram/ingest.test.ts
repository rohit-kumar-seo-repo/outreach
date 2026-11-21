import { describe, expect, it } from 'vitest';
import { igEvent, phoneDigits, stageFor } from './ingest';

describe('instagram ingest helpers', () => {
  it('normalises usernames and validates pages', () => {
    const e = igEvent.parse({ page: 'rohit_kumar_seo', extId: 'c1', username: '@Some.User', fromMe: false, kind: 'comment' });
    expect(e.username).toBe('some.user');
    expect(igEvent.safeParse({ page: 'other', extId: 'x', username: 'a', fromMe: false, kind: 'dm' }).success).toBe(false);
  });
  it('moves the pipeline forward only on real progress', () => {
    expect(stageFor({ fromMe: true, stage: 'gate' })).toBe('contacted');
    expect(stageFor({ fromMe: false, stage: 'q1' })).toBeNull();
    expect(stageFor({ fromMe: false, stage: 'q2' })).toBe('interested');
    expect(stageFor({ fromMe: false, needsYou: true })).toBe('interested');
  });
  it('reads call-back numbers', () => {
    expect(phoneDigits('98715 30594')).toBe('919871530594');
    expect(phoneDigits('+971 50 123 4567')).toBe('971501234567');
    expect(phoneDigits('call me')).toBeNull();
  });
});
