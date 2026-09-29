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
| Qualified rate | Contacted leads ever marked qualified, meeting booked or won | Contacted leads |
| Meeting rate | Contacted leads ever marked meeting booked or won | Contacted leads |
| Won | Contacted leads whose latest outcome is won (count, not a rate) | — |

Failed sends are shown as a count ("failed, never accepted"), not as a rate.

"Best business results so far" on the Campaigns page ranks campaigns by meeting rate once any outcome has been recorded. Until then it falls back to reply rate and says so. Opens are never used.

## Business outcomes

Outcomes are recorded by hand on a lead's page (Leads → a lead → **Business outcome**): qualified, meeting booked, won or lost, with the date it happened. A won outcome can carry a deal value and currency.

- Every entry is kept, so a lead can move qualified → meeting booked → won. The lead's current outcome is its latest entry by date (`leads.outcome`).
- Entries are counted under the lead's campaign.
- Only contacted leads count in campaign results. An outcome on a lead with no accepted send is stored but shown with a warning.
- **Won value** is the sum of each won lead's latest won entry, shown per currency and never converted.
- **Lost** counts leads whose latest outcome is lost.
- A lead with any outcome is no longer counted as "follow-up due". The dashboard never stops or starts a sequence in n8n.
- Every entry and removal is written to the audit log.

## Sending volume

Sending volume shows per mailbox and per domain, per local day (`APP_TIMEZONE`).

**Daily total = outreach sends + other sent mail.**

- **Outreach sends** are accepted email sends, deduplicated across n8n runs, sheets and Sent folders.
  - Sends with no known date are left out of the daily numbers.
  - A day marked `*` includes sends dated only by a sheet, with no time.
- **Other sent mail** is every message in the mailbox's Sent folders that is not linked to an outreach send, such as manual replies or digests. Providers limit all outgoing mail, so it counts.
- Sends made over SMTP leave no Sent-folder copy. They appear only when n8n or a sheet records them.
- A send whose sender was never recorded is shown as "Sender not recorded".

**Limits** are set on the Sending volume page, per mailbox or per domain. Each limit has a daily maximum and a warning level (80% by default).

| State | Rule |
|---|---|
| No limit set | No limit is configured |
| Within limit | Today's total is below the warning level |
| Near limit | Today's total is at or above the warning level and at or below the limit |
| Over limit | Today's total is above the limit |

Limits only raise alerts. The dashboard never pauses sending.

## Alerts

The worker checks these rules every 5 minutes (`SYNC_ALERTS_SECONDS`), and **Check now** on the Alerts page runs them immediately.

- **One alert per problem.** Each alert stays open until its rule stops finding the problem, then it resolves on its own.
- **A failed check changes nothing.** If a rule cannot run, for example because the database query fails, its open alerts stay as they are and the error is shown on Integrations.
- **Acknowledge** only hides an alert from the sidebar badge. A warning that becomes critical shows again.

| Alert | Opens when | Severity |
|---|---|---|
| n8n workflow failing | A tracked workflow's latest run in the last 7 days failed and no run has succeeded since. The alert includes n8n's error message, with any tokens masked. | Critical |
| Mailbox sync failing | A mailbox's last sync returned an error. "Not connected" is a setup state, not an alert. | Warning; critical after 6 h without a successful sync |
| Spreadsheet sync failing | One or more sheet sources returned an error. They are grouped into a single alert. | Warning |
| Sync failing (n8n, WhatsApp) | That integration's last sync returned an error. | Warning; critical after 6 h |
| Follow-ups overdue | Leads with status "follow-up due" whose due date is more than the grace period (0 days by default) in the past. One alert covers all of them, with a count per campaign. | Warning; critical when the oldest is more than 7 days late |
| Bounce spike | For a sending domain: at least 5 bounces in 24 h, **and** either the bounces are ≥ 5% of the domain's sends in the last 48 h, or they are ≥ 3× its usual daily bounces over the previous 14 days. | Warning; critical at twice the rate threshold |
| Near / over daily limit | A mailbox or domain reached its warning level or passed its limit today. | Near: warning. Over: critical. |

The bounce thresholds and the follow-up grace period can be changed on the Alerts page.

**Optional alert emails.** When "Send new alerts to n8n" is ticked, each new alert is posted once to the n8n webhook `outreach-dashboard-alerts`. The request carries the same header key as the data bridge. An alert is posted again if it escalates to critical.

The n8n workflow "Outreach Dashboard — Alerts" emails one summary per batch to the same address as the Daily Outreach Summary, through the same mailbox API credential. The workflow was created **inactive**.

## Data coverage

The Data coverage page marks every campaign-day in the last 45 days with one of three states.

| State | Rule |
|---|---|
| **Complete** | Every send that day is recorded with its time. Either the day is inside the synced n8n execution history for a campaign sent by n8n, or the day is inside the Sent-folder sync of every mailbox a mailbox-API campaign sends from. |
| **Approximate** (`~n`) | Outside that window, but a sheet records sends that day. Sheets can be edited later, so sends can be missing. |
| **Unknown** (`?`) | No source covers the day. A blank day is not proof that nothing was sent. |

- **n8n window.** n8n history starts at the earliest execution the dashboard has synced. It stops being complete after the last successful n8n sync while that sync is failing.
- **Undated sends** come from sheet rows with no date. They are counted per campaign in their own column and never placed on a day.

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
