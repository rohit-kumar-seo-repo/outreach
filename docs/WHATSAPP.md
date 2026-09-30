# WhatsApp Outreach Control Center

Everything on the **WhatsApp** tab in the sidebar. It reads and controls your existing n8n/WAHA
setup; it does not replace it. Campaign *sending* stays entirely in n8n and WAHA — this dashboard
never sends bulk WhatsApp messages. The one thing it sends on its own is a single manual reply
from the inbox, exactly the way replies already work for email (see [SECURITY.md](SECURITY.md)).

## What was inspected before anything changed (29–30 Sep 2026)

- **WAHA**: version `2026.9.1`, engine `NOWEB`, tier `CORE`. Three sessions, all `WORKING`:
  `default` (+91 70118 52449), `outreach2` (+91 82875 33237), `dubai_car_recovery` (+91 84485 54536).
- **Inbound webhooks**: only the `default` session has one registered
  (`…/webhook/waha-incoming-test`, which is a different path from the production
  `…/webhook/waha-incoming` the "WAHA - Incoming Message Webhook" workflow actually listens on).
  `outreach2` and `dubai_car_recovery` have **no webhook registered at all**. In practice their
  replies still reach the dashboard because the periodic WAHA sync (`SYNC_WAHA_SECONDS`, default
  15 min) pulls each contacted chat's full history directly from WAHA — so nothing is lost, but a
  reply on those two accounts can be up to ~15 minutes late showing up as "unread", instead of
  arriving in real time. The Accounts tab shows each session's real webhook config live (not a
  cached guess) so this is visible and fixable per account.
- **Delivery/read status**: every outbound WhatsApp message recorded so far has WAHA's ack stuck
  at `0` (Pending) — WAHA has not reported delivered or read for any of them. The Reports tab
  shows exactly this ("Pending") rather than inventing a delivered/read number; it will start
  showing real delivered/read counts the moment WAHA reports them.
- **The three sending workflows** (`WAHA Send Outreach - Dental Clinics`, `… for Website Dev`,
  `WhatsApp Outreach for Dubai Car Recovery`) each: read the sheet, filter to blank-status rows
  with a drafted message, take the first `DAILY_LIMIT` of them, wait 30–90s between sends, POST to
  WAHA's `/api/sendImage`, and write `Sent`/`Failed` back to the sheet. Only the first is active;
  the other two were already off.
- **The lead-count "gap"** in the old WhatsApp page (e.g. 506 loaded, 16 accepted, 353 remaining)
  was not a data bug — every row already had a single, correct `status`. It just was not all shown:
  137 duplicates and the needs-draft/ready split inside "remaining" were not broken out. The
  Campaigns tab now shows every bucket, and they always sum to the loaded count (see below).

## Lead-funnel reconciliation

`campaignFunnel()` (`src/lib/metrics/whatsapp.ts`) groups every lead's already-correct `status`
(computed by `deriveLeads()`, see `src/lib/sync/derive.ts`) into one of nine buckets:

`contacted · queued · needs_message · failed · duplicate · invalid · opted_out · excluded · other`

Each lead is in exactly one bucket, so `sum(buckets) === loaded` always, by construction — there is
no leftover category. **"Remaining"** on the Overview/Campaigns tabs means `queued + needs_message`:
leads that are not a duplicate, not invalid, not excluded, not opted out, and not contacted yet —
i.e. could still be sent to. A covered test (`tests/whatsapp-control-center.int.test.ts`) inserts one
lead per status and asserts the buckets reconcile exactly.

## The send gate

`GET /api/ingest/waha-gate?campaign=<slug>` (`src/app/api/ingest/waha-gate/route.ts`, logic in
`src/lib/whatsapp/gate.ts`) is the one place a dashboard pause, daily cap or send window becomes
real. Each of the three send workflows now calls it right before its final "Send via WAHA" step:

```
Wait (pacing) → Check Send Allowed (HTTP GET the gate) → Allowed? (IF $json.allowed)
                                                              ├─ true  → Send via WAHA (unchanged)
                                                              └─ false → (nothing; the run just stops)
```

The gate checks, in order: is the campaign paused (`campaigns.control_paused_at`) → has today's
accepted-send count reached `campaigns.daily_cap` → is the current time (in `APP_TIMEZONE`) inside
`campaigns.send_window` (days + start/end time), if one is set. Pausing **does not cancel a message
already being sent** — the check only runs before the next one — and it is recorded accurately
either way (the sheet is only updated for items that actually reached "Send via WAHA").

**Authentication and rollout**: the gate is authenticated with the same shared `INGEST_KEY` the
existing `/api/ingest/n8n` push endpoint uses (a header, `X-Ingest-Key`, checked with a
constant-time comparison). It is embedded directly as a literal header value in each workflow's new
"Check Send Allowed" node, the same way these workflows already embed the WAHA `X-Api-Key` — n8n's
MCP tools have no way to create a Header Auth credential, and that is the existing convention in
this n8n instance for this integration.

**Deliberately fails open until configured**: if `INGEST_KEY` is not set on the dashboard, the gate
returns `{"allowed": true, "reason": "ok", ...}` with HTTP 200 — so adding the gate check to these
three workflows changed nothing about their behaviour on its own. Once `INGEST_KEY` **is** set, an
auth failure or the campaign being paused/over-cap/outside-window fails *closed* (`allowed: false`),
and any other error (the dashboard unreachable, etc.) will make the HTTP node throw, which shows up
as a failed n8n execution — visible in n8n and in this dashboard's own alerts, not swallowed.

**Setup required**: add `INGEST_KEY` to the `outreach` Docker Manager project's environment
variables in hPanel (a long random string is fine) and redeploy. Until you do, the Controls card on
each WhatsApp campaign page says so plainly, and pausing there has no real effect on sending.

**Also changed**: each workflow's hardcoded `DAILY_LIMIT` (10, 10, 5) was raised (to 30, 30, 15) so
it is no longer the effective ceiling — `campaigns.daily_cap` is, seeded to the *old* limits so
behaviour is unchanged until you edit it on the Campaigns tab.

**Rollback**, per workflow, either way works:
- In n8n, open the workflow's version history and restore the version from before 30 Sep 2026, or
- Delete the "Check Send Allowed" and "Allowed?" nodes, reconnect "Wait (pacing)" directly to
  "Send via WAHA", and change `DAILY_LIMIT` back to its original value (10, 10 or 5).

## Manual replies from the inbox

`src/lib/whatsapp/reply.ts` (`sendWaReply`), mirroring how email replies already work
(`src/lib/mail/reply.ts`): a single POST to WAHA's `/api/sendText` using the server-side
`WAHA_API_KEY`, sent only when a person presses Send on one open conversation.

- Every submit carries an idempotency key; a resubmitted form returns the first result instead of
  sending again, and the exact same text to the same chat is refused for 10 minutes.
- The sending account must be the session that actually holds that chat, and it must be `WORKING`
  right now, or the composer explains why it cannot send.
- A number marked unsubscribed / do-not-contact is refused.
- No media, no bulk sending — one text message, in response to a human, recorded into
  `wa_messages` and audited like every other write in this app.
- Sending a reply does **not** need a new n8n workflow: like email, this is a direct,
  human-triggered call from the dashboard's own server using a credential it already holds.

## Manual classification

Classifying a conversation (Interested / Not interested / Needs follow-up / Auto-reply / Unsubscribe)
writes to the same fields `deriveLeads()` already reads:

- **Interested / Not interested** sets `wa_messages.sentiment` on the latest inbound message. This
  feeds the same status precedence email replies use (`not_interested` beats `positive` beats
  `replied`, etc. — see `src/lib/sync/derive.ts`), and is included in `v_replies`, so the existing
  campaign reply/positive-rate numbers on `/campaigns/[slug]` now cover WhatsApp too.
- **Auto-reply / "not an auto-reply"** sets `wa_messages.is_auto` directly, and also sets
  `auto_override = true` so the automatic greeting/away-message heuristic in `reconcileWhatsApp()`
  never overwrites a human's correction on a later sync (covered by a test).
- **Needs follow-up** sets `leads.manual_followup_at`.
- **Unsubscribe** adds a `whatsapp` row to `suppressions`, the same table and the same effect
  (excluded from future sends, shown in the funnel as "Opted out") as an email unsubscribe.

A reply also automatically stops that lead's scheduled follow-ups and moves it out of "Needs
reply", because `next_followup_at` is already computed from `last_reply_at`, which every inbound
WhatsApp message sets — no extra wiring needed for that part.

## Templates and media

`wa_templates` store a name, a message type (text/image/document/video), body text with
`{{firstName}}`/`{{name}}`/`{{business}}`/`{{city}}`/`{{category}}`/`{{phone}}` placeholders, and
either an uploaded file or a link to one you host yourself. `renderTemplate()`
(`src/lib/whatsapp/templates.ts`, unit-tested) fills placeholders it has a value for and leaves the
rest as `{{placeholder}}` — visibly, in the editor's live preview against a real lead's data where
one exists — rather than ever sending a blank or guessed value.

**Uploaded media is stored in Postgres** (`wa_media`, a `bytea` column), not on the app container's
disk: the production release volume is mounted read-only (see `deploy/hostinger/docker-compose.yml`),
so there is nowhere else durable to put it, and this way a database restore also restores the
media. It is served back at `/api/whatsapp/media/{random-id}` — a public, unguessable URL, because
WAHA (which cannot read this app's database or send a login cookie) needs to fetch it over plain
HTTPS, the same way the existing n8n workflows already point WAHA at a public image URL. Limits
(`MEDIA_LIMITS` in `templates.ts`) match WhatsApp's own published limits: 16 MB for images and
video, 100 MB for documents, and only the MIME types WhatsApp actually accepts for each.

Linking a template to a campaign (Campaigns → a campaign → Sending settings) only records the
choice; the campaign's n8n workflow does not read it yet. Wiring a workflow's `Build Send Queue`
step to use a dashboard-selected template instead of the sheet's own `Draft Message` column is a
further, separate change to that workflow — ask for it once you have templates you want to switch
a live campaign to.

## New campaigns

Campaigns and their spreadsheet column mapping are defined in `config/registry.json`, checked into
git and schema-validated at startup — that is what makes every existing campaign's lead rules (which
column is the phone number, which statuses mean what) known and safe. The **New campaign** wizard on
the Campaigns tab cannot create a live, sending campaign by itself: it collects the same information
a real campaign needs (name, spreadsheet, WhatsApp account, template, daily limit, send window) and
saves it as a draft request (`wa_campaign_drafts`). Turning a draft into a working campaign is a code
change (a `config/registry.json` entry) plus a matching n8n sending workflow — ask for either
explicitly, or hand the saved draft to whoever maintains the registry.

## Accounts

The Accounts tab shows each WAHA session's live status, engine and webhook config (fetched from
WAHA on page load, not cached), which campaigns use it, and lets you start/stop/restart/log out a
session or connect a new one via WAHA's own QR-code login flow — the QR image and every WAHA call
are proxied through the dashboard's server so `WAHA_API_KEY` never reaches the browser. A session
still in use by a campaign cannot be removed from here.

## Reports

Filtered by campaign, account and date. Daily accepted/failed/replies, response time (first
accepted send → first human reply), business outcomes, and warnings for a rising failure rate or a
disconnected account. Every daily limit shown is explicitly labelled as a setting you configured
here, never presented as a rule WhatsApp itself publishes — nothing on this page raises a limit,
changes a schedule, or starts a campaign by itself.
