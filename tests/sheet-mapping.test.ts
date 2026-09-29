import { describe, expect, it } from 'vitest';
import { registry } from '@/lib/registry';
import { normalizeRowKey } from '@/lib/sync/record';
import { mapRows, sheetStateFor, touchRowOf } from '@/lib/sync/sheet-mapping';

const src = (key: string) => registry().sources.find((s) => s.key === key)!;

describe('sheet mapping', () => {
  it('normalizes Google Ads sheet statuses exactly as the dispatcher treats them', () => {
    const s = src('gads_outreach_sheet');
    expect(sheetStateFor(s, 'Approved')).toBe('queued');
    expect(sheetStateFor(s, 'Sent 2026-09-22T09:00:05.123+05:30')).toBe('sent');
    expect(sheetStateFor(s, 'Sent Tue 8:48pm IST (manual, scheduler failed silently)')).toBe('sent');
    expect(sheetStateFor(s, 'SEND FAILED - Forbidden')).toBe('failed');
    expect(sheetStateFor(s, 'Drafted - Awaiting Approval')).toBe('awaiting_approval');
    expect(sheetStateFor(s, '')).toBe('new');
    expect(sheetStateFor(s, 'something odd')).toBe('unknown');
    expect(sheetStateFor(s, 'Call list only')).toBe('excluded');
    expect(sheetStateFor(s, 'BOUNCED 2026-09-12: no such user (gmail) - Sent Tue 8:48pm IST (manual)')).toBe('bounced');
    expect(sheetStateFor(s, 'Sent 2026-09-10T10:00:00.000+05:30 - BOUNCED: recipient mailbox full')).toBe('bounced');
  });

  it('keeps the original send for rows later marked BOUNCED', () => {
    const [a, b] = mapRows(src('gads_outreach_sheet'), [
      { row_number: 2, LeadID: 'us-gads-9', Email: 'x@nine.example', Status: 'BOUNCED 2026-09-12: no such user - Sent 2026-09-08T20:48:00.000+05:30' },
      { row_number: 3, LeadID: 'us-gads-10', Email: 'y@ten.example', Status: 'BOUNCED 2026-09-12: 421 downstream server error - Sent Tue 8:51pm IST' },
    ]);
    expect(a.sheetState).toBe('bounced');
    expect(a.history).toHaveLength(1);
    expect(a.history[0]).toMatchObject({ result: 'accepted', timeQuality: 'exact' });
    expect(a.history[0].occurredAt?.toISOString()).toBe('2026-09-08T15:18:00.000Z');
    expect(b.history[0]).toMatchObject({ result: 'accepted', timeQuality: 'unknown', occurredAt: null });
  });

  it('keeps timestamps honest: exact only when the sheet has a full ISO timestamp', () => {
    const rows = mapRows(src('gads_outreach_sheet'), [
      { row_number: 2, LeadID: 'us-gads-1', Email: 'A@One.example', Status: 'Sent 2026-09-22T09:00:05.000+05:30', 'Send-from mailbox': 'ads@rohitkumarseo.tech' },
      { row_number: 3, LeadID: 'seo-two', Email: 'b@two.example', Status: 'Sent Tue 8:48pm IST (manual)' },
      { row_number: 4, LeadID: 'uk-gads-3', Email: 'c@three.example', Status: 'Approved', ScheduledSendISO: '' },
      { row_number: 5, LeadID: 'uk-gads-4', Email: 'd@four.example', Status: 'Approved', ScheduledSendISO: '2026-09-30T09:00:00+01:00' },
    ]);
    expect(rows[0].campaignSlug).toBe('google-ads-services-intl');
    expect(rows[0].emailNorm).toBe('a@one.example');
    expect(rows[0].history[0]).toMatchObject({ step: 0, result: 'accepted', timeQuality: 'exact', sender: 'ads@rohitkumarseo.tech' });
    expect(rows[1].campaignSlug).toBe('seo-visibility-us');
    expect(rows[1].history[0]).toMatchObject({ timeQuality: 'unknown', occurredAt: null });
    expect(rows[2].sheetState).toBe('ready'); // approved but unscheduled: the dispatcher skips it
    expect(rows[3].sheetState).toBe('queued');
    expect(rows[3].scheduledSendAt?.toISOString()).toBe('2026-09-30T08:00:00.000Z');
  });

  it('folds -fuN follow-up rows into their lead as steps 1..n', () => {
    const s = src('gads_outreach_sheet');
    const leads = mapRows(s, [
      { row_number: 2, LeadID: 'seo-acme', Email: 'hi@acme.example', Status: 'Sent 2026-09-01T10:00:00.000+05:30', 'Send-from mailbox': 'seo@rohitkumarseo.tech' },
      { row_number: 3, LeadID: 'seo-acme-fu1', Email: 'hi@acme.example', Status: 'Sent 2026-09-04T17:30:23.697+08:00' },
      { row_number: 4, LeadID: 'seo-acme-fu2', Email: 'hi@acme.example', Status: 'Approved', ScheduledSendISO: '2026-09-07T17:30:00+08:00' },
      { row_number: 5, LeadID: 'gads-orphan-fu1', Email: 'x@orphan.example', Status: 'Sent 2026-09-05T09:00:00Z' },
      { row_number: 6, LeadID: 'seo-bee-fu1', Email: 'b@bee.example', Status: 'REPLIED 2026-09-06 - Sent 2026-09-05T09:00:00Z' },
      { row_number: 7, LeadID: 'seo-bee', Email: 'b@bee.example', Status: 'Sent 2026-09-02T09:00:00Z' },
    ]);
    expect(leads).toHaveLength(3);
    const [acme, bee, orphan] = leads;
    expect(acme.rowKey).toBe('seo-acme');
    expect(acme.duplicateInSource).toBe(false);
    expect(acme.history.map((h) => [h.step, h.result, h.timeQuality])).toEqual([[0, 'accepted', 'exact'], [1, 'accepted', 'exact']]);
    expect(acme.history[1].idempotencyKey).toBe('sheet:gads_outreach_sheet:seo-acme:1:accepted');
    expect(acme.sourceNextTouchAt?.toISOString()).toBe('2026-09-07T09:30:00.000Z');
    expect(bee.sheetState).toBe('replied');
    expect(bee.history.map((h) => h.step)).toEqual([0, 1]);
    expect(orphan.rowKey).toBe('gads-orphan');
    expect(orphan.history.map((h) => h.step)).toEqual([1]);
    expect(touchRowOf(s, 'seo-fuel-co')).toBeNull();
    expect(normalizeRowKey(s, 'seo-acme-fu3')).toBe('seo-acme');
  });

  it('derives SEO audit sequence history from TouchNumber and SentAt', () => {
    const rows = mapRows(src('seo_audit_pipeline'), [
      { row_number: 2, LeadID: 'SAO-a', Email: 'a@x.example', Status: 'Approved', TouchNumber: 3, ScheduledSendAtUTC: '2026-10-02T04:00:00Z', SentAt: '2026-09-27T04:00:10.000+05:30', FromMailbox: 'info@rohitkumarseo.tech' },
      { row_number: 3, LeadID: 'SAO-b', Email: 'b@x.example', Status: 'Sequence Complete', TouchNumber: 4, SentAt: '2026-09-20T04:00:00Z' },
      { row_number: 4, LeadID: 'SAO-c', Email: 'c@x.example', Status: 'Drafted - Awaiting Approval', TouchNumber: 1 },
    ]);
    expect(rows[0].history.map((h) => [h.step, h.timeQuality])).toEqual([
      [0, 'unknown'],
      [1, 'exact'],
    ]);
    expect(rows[0].sourceNextTouchAt?.toISOString()).toBe('2026-10-02T04:00:00.000Z');
    expect(rows[1].history).toHaveLength(4);
    expect(rows[1].sheetState).toBe('completed');
    expect(rows[2].sheetState).toBe('awaiting_approval');
    expect(rows[2].history).toHaveLength(0);
  });

  it('parses agency sheet send records including the SMTP Message-ID written in Notes', () => {
    const rows = mapRows(src('agency_india_tracker'), [
      { row_number: 10, Email: 'hello@agency.example', Status: 'Sent', 'Date Sent': '2026-09-29', 'Send Date': '2026-09-29', Notes: 'Sent via agency2@adssuspensionrecovery.com, msg <abc-123@adssuspensionrecovery.com>' },
      { row_number: 11, Email: 'hello@agency.example', Status: 'Drafted (pending send)', 'Send Date': '2026-09-30' },
      { row_number: 12, Email: 'not-an-email', Status: 'Drafted (pending send)', 'Send Date': '2026-09-30' },
    ]);
    expect(rows[0].history[0]).toMatchObject({
      step: 0,
      timeQuality: 'date_only',
      messageId: '<abc-123@adssuspensionrecovery.com>',
      sender: 'agency2@adssuspensionrecovery.com',
    });
    expect(rows[1].duplicateInSource).toBe(true);
    expect(rows[1].rowKey).toBe('hello@agency.example#row11');
    expect(rows[2].emailValid).toBe(false);
  });

  it('expands RKD follow-up statuses into one event per step', () => {
    const rows = mapRows(src('aesthetic_clinics_sheet'), [
      { row_number: 2, 'Email Id': 'a@clinic.example', Status: 'FU2 Sent', Date: '2026-09-20' },
      { row_number: 3, 'Email Id': 'b@clinic.example', Status: '' },
    ]);
    expect(rows[0].history.map((h) => [h.step, h.timeQuality])).toEqual([
      [0, 'unknown'],
      [1, 'unknown'],
      [2, 'date_only'],
    ]);
    expect(rows[1].sheetState).toBe('ready');
  });

  it('applies the WAHA workflows\' own phone rules and requires a draft message', () => {
    const india = mapRows(src('wa_indian_business_sheet'), [
      { row_number: 2, Name: 'Clinic A', 'Mobile Number': '98765 43210', 'Draft Message': 'Hi', 'WhatsApp Outreach Status': '' },
      { row_number: 3, Name: 'Clinic B', 'Mobile Number': '12345', 'Draft Message': 'Hi', 'WhatsApp Outreach Status': '' },
      { row_number: 4, Name: 'Clinic C', 'Mobile Number': '9876500000', 'Draft Message': '', 'WhatsApp Outreach Status': '' },
      { row_number: 5, Name: 'Clinic D', 'Mobile Number': '9876511111', 'Draft Message': 'Hi', 'WhatsApp Outreach Status': 'Sent' },
    ]);
    expect(india.map((r) => [r.waChatId, r.sheetState])).toEqual([
      ['919876543210@c.us', 'ready'],
      [null, 'ready'],
      ['919876500000@c.us', 'new'],
      ['919876511111@c.us', 'sent'],
    ]);
    expect(india[3].history[0]).toMatchObject({ channel: 'whatsapp', recipient: '919876511111@c.us', timeQuality: 'unknown' });
    const uae = mapRows(src('wa_uae_towing_sheet'), [{ row_number: 2, Name: 'Tow', Phone: '50 123 4567', 'Draft Message': 'x', 'WhatsApp Outreach Status': '' }]);
    expect(uae[0].waChatId).toBe('971501234567@c.us');
  });

  it('counts AAR reminder stages as follow-up steps 1..n', () => {
    const rows = mapRows(src('aar_followup_queue'), [{ id: 7, email: 'lead@site.example', stage: 2, status: 'active', next_send_date: '2026-10-05' }]);
    expect(rows[0].history.map((h) => h.step)).toEqual([1, 2]);
    expect(rows[0].sourceNextTouchAt).not.toBeNull();
  });
});
