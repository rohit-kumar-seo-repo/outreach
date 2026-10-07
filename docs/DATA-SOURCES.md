# Data sources

The dashboard **pulls** data from the systems you already use. It never modifies your n8n workflows. The only thing it sends is an email reply you write in the inbox (see SECURITY.md). `config/registry.json` describes every campaign, sheet, mailbox and n8n sender, and how its columns and statuses map to the dashboard.

| Source | What it gives | How it is read | Setting |
|---|---|---|---|
| n8n executions | Exact send attempts (time, sender, recipient, API or SMTP result) for every tracked sender workflow | n8n public API, `includeData=true`, every 5 min. Per-workflow adapters in the registry. | `N8N_BASE_URL`, `N8N_API_KEY` |
| n8n workflow health | Whether *every other* active n8n workflow's recent runs succeeded, and n8n's own error text when they didn't — no sends are extracted from these, only health | n8n public API, every 15 min | same |
| n8n workflows | Which campaigns are active; untracked workflows that look like senders | n8n public API, every hour | same |
| Sheets and data tables | Leads, statuses, schedules, and the send history the sheet records | "Outreach Dashboard — Data Bridge (read-only)" webhook in n8n, which uses n8n's own Google credential, every 15 min | `N8N_BRIDGE_URL`, `N8N_BRIDGE_KEY` |
| Mailboxes | Sent-folder copies (verified sends and Message-IDs), replies, bounces, junk | Hostinger Email API or IMAP (read-only), every 10 min. Bodies of recent conversation mail are prefetched without changing read flags. Replies are sent through the Hostinger Email API only. | `HOSTINGER_MAIL_TOKENS` / `IMAP_ACCOUNTS_JSON` |
| WhatsApp | Sessions, chats with contacted leads, delivered/read ticks, replies | WAHA API, every 15 min | `WAHA_BASE_URL`, `WAHA_API_KEY` |
| Push (optional) | Events from any workflow you choose to instrument | `POST /api/ingest/n8n` | `INGEST_KEY` |

## Campaigns and their senders

| Campaign | Sheet / table | n8n sender | Sends via | Follow-ups |
|---|---|---|---|---|
| Google Ads Services (UK/US/CA/UAE) | Google Ads International Outreach Sheet | Outreach Send Dispatcher (every 15 min) | Hostinger Email API | `-fu1`…`-fu3` rows, up to 3 |
| SEO Visibility (US) | same sheet, LeadID `seo-…` | same | same | same |
| SEO Audit Outreach | SEO Audit Outreach — Pipeline | SEO Audit Send Dispatcher | Hostinger Email API | TouchNumber 1–4 |
| Agency Outreach India | Agency Outreach – India Tracker | Agency Outreach – Send | SMTP (agency@, agency2@, agency3@adssuspensionrecovery.com) | none (no workflow) |
| Aesthetic Clinics (RKD) | Aeshthetic Clinic Data | RKD Daily Sender (inactive), RKD Follow-up Engine | SMTP (rkdigitalmedia.in) | FU1–FU3 at 3/7/14 days |
| Dubai Real Estate | Dubai Real Estate Outreach | Dubai Real Estate Outreach – Send | SMTP | none |
| Dubai Clinics batch 2 | none (leads are created from sends) | RKD — Dubai Batch 2 Send | SMTP | none |
| AAR scanner follow-ups | n8n data table `aar_followup_queue` | AAR Follow-up Sender | SMTP | stage 1–3 |
| WhatsApp: dental clinics (India) | Indian Business Owner sheet, Sheet1 | WAHA Send Outreach – Dental Clinics | WAHA | none |
| WhatsApp: dental, web dev | same file, "Dental Clinic with No Websites" | WAHA Send Outreach – … Website Dev | WAHA | none |
| WhatsApp: Dubai car recovery | UAE Towing Emergency Services Leads | WhatsApp Outreach for Dubai Car Recovery | WAHA | none |

## What history can be imported

- **n8n executions.** Only what n8n still keeps, which is about 6 days. After connecting, the dashboard keeps every send permanently.
- **Sheet history.** Everything the sheet records:
  - Google Ads / SEO rows carry exact timestamps.
  - Agency and Dubai rows carry dates.
  - WhatsApp and Aesthetic rows carry no date. They are imported as "date unknown", counted in totals but never in per-day charts.
- **Mailboxes.** The last `MAIL_INITIAL_SYNC_DAYS` days (120 by default). Sent-folder copies are linked to sheet sends by Message-ID, or by recipient plus time.

The **Data coverage** page shows the result per campaign and day: complete, approximate (sheet only) or unknown. The rules are in [METRICS.md](METRICS.md#data-coverage).

## Findings from the inspection (29 Sep 2026)

1. **AAR Follow-up Sender fails every run.**
   - Error: SMTP `535 authentication failed` on the info@adssuspensionrecovery.com credential.
   - Its queue holds only 2 test leads (`example.com`).
2. **RKD Follow-up Engine generates nothing.**
   - It needs a send date per row. The sheet's `Date` column is empty and there is no `Date Sent` column.
   - Its last 6 daily runs produced 0 follow-ups.
3. **RKD sender addresses have no mailboxes.** harry@, jacob@, larry@, paul@ and peter@rkdigitalmedia.in don't exist in the Hostinger mail order, so replies to them can't be received or tracked. They are listed under `retiredMailboxes` in the registry (29 Sep 2026): the dashboard no longer shows them as mailboxes anywhere, and any send that names them keeps only the sender address. The n8n "RKD — Follow-up Engine" workflow still has "Send from Harry/Jacob/Larry/Paul/Peter" nodes.
4. **The Aesthetic Clinic sheet belongs to another Google account and blocks export.** The bridge can still read it through n8n's credential. Direct downloads are refused.
5. **37 SEO Visibility rows are "Approved" without `ScheduledSendISO`.** The dispatcher skips rows without a send time, so they will never be sent.
6. **Two SEO follow-ups failed** with `404 route api/v1/mailboxes/send could not be found`.
7. **Schedule labels don't match the actual times.** n8n runs in `Asia/Kuala_Lumpur` (UTC+8).
   - Some triggers are named for IST but fire at other times. For example, "Daily 9am IST" fires at 00:30 IST.
   - The dashboard always uses the real execution time.
8. **Replies are not tracked anywhere automatically.** The Daily Outreach Summary email says replies are logged by hand in the CRM. The dashboard reads them from the mailboxes once they are connected.
9. **Execution retention is about 6 days.** Connect the n8n API soon, so that exact send history stops expiring.

## WhatsApp Outreach Control Center (30 Sep 2026)

Full inspection and design notes are in [WHATSAPP.md](WHATSAPP.md). In short:

10. **Two of three WhatsApp sessions (`outreach2`, `dubai_car_recovery`) have no inbound webhook registered in WAHA**, only `default` does (and it points at a path, `…/waha-incoming-test`, that differs from the production workflow's `…/waha-incoming`). Their replies still arrive via the periodic WAHA sync, just up to ~15 minutes later than a live webhook would. The Accounts tab shows this live per session.
11. **Every WhatsApp send recorded so far shows WAHA's ack stuck at "Pending"** — WAHA has not reported delivered/read for any of them. Reports shows this honestly rather than estimating delivered/read.
12. **The old lead-count display, not the underlying data, was the problem.** Every lead already had one correct status; the dashboard just was not showing all of them (duplicates and the needs-draft/ready split were folded into "remaining"). The reconciled funnel on the Campaigns tab fixes the display, not the data.

## Live audit (1 Oct 2026)

13. **678 WhatsApp leads are stuck on "needs a message drafted"** (286 on wa-dental-india, 352 on wa-dental-webdev, 40 on wa-dubai-car-recovery) — nothing sends them until each sheet row has a Draft Message, and nothing currently fills that column automatically. The WhatsApp Campaigns tab now flags a campaign with 20+ such leads, and shows (read-only, checked against each lead's real data) how many a linked template could actually fill. Writing a generated draft back into the sheet so n8n would pick it up is a further step, not yet built — it needs a write path into your sheets, which the dashboard does not have today (see [WHATSAPP.md](WHATSAPP.md)).
14. **Two sync bugs fixed**: `scanN8nWorkflows()` and the WAHA-inbound execution fetch recorded an integration error on failure but never cleared it on a later success, so an old transient n8n API hiccup (one HTTP 401, since resolved) stayed listed as "open" on the Integrations page indefinitely. Both now self-heal like every other sync does.
15. **A false warning fixed**: the three WhatsApp sheets logged "expected column(s) not found: Email" on every sync (165+ times) because the email column was checked as required for every source. WhatsApp leads are contacted by phone and normally have no email column at all; the check now only applies to email campaigns.

## n8n workflow audit (7 Oct 2026) — read-only, nothing in n8n was touched

16. **A second outreach pipeline exists in n8n that this dashboard had never seen.** Alongside the 11 workflows + 1 inbound webhook in `config/registry.json`, n8n currently runs 104 workflows, 50 of them active, including a parallel "Google Ads Outreach" pipeline (lead sourcing, email extraction/verification, drafting, send dispatch, follow-up, reply/bounce capture, nightly backup, a daily health report and its own "Pipeline Failure Alert" error workflow) and a "Google Ads WhatsApp Outreach / India" pipeline (morning sender, 3-hour follow-up, reply listener, daily check), both created 4 Oct 2026. Neither was in the registry, so none of their sends, replies, or failures were visible here.
17. **The dispatcher's ~130 straight "failed" runs are a safety brake working as designed, not an outage.** `Google Ads Outreach Send Dispatcher Workflow` (`8FmbNamNSgCMOWx9`, every 15 min) has thrown the identical error on every run since 6 Oct: `"Sending paused by the bounce brake: 3 of 22 emails bounced in the last 2 days (13.6%, limit 3%). It resumes by itself in about 2 days as those bounces age out."` This is the workflow's own bounce-rate guard deliberately halting sends — n8n just records a deliberate throw the same way it records a crash. It will keep logging as "error" until the bounce rate in its trailing 2-day window drops, the `Bounce Brake Percent` setting in its "Send Settings" tab is raised, or the underlying deliverability issue is fixed — none of which this dashboard can or should do on its own.
18. **Monitoring now covers every active workflow, not just the ones in the registry.** A new sync (`syncUntrackedWorkflowExecutions`, every 15 min) pulls execution status and n8n's own error text for every active workflow outside the registry — health only, no send attempts are extracted, so it can never write to `leads` or `campaigns`. This feeds the existing "n8n workflow failing" alert and a "Last run" column on the Integrations page for anything outside the registry that starts failing, with zero changes to n8n itself. It does not (and was not asked to) fold the new Google Ads pipelines into campaign metrics — that is a separate decision, since mapping them into `config/registry.json` would start counting their sends in reports.
