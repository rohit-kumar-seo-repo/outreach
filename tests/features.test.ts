import { describe, expect, it } from 'vitest';
import { cellStatus } from '@/lib/metrics/coverage';
import { limitState } from '@/lib/metrics/sending';
import { executionError } from '@/lib/sync/n8n-sync';

describe('data coverage rule', () => {
  const w = { n8nFrom: '2026-09-23', n8nUntil: null, mailFrom: null };
  it('is complete inside n8n history, approximate from sheets before it, unknown otherwise', () => {
    expect(cellStatus('2026-09-25', { n: 0, dateOnly: 0 }, w)).toEqual({ status: 'complete', via: 'n8n' });
    expect(cellStatus('2026-09-20', { n: 12, dateOnly: 12 }, w)).toEqual({ status: 'approximate', via: 'sheet' });
    expect(cellStatus('2026-09-20', { n: 0, dateOnly: 0 }, w)).toEqual({ status: 'unknown', via: null });
  });
  it('stops counting n8n days as complete after the last successful sync while the sync is failing', () => {
    expect(cellStatus('2026-09-28', { n: 3, dateOnly: 0 }, { ...w, n8nUntil: '2026-09-26' })).toEqual({ status: 'approximate', via: 'sheet' });
  });
  it('uses Sent-folder coverage for campaigns sent through the mailbox API', () => {
    expect(cellStatus('2026-09-10', { n: 0, dateOnly: 0 }, { n8nFrom: null, n8nUntil: null, mailFrom: '2026-06-01' })).toEqual({ status: 'complete', via: 'mailbox' });
  });
});

describe('daily limit state', () => {
  const limit = { dailyLimit: 100, warnPct: 80 };
  it('warns from the warning level and flags anything over the limit', () => {
    expect(limitState(10, null)).toBe('none');
    expect(limitState(79, limit)).toBe('ok');
    expect(limitState(80, limit)).toBe('near');
    expect(limitState(100, limit)).toBe('near');
    expect(limitState(101, limit)).toBe('over');
  });
});

describe('n8n failure message', () => {
  it('prefers the workflow error, falls back to the first failing node, and redacts secrets', () => {
    expect(executionError({ id: 1, workflowId: 'w', data: { resultData: { error: { message: 'Invalid login: 535 5.7.8' } } } })).toBe('Invalid login: 535 5.7.8');
    const nodeLevel = {
      id: 2,
      workflowId: 'w',
      data: { resultData: { runData: { 'Send via Hostinger': [{ error: { message: 'Request failed, Authorization: Bearer abc.def.ghi' } }] } } },
    } as unknown as Parameters<typeof executionError>[0];
    expect(executionError(nodeLevel)).toBe('Send via Hostinger: Request failed, Authorization: Bearer [redacted]');
    expect(executionError({ id: 3, workflowId: 'w' })).toBeNull();
  });
});
