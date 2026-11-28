import { describe, expect, it } from 'vitest';
import { igEvent, phoneDigits, stageFor } from '@/lib/instagram/ingest';

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

import { commentRowEvents, dmRowEvents, engagedKeys } from '@/lib/instagram/sync';
describe('instagram n8n rows -> events', () => {
  it('turns a main-page comment row into comment, public reply and DM', () => {
    const ev = commentRowEvents({ comment_id: '1', username: 'a', comment_text: 'MAPS', keyword: 'MAPS', media_id: 'm', commented_at: '2026-11-21T10:00:00+0000', reply_text: 'Check DM', dm_status: 'sent', gate: 'waiting', createdAt: '2026-11-21T10:02:00.000Z' }) as { extId: string; kind: string; fromMe: boolean }[];
    expect(ev.map((e) => e.extId)).toEqual(['c:1', 'cr:1', 'cd:1']);
    expect(ev[2].fromMe).toBe(true);
  });
  it('routes AI-page DMs to the AI page', () => {
    const ev = commentRowEvents({ comment_id: 'dm:x', username: 'b', comment_text: 'AUTOMATE', gate: 'ai_dm_sent', dm_status: 'sent', resource_text: 'plan', createdAt: '2026-11-21T10:00:00.000Z' }) as { page: string }[];
    expect(ev).toHaveLength(2);
    expect(ev[0].page).toBe('ai_automation_by_rohit');
  });
  it('reads answers and the call-back number from the DM log', () => {
    const q2 = dmRowEvents({ user_msg_id: 'u1', username: 'c', user_text: 'No calls from ads', reply_text: 'Q2?', stage: 'q2', send_status: 'sent', createdAt: '2026-11-21T10:00:00.000Z' }) as { answers?: Record<string, string> }[];
    expect(q2[0].answers).toEqual({ problem: 'No calls from ads' });
    const qa = dmRowEvents({ user_msg_id: 'u2', username: 'c', user_text: '98715 30594', reply_text: 'Done', stage: 'qualified', website: 'phone: 98715 30594', send_status: 'sent', createdAt: '2026-11-21T10:05:00.000Z' }) as { needsYou?: boolean; answers?: Record<string, string> }[];
    expect(qa[0].needsYou).toBe(true);
    expect(qa[0].answers?.phone).toBe('98715 30594');
  });
});

describe('instagram CRM filter', () => {
  it('lets in only people who answered a DM question, per page', () => {
    const k = engagedKeys([
      { username: 'A', stage: 'q2', send_status: 'sent' },
      { username: 'b', stage: 'gate', send_status: 'sent' },
      { username: 'c', stage: 'close', send_status: 'dry' },
      { username: 'd', stage: 'qualified', send_status: 'sent', page: 'ai' },
    ]);
    expect([...k].sort()).toEqual(['ai_automation_by_rohit:d', 'rohit_kumar_seo:a']);
  });
  it('routes AI-page DM log rows to the AI page', () => {
    const ev = dmRowEvents({ user_msg_id: 'u9', username: 'e', user_text: 'Salon, Pune', reply_text: 'close', stage: 'close', send_status: 'sent', page: 'ai', createdAt: '2026-11-28T10:00:00.000Z' }) as { page: string }[];
    expect(ev[0].page).toBe('ai_automation_by_rohit');
  });
});
