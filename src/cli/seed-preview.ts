// Fills a *preview* database with clearly fake sample data so the layout can be reviewed
// before any real source is connected. Refuses to run against anything that is not
// explicitly a preview database.
import { env } from '../lib/env';
import { pool, q } from '../lib/db';
import { migrate } from '../lib/migrate';
import { registry } from '../lib/registry';
import { syncRegistry } from '../lib/registry/sync';
import { evaluateAlerts } from '../lib/alerts';
import { deriveLeads } from '../lib/sync/derive';
import { classifyInternal } from '../lib/sync/internal';
import { recordSendAttempt } from '../lib/sync/record';

let seed = 42;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
const DAY = 86400_000;

async function main() {
  const dbName = new URL(env.databaseUrl).pathname.slice(1);
  if (!env.previewMode || !/preview/i.test(dbName)) {
    console.error('Refusing to seed: set PREVIEW_MODE=true and use a database whose name contains "preview".');
    process.exit(1);
  }
  await migrate();
  await syncRegistry();
  await q(`truncate leads, send_attempts, mail_messages, bounces, wa_messages, wa_sessions, suppressions, sync_runs, integration_errors, mail_folders restart identity cascade`);
  const reg = registry();
  const now = Date.now();
  const cities = ['Sample City A', 'Sample City B', 'Sample City C'];

  for (const camp of reg.campaigns) {
    await q(`update campaigns set status = $2 where slug = $1`, [camp.slug, camp.slug === 'dubai-clinics-batch2' || camp.slug === 'aesthetic-clinics-rkd' ? 'paused' : 'active']);
  }
  const senders: Record<string, string[]> = {};
  for (const w of reg.workflows) {
    const slug = w.campaign.slug ?? 'google-ads-services-intl';
    senders[slug] = [...new Set([...(senders[slug] ?? []), ...w.sendNodes.map((n) => n.sender.const).filter((x): x is string => typeof x === 'string')])];
  }
  senders['google-ads-services-intl'] = ['ads@rohitkumarseo.tech', 'hello@rohitkumarseo.tech'];
  senders['seo-visibility-us'] = ['rohit@rohitkumarseo.tech'];
  senders['dubai-real-estate'] = ['hello@rohitkumarseo.tech', 'seo@rohitkumarseo.tech'];

  const sizes: Record<string, number> = {
    'google-ads-services-intl': 160,
    'seo-visibility-us': 40,
    'seo-audit-outreach': 90,
    'agency-outreach-india': 220,
    'aesthetic-clinics-rkd': 120,
    'dubai-real-estate': 60,
    'aar-scanner-followups': 25,
    'wa-dental-india': 80,
    'wa-dental-webdev': 50,
    'wa-dubai-car-recovery': 35,
  };
  const replyRate: Record<string, number> = { 'agency-outreach-india': 0.06, 'seo-audit-outreach': 0.09, 'google-ads-services-intl': 0.03, 'wa-dental-india': 0.12 };

  let uid = 1;
  for (const src of reg.sources) {
    const slug = typeof src.campaign === 'string' ? src.campaign : src.campaign.default;
    const camp = reg.campaigns.find((c) => c.slug === slug)!;
    const source = (await q<{ id: number }>(`select id from sources where key = $1`, [src.key]))[0];
    const n = sizes[slug] ?? 30;
    await q(`update sources set last_sync_at = now(), last_success_at = now() - interval '4 minutes', last_status = 'ok', row_count = $2, columns = $3 where id = $1`, [
      source.id,
      n,
      [src.columns.status, ...(src.columns.email ?? []), ...(src.columns.name ?? [])],
    ]);
    const cid = (await q<{ id: number }>(`select id from campaigns where slug = $1`, [slug]))[0].id;
    for (let i = 1; i <= n; i++) {
      const email = camp.channel === 'email' ? `lead${i}@${slug}-sample.invalid` : null;
      const phoneDigits = `9${String(100000000 + i * 7919).slice(0, 9)}`;
      const chat = camp.channel === 'whatsapp' ? `91${phoneDigits}@c.us` : null;
      const roll = rnd();
      const contacted = roll < 0.62;
      const state = contacted ? 'sent' : roll < 0.72 ? 'queued' : roll < 0.8 ? 'awaiting_approval' : roll < 0.9 ? 'ready' : roll < 0.95 ? 'new' : 'excluded';
      const invalid = camp.channel === 'email' && rnd() < 0.03;
      const lead = (
        await q<{ id: number }>(
          `insert into leads (campaign_id, source_id, source_row_key, source_row_number, name, email, email_norm, email_valid, phone, phone_norm, wa_chat_id, city,
             sheet_status, sheet_state, scheduled_date, planned_sender, raw)
           values ($1,$2,$3,$4,$5,$6,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'{"sample":true}') returning id`,
          [
            cid,
            source.id,
            email ?? phoneDigits,
            i + 1,
            `Sample Business ${i}`,
            invalid ? `broken-${i}` : email,
            !invalid,
            camp.channel === 'whatsapp' ? phoneDigits : null,
            camp.channel === 'whatsapp' ? phoneDigits : null,
            chat,
            pick(cities),
            state === 'sent' ? 'Sent' : state === 'queued' ? 'Approved' : state === 'awaiting_approval' ? 'Drafted - Awaiting Approval' : state === 'excluded' ? 'Skip' : '',
            state,
            state === 'queued' ? new Date(now + (rnd() < 0.5 ? DAY : 2 * DAY)).toISOString().slice(0, 10) : null,
            pick(senders[slug] ?? ['info@rohitkumarseo.tech']),
          ],
        )
      )[0];
      if (i % 37 === 0) {
        // a duplicate row of the previous lead
        await q(
          `insert into leads (campaign_id, source_id, source_row_key, source_row_number, name, email, email_norm, email_valid, wa_chat_id, sheet_status, sheet_state, raw)
           select campaign_id, source_id, source_row_key || '#dup', source_row_number + 1000, name, email, email_norm, email_valid, wa_chat_id, 'Approved', 'queued', raw from leads where id = $1`,
          [lead.id],
        );
      }
      if (!contacted || invalid) continue;
      const first = now - Math.floor(rnd() * 34 + 1) * DAY - Math.floor(rnd() * 8) * 3600_000;
      const steps = camp.followup.mode === 'none' ? 1 : 1 + Math.floor(rnd() * ((camp.followup.maxSteps ?? 2) + 1));
      const startStep = slug === 'aar-scanner-followups' ? 1 : 0;
      const sender = pick(senders[slug] ?? ['info@rohitkumarseo.tech']);
      let at = first;
      for (let s = startStep; s < startStep + steps; s++) {
        if (at > now) break;
        const failed = rnd() < 0.03;
        await recordSendAttempt({
          idempotencyKey: `preview:${lead.id}:${s}`,
          channel: camp.channel,
          campaignSlug: slug,
          leadId: lead.id,
          sender: camp.channel === 'email' ? sender : camp.waSession,
          recipient: email ?? chat!,
          step: s,
          result: failed ? 'failed' : 'accepted',
          provider: camp.channel === 'whatsapp' ? 'waha' : 'smtp',
          providerStatus: failed ? null : camp.channel === 'whatsapp' ? 'WAHA accepted (message key returned)' : '250 2.0.0 Ok: queued (sample)',
          errorMessage: failed ? 'Sample failure: 550 mailbox unavailable' : null,
          messageId: failed ? null : `<preview-${lead.id}-${s}@sample.invalid>`,
          subject: s === 0 ? `Quick question for Sample Business ${i}` : `Following up — Sample Business ${i}`,
          source: rnd() < 0.8 ? 'n8n_execution' : 'sheet_status',
          n8n: { workflowId: 'preview', executionId: String(lead.id * 10 + s), node: 'Send', runIndex: 0, itemIndex: 0 },
          occurredAt: new Date(at),
          timeQuality: 'exact',
          waAck: camp.channel === 'whatsapp' && !failed ? pick([1, 2, 2, 3]) : null,
        });
        at += (camp.followup.cadenceDays?.[s] ?? 4) * DAY;
      }
      const mbox = (await q<{ id: number }>(`select id from mailboxes where address = $1`, [sender]))[0]?.id;
      if (camp.channel === 'email' && mbox && rnd() < (replyRate[slug] ?? 0.05)) {
        const rAt = new Date(Math.min(now - 3600_000, first + (1 + rnd() * 5) * DAY));
        await q(
          `insert into mail_messages (mailbox_id, folder, uid, message_id, in_reply_to, direction, from_addr, from_name, to_addrs, counterpart, subject, sent_at, kind,
             lead_id, campaign_id, match_method, match_confidence, is_outreach_reply, sentiment, unseen, thread_key, body_text)
           values ($1,'INBOX',$2,$3,$4,'inbound',$5,$6,$7,$5,$8,$9,'message',$10,$11,'in_reply_to','high',true,$12,$13,$14,$15)`,
          [
            mbox,
            uid++,
            `<reply-${lead.id}@sample.invalid>`,
            `<preview-${lead.id}-0@sample.invalid>`,
            email,
            `Sample Owner ${i}`,
            [sender],
            `Re: Quick question for Sample Business ${i}`,
            rAt,
            lead.id,
            cid,
            pick(['positive', 'positive', 'neutral', 'not_interested', null]),
            rnd() < 0.3,
            `s:${email}|quick question for sample business ${i}`,
            'This is SAMPLE preview text. Thanks for reaching out — can you send more details?',
          ],
        );
      }
      if (camp.channel === 'email' && mbox && rnd() < 0.015) {
        const m = await q<{ id: number }>(
          `insert into mail_messages (mailbox_id, folder, uid, direction, from_addr, from_name, to_addrs, counterpart, subject, sent_at, kind, thread_key, lead_id, campaign_id)
           values ($1,'INBOX',$2,'inbound','mailer-daemon@sample.invalid','Mail Delivery System',$3,'mailer-daemon@sample.invalid','Undelivered Mail Returned to Sender',$4,'bounce',$5,$6,$7) returning id`,
          [mbox, uid++, [sender], new Date(first + 600_000), `s:bounce|${lead.id}`, lead.id, cid],
        );
        await q(`insert into bounces (mail_message_id, recipient_norm, bounce_type, status_code, occurred_at, lead_id, campaign_id) values ($1,$2,'hard','5.1.1',$3,$4,$5)`, [
          m[0].id,
          email,
          new Date(first + 600_000),
          lead.id,
          cid,
        ]);
      }
      if (camp.channel === 'whatsapp' && rnd() < (replyRate[slug] ?? 0.08)) {
        await q(
          `insert into wa_messages (session, message_id, chat_id, from_me, body, ack, sent_at, lead_id, campaign_id, source) values ($1,$2,$3,false,$4,null,$5,$6,$7,'waha_api')`,
          [camp.waSession, `preview-wa-${lead.id}`, chat, 'SAMPLE reply: please share the price list.', new Date(first + 5 * 3600_000), lead.id, cid],
        );
      }
    }
  }
  // Unmatched inbound + flagged thread samples
  const box = (await q<{ id: number }>(`select id from mailboxes where address = 'info@rohitkumarseo.tech'`))[0].id;
  for (let i = 0; i < 6; i++) {
    await q(
      `insert into mail_messages (mailbox_id, folder, uid, message_id, direction, from_addr, from_name, to_addrs, counterpart, subject, sent_at, kind, unseen, thread_key, needs_followup)
       values ($1,'INBOX',$2,$3,'inbound',$4,$5,'{info@rohitkumarseo.tech}',$4,$6,$7,'message',true,$8,$9)`,
      [box, uid++, `<unmatched-${i}@sample.invalid>`, `someone${i}@unknown-sample.invalid`, `Sample Sender ${i}`, `Sample enquiry ${i}`, new Date(now - i * 7 * 3600_000), `s:someone${i}|sample enquiry ${i}`, i === 0],
    );
  }
  await q(`insert into suppressions (channel, value_norm, reason, source, note) values ('email','optout@agency-outreach-india-sample.invalid','unsubscribed','manual','SAMPLE')`);
  await q(`insert into mail_folders (mailbox_id, path, name, special_use, message_count, unread_count) select id, 'INBOX', 'INBOX', null, 40, 3 from mailboxes on conflict do nothing`);
  await q(`insert into mail_folders (mailbox_id, path, name, special_use, message_count, unread_count) select id, 'INBOX.Sent', 'Sent', '\\Sent', 120, 0 from mailboxes on conflict do nothing`);
  await q(`insert into mail_folders (mailbox_id, path, name, special_use, message_count, unread_count) select id, 'INBOX.Spam', 'Spam', '\\Junk', 4, 1 from mailboxes on conflict do nothing`);
  await q(
    `update mailboxes set provider = case when domain = 'rohitkumarseo.tech' then 'hostinger_api' else 'imap' end,
       last_status = case when address like 'sales%' then 'not_connected' else 'ok' end,
       last_error = case when address like 'sales%' then 'Not connected: no Hostinger Email API token covers this mailbox and no IMAP credentials are configured.' end,
       last_sync_at = now(), last_success_at = case when address like 'sales%' then null else now() - interval '6 minutes' end`,
  );
  await q(`update sources set last_sync_at = now(), last_success_at = now() - interval '3 minutes', last_status = 'ok' where key in ('n8n:executions','n8n:bridge','n8n:workflows','waha')`);
  await q(`insert into wa_sessions (name, status, phone, last_sync_at) values ('default','WORKING','910000000001',now()),('outreach2','WORKING','910000000002',now()),('dubai_car_recovery','SCAN_QR_CODE',null,now())`);
  await q(`insert into sync_runs (job, source_key, started_at, finished_at, status, items_seen, items_written) values
    ('sheets','n8n:bridge', now() - interval '4 minutes', now() - interval '3 minutes', 'success', 880, 540),
    ('n8n_executions','n8n:executions', now() - interval '2 minutes', now() - interval '2 minutes', 'success', 96, 12),
    ('mailboxes','mailboxes', now() - interval '6 minutes', now() - interval '5 minutes', 'partial', 19, 44)`);
  await q(`insert into integration_errors (source_key, severity, message, fingerprint) values ('waha:sessions','warning','SAMPLE: WhatsApp sessions not working: dubai_car_recovery=SCAN_QR_CODE','preview-1')`);
  // Alerts, limits, outcomes and coverage samples.
  await q(`insert into n8n_workflows (id, name, active, tracked) values ('sUMZ8H5bkSyFPWZm', 'AAR Follow-up Sender (SAMPLE)', true, true) on conflict (id) do nothing`);
  await q(
    `insert into n8n_executions (execution_id, workflow_id, status, started_at, final, error_message) values
       ('sample-1', 'sUMZ8H5bkSyFPWZm', 'success', now() - interval '6 days', true, null),
       ('sample-2', 'sUMZ8H5bkSyFPWZm', 'error', now() - interval '5 hours', true, 'SAMPLE: Send Followup Email: Invalid login: 535 5.7.8 authentication failed')
     on conflict do nothing`,
  );
  await q(`insert into send_limits (scope, key, daily_limit, warn_pct, updated_by) values ('mailbox', 'ads@rohitkumarseo.tech', 40, 80, 'preview'), ('domain', 'rohitkumarseo.tech', 400, 80, 'preview') on conflict do nothing`);
  const contacted = await q<{ id: number; campaign_id: number }>(
    `select id, campaign_id from leads where sends_accepted > 0 or id in (select lead_id from send_attempts where result = 'accepted' and lead_id is not null) order by id limit 8`,
  );
  const plan: [string, number | null][] = [
    ['meeting_booked', null],
    ['won', 45000],
    ['qualified', null],
    ['lost', null],
    ['won', 120000],
    ['meeting_booked', null],
  ];
  for (let i = 0; i < Math.min(plan.length, contacted.length); i++) {
    const [outcome, value] = plan[i];
    await q(
      `insert into lead_outcomes (lead_id, campaign_id, outcome, occurred_on, value, currency, note, recorded_by)
       values ($1, $2, $3, current_date - $4::int, $5, $6, 'SAMPLE outcome', 'preview')`,
      [contacted[i].id, contacted[i].campaign_id, outcome, i, value, value ? 'INR' : null],
    );
  }
  // Inbox samples: internal mail, a snoozed conversation, a reply sent from the dashboard, a hidden WhatsApp number.
  const seoBox = (await q<{ id: number }>(`select id from mailboxes where address = 'seo@rohitkumarseo.tech'`))[0].id;
  await q(
    `insert into mail_messages (mailbox_id, folder, uid, message_id, direction, from_addr, from_name, to_addrs, counterpart, subject, sent_at, kind, unseen, thread_key, body_text, body_fetched_at)
     values ($1,'INBOX.Sent',$2,'<digest@sample.invalid>','outbound','seo@rohitkumarseo.tech','Outreach Dispatcher','{owner@sample.invalid}','owner@sample.invalid',
             'Daily Outreach Summary - SAMPLE (42 sent)', now() - interval '3 hours','message',false,'s:owner@sample.invalid|daily outreach summary','SAMPLE digest: 42 sent in the last 24h.', now()),
            ($1,'INBOX',$3,'<test@sample.invalid>','inbound','harry@rkdigitalmedia.in','Harry','{seo@rohitkumarseo.tech}','harry@rkdigitalmedia.in',
             'Test', now() - interval '2 hours','message',true,'s:harry@rkdigitalmedia.in|test','SAMPLE test message between our own mailboxes.', now())`,
    [seoBox, uid++, uid++],
  );
  await classifyInternal();
  const replyThreads = await q<{ thread_key: string; mailbox_id: number; from_addr: string; lead_id: number; campaign_id: number; id: number }>(
    `select thread_key, mailbox_id, from_addr, lead_id, campaign_id, id from mail_messages where is_outreach_reply order by sent_at desc limit 3`,
  );
  if (replyThreads[1]) {
    await q(`insert into inbox_threads (thread_key, snoozed_until, snoozed_at, updated_by) values ($1, now() + interval '1 day', now(), 'preview')`, [replyThreads[1].thread_key]);
  }
  if (replyThreads[2]) {
    const r = replyThreads[2];
    await q(
      `insert into mail_replies (idempotency_key, thread_key, source_message_id, mailbox_id, from_addr, to_addrs, subject, body_text, body_hash, lead_id, campaign_id,
         status, provider, provider_status, created_by, sent_at)
       values ('preview-reply-1', $1, $2, $3, (select address from mailboxes where id = $3), $4, 'Re: SAMPLE', 'SAMPLE: Thanks! Does Thursday 4 pm IST work for a quick call?',
               'preview', $5, $6, 'sent', 'hostinger_api', 'HTTP 204', 'preview', now() - interval '20 minutes')`,
      [r.thread_key, r.id, r.mailbox_id, [r.from_addr], r.lead_id, r.campaign_id],
    );
  }
  await q(
    `insert into wa_messages (session, message_id, chat_id, from_me, body, sent_at, source) values
       ('default', 'false_999000111222333@lid_SAMPLE1', '999000111222333@lid', false, 'SAMPLE: We''re unavailable right now, but will respond as soon as possible.', now() - interval '1 day', 'n8n_webhook')`,
  );
  await q(`insert into wa_contacts (chat_id, phone, name, source) values ('999000111222333@lid', null, 'Sample Clinic (SAMPLE)', 'webhook')`);
  await deriveLeads();
  await evaluateAlerts();
  console.log('Preview database seeded with SAMPLE data.');
  await pool().end();
}

main().catch(async (err) => {
  console.error(err);
  await pool().end();
  process.exit(1);
});
