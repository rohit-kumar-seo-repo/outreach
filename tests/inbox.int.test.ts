// Inbox triage, reply sending (with a fake provider) and WhatsApp number resolution against a real
// Postgres (set TEST_DATABASE_URL; skipped otherwise).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MailProvider, OutgoingReply, SendOutcome } from '@/lib/sync/mail-types';

const TEST_DB = process.env.TEST_DATABASE_URL;
const d = TEST_DB ? describe : describe.skip;

d('inbox, replies and WhatsApp numbers', () => {
  let db: typeof import('@/lib/db');

  beforeAll(async () => {
    process.env.DATABASE_URL = TEST_DB;
    process.env.APP_TIMEZONE = 'Asia/Kolkata';
    process.env.ADMIN_EMAIL = 'owner@gmail.example';
    db = await import('@/lib/db');
    await db.q('drop schema public cascade');
    await db.q('create schema public');
    const { migrate } = await import('@/lib/migrate');
    await migrate(() => undefined);
    const { syncRegistry } = await import('@/lib/registry/sync');
    await syncRegistry();
  });

  afterAll(async () => {
    await db?.pool().end();
  });

  function fakeProvider(address: string, outcome: SendOutcome, sent: OutgoingReply[]): MailProvider {
    return {
      kind: 'hostinger_api',
      address,
      listFolders: async () => [],
      fetchHeaders: async () => [],
      recentFlags: async () => [],
      fetchBody: async () => ({ text: '', html: '' }),
      fetchSource: async () => '',
      sendReply: async (msg) => {
        sent.push(msg);
        return outcome;
      },
      close: async () => undefined,
    };
  }

  it('finds replies that need an answer, sends one safely, and records it against the lead', async () => {
    const { q, one } = db;
    const { recordSendAttempt } = await import('@/lib/sync/record');
    const { runMatching } = await import('@/lib/sync/matching');
    const { deriveLeads } = await import('@/lib/sync/derive');
    const { inboxCounts, listThreads } = await import('@/lib/metrics/inbox');
    const { sendReply, replyContext } = await import('@/lib/mail/reply');

    await q(`update mailboxes set provider = 'hostinger_api', last_status = 'ok' where address in ('seo@rohitkumarseo.tech', 'ads@rohitkumarseo.tech')`);
    const seo = (await one<{ id: number }>(`select id from mailboxes where address = 'seo@rohitkumarseo.tech'`))!.id;
    const camp = (await one<{ id: number }>(`select id from campaigns where slug = 'seo-visibility-us'`))!.id;
    const lead = (await one<{ id: number }>(
      `insert into leads (campaign_id, source_row_key, name, email, email_norm, email_valid, status) values ($1, 'bp', 'BrightPath Media', 'sarah@brightpath.example', 'sarah@brightpath.example', true, 'sent') returning id`,
      [camp],
    ))!.id;
    const sentAt = new Date(Date.now() - 2 * 86_400_000);
    await recordSendAttempt({
      idempotencyKey: 'n8n:bp:0',
      channel: 'email',
      campaignSlug: 'seo-visibility-us',
      leadId: lead,
      sender: 'seo@rohitkumarseo.tech',
      recipient: 'sarah@brightpath.example',
      step: 0,
      result: 'accepted',
      source: 'n8n_execution',
      occurredAt: sentAt,
      timeQuality: 'exact',
      messageId: '<plan-1@rohitkumarseo.tech>',
      subject: 'SEO growth plan for BrightPath',
    });
    const ins = (folder: string, uid: number, o: Record<string, unknown>) =>
      q(
        `insert into mail_messages (mailbox_id, folder, uid, message_id, in_reply_to, thread_key, direction, from_addr, from_name, to_addrs, counterpart, subject, sent_at, unseen, kind)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [seo, folder, uid, o.mid, o.irt ?? null, o.tk, o.dir, o.from, o.name ?? null, o.to, o.cp, o.subj, o.at, o.unseen ?? false, o.kind ?? 'message'],
      );
    // Their reply (unread), threaded to our send.
    await ins('INBOX', 11, {
      mid: '<r1@brightpath.example>',
      irt: '<plan-1@rohitkumarseo.tech>',
      tk: 's:sarah@brightpath.example|seo growth plan for brightpath',
      dir: 'inbound',
      from: 'sarah@brightpath.example',
      name: 'Sarah Chen',
      to: ['seo@rohitkumarseo.tech'],
      cp: 'sarah@brightpath.example',
      subj: 'Re: SEO growth plan for BrightPath',
      at: new Date(Date.now() - 3600_000),
      unseen: true,
    });
    // Internal mail: the daily digest to the owner, and a test between our own mailboxes.
    await ins('INBOX.Sent', 12, { mid: '<digest@rohitkumarseo.tech>', tk: 's:me@gmail.example|daily', dir: 'outbound', from: 'seo@rohitkumarseo.tech', to: ['me@gmail.example'], cp: 'me@gmail.example', subj: 'Daily Outreach Summary - 2026-09-29 (5 sent)', at: new Date() });
    await ins('INBOX', 13, { mid: '<t@rkdigitalmedia.in>', tk: 's:harry@rkdigitalmedia.in|test', dir: 'inbound', from: 'harry@rkdigitalmedia.in', to: ['seo@rohitkumarseo.tech'], cp: 'harry@rkdigitalmedia.in', subj: 'Test', at: new Date(), unseen: true });
    await runMatching();
    await deriveLeads();

    expect((await q<{ kind: string }>(`select kind from mail_messages where uid in (12, 13) order by uid`)).map((r) => r.kind)).toEqual(['internal', 'internal']);
    const counts = await inboxCounts({});
    expect(counts.needsReply).toBe(1);
    expect(counts.internalUnread).toBe(1);
    const needs = await listThreads({ view: 'needs_reply' });
    expect(needs.rows).toHaveLength(1);
    expect(needs.rows[0]).toMatchObject({ leadId: lead, campaignName: expect.any(String), awaiting: true, unread: 1, fromName: 'Sarah Chen' });
    const thread = needs.rows[0].threadKey;
    expect((await listThreads({ view: 'needs_reply', domain: 'rkdigitalmedia.in' })).rows).toHaveLength(0);
    expect((await listThreads({ view: 'needs_reply', search: 'brightpath' })).rows).toHaveLength(1);

    // Sender rules: the receiving mailbox is the default; a mailbox without a copy cannot send.
    const ctx = await replyContext(thread);
    expect(ctx.defaultFrom).toBe('seo@rohitkumarseo.tech');
    expect(ctx.defaultTo).toEqual(['sarah@brightpath.example']);
    expect(ctx.subject).toBe('Re: SEO growth plan for BrightPath');
    expect(ctx.options.find((o) => o.address === 'ads@rohitkumarseo.tech')).toMatchObject({ canSend: false });
    const sent: OutgoingReply[] = [];
    const ok = fakeProvider('seo@rohitkumarseo.tech', { result: 'sent', status: 'HTTP 204', error: null }, sent);
    const req = { idempotencyKey: 'k-0000000000000001', threadKey: thread, from: 'seo@rohitkumarseo.tech', to: 'sarah@brightpath.example', cc: '', body: 'Happy to talk — does Thursday work?' };
    expect((await sendReply({ ...req, from: 'ads@rohitkumarseo.tech' }, 'owner', async () => ok)).status).toBe('rejected');
    expect(sent).toHaveLength(0);

    const res = await sendReply(req, 'owner', async () => ok);
    expect(res.status).toBe('sent');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: ['sarah@brightpath.example'], subject: 'Re: SEO growth plan for BrightPath', inReplyTo: { folder: 'INBOX', uid: 11 } });

    // Double submit (same key) and the same text again: never sent twice.
    expect((await sendReply(req, 'owner', async () => ok)).status).toBe('sent');
    expect((await sendReply({ ...req, idempotencyKey: 'k-0000000000000002' }, 'owner', async () => ok)).status).toBe('rejected');
    expect(sent).toHaveLength(1);

    await deriveLeads();
    expect((await inboxCounts({})).needsReply).toBe(0);
    expect(await one(`select status, last_response_at is not null as responded, next_followup_at from leads where id = $1`, [lead])).toEqual({
      status: 'in_conversation',
      responded: true,
      next_followup_at: null,
    });
    expect((await one<{ n: number }>(`select count(*)::int as n from audit_log where action = 'send_reply'`))!.n).toBe(1);
    expect((await one<{ unread: boolean }>(`select coalesce(not read_override, unseen) as unread from mail_messages where uid = 11`))!.unread).toBe(false);

    // The Sent-folder copy appears at the next sync: linked to the reply, never counted as an outreach send.
    const attemptsBefore = (await one<{ n: number }>('select count(*)::int as n from send_attempts'))!.n;
    await ins('INBOX.Sent', 14, {
      mid: '<rep-1@rohitkumarseo.tech>',
      irt: '<r1@brightpath.example>',
      tk: 's:sarah@brightpath.example|seo growth plan for brightpath',
      dir: 'outbound',
      from: 'seo@rohitkumarseo.tech',
      to: ['sarah@brightpath.example'],
      cp: 'sarah@brightpath.example',
      subj: 'Re: SEO growth plan for BrightPath',
      at: new Date(),
    });
    await runMatching();
    expect(await one(`select status, mail_message_id is not null as linked from mail_replies`)).toEqual({ status: 'sent', linked: true });
    expect((await one<{ n: number }>('select count(*)::int as n from send_attempts'))!.n).toBe(attemptsBefore);

    // A refused send is recorded as failed; a hard-bounced recipient is blocked before sending.
    const refused = fakeProvider('seo@rohitkumarseo.tech', { result: 'failed', status: 'HTTP 403', error: 'ERR_FORBIDDEN Forbidden.' }, sent);
    const fail = await sendReply({ ...req, idempotencyKey: 'k-0000000000000003', body: 'Second note' }, 'owner', async () => refused);
    expect(fail.status).toBe('failed');
    await q(`insert into suppressions (channel, value_norm, reason, source) values ('email', 'gone@brightpath.example', 'hard_bounce', 'bounce')`);
    expect((await sendReply({ ...req, idempotencyKey: 'k-0000000000000004', to: 'gone@brightpath.example', body: 'x' }, 'owner', async () => ok)).status).toBe('rejected');

    // Snooze: hidden from Needs reply until it returns, or until they write again.
    await ins('INBOX', 15, {
      mid: '<r2@brightpath.example>',
      irt: '<rep-1@rohitkumarseo.tech>',
      tk: 's:sarah@brightpath.example|seo growth plan for brightpath',
      dir: 'inbound',
      from: 'sarah@brightpath.example',
      to: ['seo@rohitkumarseo.tech'],
      cp: 'sarah@brightpath.example',
      subj: 'Re: SEO growth plan for BrightPath',
      at: new Date(Date.now() + 60_000),
      unseen: true,
    });
    await runMatching();
    expect((await inboxCounts({})).needsReply).toBe(1);
    await q(`insert into inbox_threads (thread_key, snoozed_until, snoozed_at) values ($1, now() + interval '1 day', now() + interval '2 minutes')`, [thread]);
    expect(await inboxCounts({})).toMatchObject({ needsReply: 0, snoozed: 1 });
    expect((await listThreads({ view: 'snoozed' })).rows[0]?.threadKey).toBe(thread);
  });

  it('shows the real WhatsApp number for privacy-ID chats, links them to the lead, and ignores automatic greetings', async () => {
    const { q, one } = db;
    const { recordWaMessage, reconcileWhatsApp } = await import('@/lib/sync/wa-store');
    const { recordSendAttempt } = await import('@/lib/sync/record');
    const camp = (await one<{ id: number }>(`select id from campaigns where slug = 'wa-dental-india'`))!.id;
    const lead = (await one<{ id: number }>(
      `insert into leads (campaign_id, source_row_key, name, phone, phone_norm, wa_chat_id, status) values ($1, 'ds', 'Dental Smiles', '9871530594', '9871530594', '919871530594@c.us', 'sent') returning id`,
      [camp],
    ))!.id;
    const sentAt = new Date(Date.now() - 10 * 60_000);
    await recordSendAttempt({
      idempotencyKey: 'waha:ds:0',
      channel: 'whatsapp',
      campaignSlug: 'wa-dental-india',
      leadId: lead,
      recipient: '919871530594@c.us',
      step: 0,
      result: 'accepted',
      source: 'n8n_execution',
      occurredAt: sentAt,
      timeQuality: 'exact',
    });
    // Greeting 20 s after our message, then a real reply, both addressed by the privacy ID.
    await recordWaMessage({
      session: 'default',
      messageId: 'false_271549709951039@lid_AAAA1111BBBB',
      chatId: '271549709951039@lid',
      fromMe: false,
      body: 'Thank you for contacting Dental Smiles..dental & skin clinic',
      hasMedia: false,
      ack: null,
      sentAt: new Date(sentAt.getTime() + 20_000),
      source: 'n8n_webhook',
      phone: '919871530594',
      contactName: 'Dental Smiles',
    });
    await recordWaMessage({
      session: 'default',
      messageId: 'false_271549709951039@lid_CCCC2222DDDD',
      chatId: '271549709951039@lid',
      fromMe: false,
      body: 'Yes, please share the website proposal',
      hasMedia: false,
      ack: null,
      sentAt: new Date(sentAt.getTime() + 5 * 60_000),
      source: 'n8n_webhook',
    });
    // The same message later fetched from WAHA under the number: stored once.
    await recordWaMessage({
      session: 'default',
      messageId: 'false_919871530594@c.us_CCCC2222DDDD',
      chatId: '919871530594@c.us',
      fromMe: false,
      body: 'Yes, please share the website proposal',
      hasMedia: false,
      ack: null,
      sentAt: new Date(sentAt.getTime() + 5 * 60_000),
      source: 'waha_api',
    });
    await reconcileWhatsApp();
    const rows = await q<{ chat_id: string; lead_id: number; is_auto: boolean }>(`select chat_id, lead_id, is_auto from wa_messages order by sent_at`);
    expect(rows).toEqual([
      { chat_id: '919871530594@c.us', lead_id: lead, is_auto: true },
      { chat_id: '919871530594@c.us', lead_id: lead, is_auto: false },
    ]);
    expect((await one<{ n: number }>(`select count(*)::int as n from v_replies where channel = 'whatsapp'`))!.n).toBe(1);
    const { waConversations } = await import('@/lib/metrics/whatsapp');
    const [conv] = await waConversations();
    expect(conv).toMatchObject({ phone: '919871530594', hiddenNumber: false, leadName: 'Dental Smiles', inbound: 1, autoReplies: 1 });
  });
});
