# How every number is calculated

All counts come from four SQL views in `db/migrations/002_metric_views.sql`. The dashboard, the CSV exports and the reports all read from these views. Days are calendar days in `APP_TIMEZONE` (Asia/Kolkata by default).

## Core definitions

| Term | Definition |
|---|---|
| **Send attempt** | One row in `send_attempts`. Each attempt is written by one source (see "Sources of a send" below). `idempotency_key` makes re-syncs safe: the same event can never be stored twice. |
| **Send** (`v_sends`) | One distinct *(campaign, recipient, step)* that a server **accepted**. Step 0 is the first email; steps 1+ are follow-ups. When several sources report the same send, it counts once, timed by the most precise source (`exact` > `date_only` > `unknown`). |
| **Failed send** (`v_failed_sends`) | A *(campaign, recipient, step)* that failed and was never accepted later. A retry that succeeds removes the failure. |
| **Reply** (`v_replies`) | An inbound email matched to a contacted lead (`is_outreach_reply`), counted once per Message-ID across folders and mailboxes. Or an inbound WhatsApp message from a lead, received after the first outreach message to them. |
| **Bounce** (`v_bounces`) | A delivery-status notification parsed from a synced mailbox. Counted once per recipient per day. A hard bounce also adds the address to suppressions. A sheet row marked "BOUNCED" sets the lead's status to Bounced, but it is not counted here: the Bounces KPI only counts bounces seen in mailboxes. |

### Sources of a send

| Source | What it records |
|---|---|
| `n8n_execution` | n8n's own record of an HTTP or SMTP send node. |
| `n8n_push` | Events pushed to `/api/ingest/n8n`. |
| `sheet_status` | The sheet's "Sent …" or `Date Sent` value. |
| `mailbox_sent` | A copy of the message in a synced Sent folder. |
| `manual` | Entered by hand. |

### Time quality

Every send carries one of these, and the UI labels it:

- **exact**: a real timestamp (n8n execution, ISO timestamp in the sheet, or Sent-folder copy).
- **date_only**: the sheet only has a date. The send is placed at 12:00 local time on that day.
- **unknown**: the source recorded "sent" without any date. These sends are counted in totals and campaign stats, but never in a per-day number. Charts show them in a separate "date unknown" note.

## Delivery funnel (Overview)

Each stage is shown separately, and a stage is never presented as a later one.

| Stage | Meaning |
|---|---|
| **Scheduled** | Leads with a future `ScheduledSendISO` / `Send Date` in their sheet (queued or approved). |
| **Attempted** | Accepted sends + failed sends. |
| **Accepted** | `v_sends`: the mail API returned success (HTTP 2xx or SMTP 250), or WAHA returned a message key. This is **not** delivery. |
| **Bounced** | Accepted sends to a recipient who later bounced. |
| **Confirmed** | Accepted sends that have evidence of delivery: a reply (email), or a WhatsApp ack of 2 (delivered) or higher. |
| **Unverified** | Accepted − bounced − confirmed. There is no evidence either way. Email offers no reliable delivery receipt, so most email sends end up here. |

Opens and clicks are not tracked. Nothing on the dashboard is called a "success" based on opens.

## Overview KPIs

| KPI | Definition |
|---|---|
| Sent today | `v_sends`, step 0, known time, local date = today |
| Follow-ups sent today | `v_sends`, step > 0, known time, local date = today |
| Replies today | `v_replies`, email; WhatsApp is shown separately |
| Scheduled tomorrow | Leads whose `scheduled_send_at` / `scheduled_date` falls on tomorrow's local date |
| Follow-ups due / overdue | Leads with `next_followup_at` on or before today, excluding leads that replied, bounced, were suppressed or completed. See "Follow-up rules" below. |
| Bounces / failed today | `v_bounces` / `v_failed_sends` with a known time today |
| Active campaigns | Campaigns whose n8n sender workflow is active. If the workflow state can't be read, the status is "unknown", not "active". |
| Leads ready / remaining | Leads still in the sheet with status Ready, Queued, Awaiting approval, Needs draft or Failed |

### Follow-up rules

`next_followup_at` comes from each campaign's rule in `config/registry.json`:

- `source_schedule`: the sheet's own next-touch time.
  - SEO Audit: the next `ScheduledSendAtUTC`.
  - Google Ads / SEO Visibility: the earliest approved `-fuN` row.
  - AAR: `next_send_date`.
- `days_after_last`: RKD cadence of 3, 7 and 14 days after the previous touch.
- `none`: no follow-up workflow exists, so none are ever "due".
- A manual follow-up date set on a lead overrides the rule.

## Campaign metrics

Every rate is shown as **numerator / denominator** next to the percentage.

| Metric | Numerator | Denominator |
|---|---|---|
| Reply rate | Contacted leads with ≥ 1 reply | Contacted leads (≥ 1 accepted send) |
| Positive rate | Contacted leads with a reply marked positive | Contacted leads |
| Bounce rate | Contacted leads that bounced | Contacted leads |
| Reply after follow-up | Leads whose first reply came after their first follow-up | Leads that received ≥ 1 follow-up. Shown as "Not measurable" when this is 0. |

Failed sends are shown as a count ("failed, never accepted"), not as a rate.

Cohort mode ("leads first contacted in the date range") only counts sends linked to a lead.

## Lead status

Each lead's status is derived in this priority order (`src/lib/sync/derive.ts`):

1. Unsubscribed / suppressed
2. Bounced (a mailbox bounce, or the sheet says BOUNCED)
3. Positive reply
4. Not interested
5. Replied
6. Duplicate (an earlier row has the same address)
7. Follow-up due
8. Completed (the campaign's `maxSteps` has been reached, or the sheet says complete)
9. Email sent
10. Failed
11. Invalid address
12. Excluded (e.g. "Call list only", "Invalid email – excluded")
13. Queued
14. Awaiting approval
15. Ready
16. Needs draft

Every status can be traced to an event or to a sheet value.

## Spreadsheet capacity

For each source:

- **Rows** = rows currently present in the sheet.
- **Contacted** = rows linked to ≥ 1 accepted send. A sheet status alone does not make a row contacted.
- **Remaining** = rows in Ready + Queued + Awaiting approval + Needs draft + Failed.
- **Excluded** = invalid, duplicate, do-not-contact and call-list-only rows.

Each source card shows its column mapping and status rules, so you can check the numbers against the sheet yourself.

Follow-up rows (Google Ads sheet LeadIDs ending in `-fu1`, `-fu2`, `-fu3`) are counted as steps of the lead they belong to, not as extra leads.
