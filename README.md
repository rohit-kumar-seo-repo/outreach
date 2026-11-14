# Rohit Kumar SEO Outreach

A private dashboard for every outreach campaign run by Rohit Kumar SEO. It shows what was sent, scheduled, replied to, followed up, bounced or failed, across all sending domains, mailboxes and WhatsApp. It lives at **https://outreach.rohitkumarseo.com**.

It reads data from the tools already in place:

- n8n execution history
- the lead sheets (through a read-only n8n webhook)
- the Hostinger mailboxes
- WAHA

It never sends outreach itself; the only email it sends is a reply you write in the inbox. Anything that isn't connected is shown as "Not connected" or "No data yet", never as a made-up number.

It is also where the leads that respond get worked, phone first: a sales pipeline (New → Contacted → Interested → Meeting → Proposal → Won / Lost), tap-to-call / WhatsApp / email, call logging, reminders and notes. It installs on a phone's home screen (Share → Add to Home Screen on iPhone, Install app on Android).

| Page | What it shows |
|---|---|
| Today | The home screen answers two questions. **To do**: people **waiting on you** (they replied and nobody answered), **reminders due**, and hot leads **going quiet**. Each card names the next step ("Answer their question", "They asked for a call"), opens the right conversation in one tap, and has Done / Later; a ring shows how much of today is done, and an Outreach check flags sources that stopped sending. **What we got**: Sent → Replies → Interested → Meetings → Won for today, 7 days or 30 days, in total and per outreach source. Greetings, thanks, auto-replies, no's and leads already answered stay out of the way. See [Needs you](docs/METRICS.md#needs-you-focus) and [What we got](docs/METRICS.md#what-we-got-scoreboard) |
| Leads | Everyone who responded, by pipeline stage, as a list or a drag-and-drop board; search, filters, CSV export. Each lead page has Call / WhatsApp / Email, stage, reminder, call log, notes, deal value and one timeline of every send, reply, call and note. "All contacts" still lists every sheet row with its outreach status. |
| Call mode | One lead at a time (due reminders first, then new replies), a big Call button, and one-tap outcomes (Spoke / No answer / Busy / Wrong number) that set the next reminder and move on |
| Results → Performance | Today's KPIs, a delivery funnel (scheduled → attempted → accepted → bounced / confirmed / unverified), a 30-day chart with filters, and sync health |
| Alerts | Failed n8n runs, sync failures, overdue follow-ups, bounce spikes and daily-limit breaches. Optional email through n8n. |
| Results (Sources) | The same **What we got** scoreboard for every source, with a plain status each (Sending, Paused, Not sending, List finished). The detailed comparison (follow-ups by step, reply / meeting / bounce rates on one shared base: unique leads contacted) is one tap away, and each source opens its own page |
| Inbox | Three-pane triage across every mailbox. **Needs you** shows only replies that need you (interested, questions, call requests, later); "no", greetings, "thanks" and auto-replies are sorted into **Screened out** automatically. Lead stage, call / WhatsApp buttons, inline replies from the receiving mailbox, snooze, Done, bounces, unmatched and internal mail |
| Results → Sending | Daily sends per mailbox and per domain, with limits you set |
| Data coverage | Which days' numbers are complete, approximate or unknown, per campaign |
| Spreadsheets | Real columns and statuses for each sheet, plus how "contacted" and "remaining" are calculated |
| WhatsApp | A control center, not just a viewer: Overview (chats that need you, account and campaign issues), Inbox (WhatsApp-style chat, Needs you / Screened out like email), Campaigns (reconciled lead funnel, pause/resume that actually gates sending, daily caps, send windows), safe manual replies and classification, Templates (reusable messages with real-data preview), Accounts (session health, QR connect), Reports (volume, delivery status, response time, outcomes) — see [docs/WHATSAPP.md](docs/WHATSAPP.md) |
| Results → Exports | CSV exports |
| More: Alerts, Integrations, Spreadsheets, Data coverage, Settings | The set-up and plumbing pages, folded under More in the menu |

## Docs

- [docs/SETUP.md](docs/SETUP.md): DNS record, deployment on the Hostinger VPS, environment variables, connecting sources, backups.
- [docs/METRICS.md](docs/METRICS.md): the exact definition of every number.
- [docs/DATA-SOURCES.md](docs/DATA-SOURCES.md): which system feeds what, what history can be imported, and the inspection findings.
- [docs/SECURITY.md](docs/SECURITY.md): login, secrets, read-only mail access, and open risks.
- [docs/WHATSAPP.md](docs/WHATSAPP.md): the WhatsApp Outreach Control Center — lead-funnel reconciliation, the send gate (pause/cap/window), manual replies and classification, templates and media, accounts, reports.

## Stack

- Next.js 16 (App Router)
- React 19
- TypeScript
- Tailwind CSS 4
- Postgres 16
- A Node sync worker
- Docker Compose behind the VPS's Traefik

```sh
npm ci && npm run typecheck && npm test && npm run build
```
