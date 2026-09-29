// Recomputes every lead's derived fields from the event tables. Idempotent; run after each sync.
import { q } from '../db';
import { registry } from '../registry';
import { finishRun, startRun } from './runs';

export const LEAD_STATUSES = [
  'ready',
  'awaiting_approval',
  'needs_draft',
  'queued',
  'sent',
  'followup_due',
  'replied',
  'positive',
  'not_interested',
  'bounced',
  'unsubscribed',
  'completed',
  'failed',
  'invalid',
  'duplicate',
  'excluded',
  'unknown',
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export async function deriveLeads(): Promise<void> {
  const runId = await startRun('derive');
  try {
    // 1. Duplicates inside a campaign: same email (email campaigns) or same WhatsApp chat.
    //    The row that was actually contacted (or the earliest row) stays primary.
    await q(
      `with ranked as (
         select l.id, first_value(l.id) over w as primary_id, row_number() over w as rn
           from leads l join campaigns c on c.id = l.campaign_id
          where (case when c.channel = 'whatsapp' then l.wa_chat_id else l.email_norm end) is not null
          window w as (partition by l.campaign_id, (case when c.channel = 'whatsapp' then l.wa_chat_id else l.email_norm end)
                       order by (exists (select 1 from send_attempts sa where sa.lead_id = l.id and sa.result = 'accepted')) desc,
                                l.present_in_source desc, l.source_row_number nulls last, l.id))
       update leads l set is_duplicate = (r.rn > 1), duplicate_of = case when r.rn > 1 then r.primary_id end
         from ranked r
        where l.id = r.id and (l.is_duplicate is distinct from (r.rn > 1) or l.duplicate_of is distinct from (case when r.rn > 1 then r.primary_id end))`,
    );

    // 2. Send aggregates (one row per step, so a send seen in n8n AND in the sheet counts once).
    await q(
      `with steps as (
         select lead_id, step,
                bool_or(result = 'accepted') as accepted,
                bool_or(result = 'failed') as failed,
                min(occurred_at) filter (where result = 'accepted') as first_at,
                max(occurred_at) filter (where result = 'accepted') as last_at
           from send_attempts where lead_id is not null group by lead_id, step),
       agg as (
         select lead_id,
                count(*) filter (where accepted)::int as sends,
                count(*) filter (where accepted and step > 0)::int as fus,
                max(step) filter (where accepted) as last_step,
                count(*) filter (where failed and not accepted)::int as failures,
                min(first_at) as first_at, max(last_at) as last_at
           from steps group by lead_id)
       update leads l set sends_accepted = coalesce(a.sends, 0), followups_accepted = coalesce(a.fus, 0), last_step = a.last_step,
              send_failures = coalesce(a.failures, 0), first_contacted_at = a.first_at, last_contacted_at = a.last_at
         from leads l2 left join agg a on a.lead_id = l2.id
        where l.id = l2.id
          and (l.sends_accepted, l.followups_accepted, l.last_step, l.send_failures, l.first_contacted_at, l.last_contacted_at)
              is distinct from (coalesce(a.sends, 0), coalesce(a.fus, 0), a.last_step, coalesce(a.failures, 0), a.first_at, a.last_at)`,
    );

    // 3. Replies (email + WhatsApp), latest classified sentiment, bounces, suppression.
    await q(
      `with em as (
         select lead_id, max(sent_at) as last_reply,
                (array_agg(sentiment order by sent_at desc) filter (where sentiment is not null))[1] as sentiment
           from mail_messages where is_outreach_reply and lead_id is not null group by lead_id),
       wa as (select lead_id, max(sent_at) as last_reply from wa_messages where not from_me and lead_id is not null group by lead_id),
       bo as (select lead_id, min(occurred_at) as at from bounces where lead_id is not null and bounce_type <> 'soft' group by lead_id),
       vals as (
         select l.id,
                greatest(em.last_reply, wa.last_reply) as last_reply,
                em.sentiment,
                bo.at as bounced_at,
                s.reason as supp_reason
           from leads l
           left join em on em.lead_id = l.id
           left join wa on wa.lead_id = l.id
           left join bo on bo.lead_id = l.id
           left join lateral (
             select reason from suppressions s
              where (s.channel = 'email' and s.value_norm = l.email_norm)
                 or (s.channel = 'whatsapp' and (s.value_norm = l.phone_norm or s.value_norm = split_part(l.wa_chat_id, '@', 1)))
              order by (reason = 'hard_bounce') limit 1) s on true)
       update leads l set last_reply_at = v.last_reply, reply_sentiment = v.sentiment, bounced_at = v.bounced_at,
              suppressed = coalesce((v.supp_reason is not null and v.supp_reason <> 'hard_bounce') or v.sentiment = 'unsubscribe', false),
              suppression_reason = case when v.sentiment = 'unsubscribe' then 'unsubscribed' else v.supp_reason end
         from vals v
        where l.id = v.id
          and (l.last_reply_at, l.reply_sentiment, l.bounced_at, l.suppression_reason, l.suppressed)
              is distinct from (v.last_reply, v.sentiment, v.bounced_at, case when v.sentiment = 'unsubscribe' then 'unsubscribed' else v.supp_reason end,
                                coalesce((v.supp_reason is not null and v.supp_reason <> 'hard_bounce') or v.sentiment = 'unsubscribe', false))`,
    );

    // 3b. Latest recorded business outcome (qualified / meeting booked / won / lost).
    await q(
      `with latest as (
         select distinct on (lead_id) lead_id, outcome, occurred_on
           from lead_outcomes order by lead_id, occurred_on desc, recorded_at desc, id desc)
       update leads l set outcome = x.outcome, outcome_on = x.occurred_on
         from (select l2.id, latest.outcome, latest.occurred_on from leads l2 left join latest on latest.lead_id = l2.id) x
        where l.id = x.id and (l.outcome, l.outcome_on) is distinct from (x.outcome, x.occurred_on)`,
    );

    // 4. Next follow-up per the campaign's real sequence rules (see config/registry.json).
    //    A lead with a recorded outcome (e.g. meeting booked, lost) gets no automatic follow-up date.
    for (const camp of registry().campaigns) {
      const f = camp.followup;
      let expr = 'null::timestamptz';
      if (f.mode === 'source_schedule') {
        expr = 'l.source_next_touch_at';
      } else if (f.mode === 'days_after_last' && f.cadenceDays?.length) {
        const cases = f.cadenceDays.map((d, i) => `when l.last_step = ${i} then l.last_contacted_at + interval '${Number(d)} days'`).join(' ');
        expr = `case ${cases} else null end`;
      }
      await q(
        `update leads l set next_followup_at = x.nf
           from (select l.id,
                   case when l.last_reply_at is not null or l.suppressed or l.bounced_at is not null or l.outcome is not null or l.sheet_state in ('replied', 'completed', 'bounced', 'excluded')
                        then l.manual_followup_at
                        else nullif(least(coalesce(${expr}, 'infinity'::timestamptz), coalesce(l.manual_followup_at, 'infinity'::timestamptz)), 'infinity'::timestamptz)
                   end as nf
                   from leads l join campaigns c on c.id = l.campaign_id where c.slug = $1) x
          where l.id = x.id and l.next_followup_at is distinct from x.nf`,
        [camp.slug],
      );
    }

    // 5. Status, in strict priority order. Every value is traceable to an event or a sheet state.
    const maxSteps = registry()
      .campaigns.filter((c) => c.followup.maxSteps !== undefined)
      .map((c) => `when c.slug = '${c.slug.replace(/'/g, "''")}' then ${Number(c.followup.maxSteps)}`)
      .join(' ');
    await q(
      `update leads l set status = x.st, updated_at = now()
         from (select l.id, case
                 when l.suppressed then 'unsubscribed'
                 when l.bounced_at is not null or l.sheet_state = 'bounced' then 'bounced'
                 when l.reply_sentiment = 'positive' then 'positive'
                 when l.reply_sentiment = 'not_interested' then 'not_interested'
                 when l.last_reply_at is not null or (l.sheet_state = 'replied' and l.sends_accepted > 0) then 'replied'
                 when l.is_duplicate and l.sends_accepted = 0 then 'duplicate'
                 when l.sends_accepted > 0 and l.next_followup_at is not null and l.next_followup_at <= now() then 'followup_due'
                 when l.sends_accepted > 0 and (l.sheet_state = 'completed' or l.last_step >= (case ${maxSteps || 'when false then 0'} else 999 end)) then 'completed'
                 when l.sends_accepted > 0 then 'sent'
                 when l.send_failures > 0 then 'failed'
                 when c.channel = 'email' and not coalesce(l.email_valid, false) then 'invalid'
                 when c.channel = 'whatsapp' and l.wa_chat_id is null then 'invalid'
                 when l.sheet_state = 'excluded' then 'excluded'
                 when l.sheet_state = 'queued' then 'queued'
                 when l.sheet_state = 'awaiting_approval' then 'awaiting_approval'
                 when l.sheet_state = 'ready' then 'ready'
                 when l.sheet_state = 'new' then 'needs_draft'
                 when l.sheet_state = 'completed' then 'completed'
                 else 'unknown' end as st
                 from leads l join campaigns c on c.id = l.campaign_id) x
        where l.id = x.id and l.status is distinct from x.st`,
    );

    // 6. Campaign start = first accepted send with a known time.
    await q(
      `update campaigns c set started_at = x.first_at
         from (select campaign_id, min(occurred_at) as first_at from send_attempts where result = 'accepted' and occurred_at is not null group by campaign_id) x
        where c.id = x.campaign_id and c.started_at is distinct from x.first_at`,
    );
    await finishRun(runId, 'success');
  } catch (err) {
    await finishRun(runId, 'error', {}, (err as Error).message);
    throw err;
  }
}
