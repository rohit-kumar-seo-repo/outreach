# Rohit Kumar SEO Outreach

A private dashboard for every outreach campaign run by Rohit Kumar SEO. It shows what was sent, scheduled, replied to, followed up, bounced or failed, across all sending domains, mailboxes and WhatsApp. It lives at **https://outreach.rohitkumarseo.com**.

It reads data from the tools already in place:

- n8n execution history
- the lead sheets (through a read-only n8n webhook)
- the Hostinger mailboxes
- WAHA

It never sends outreach itself; the only email it sends is a reply you write in the inbox. Anything that isn't connected is shown as "Not connected" or "No data yet", never as a made-up number.

| Page | What it shows |
|---|---|
| Overview | Today's KPIs, a delivery funnel (scheduled → attempted → accepted → bounced / confirmed / unverified), a 30-day chart with filters, and sync health |
| Alerts | Failed n8n runs, sync failures, overdue follow-ups, bounce spikes and daily-limit breaches. Optional email through n8n. |
| Campaigns | Per-campaign sends, follow-ups by step, replies, bounces, failures, and business results (qualified, meetings, won). Every rate shows its denominator. |
| Inbox | Three-pane triage across every mailbox: Needs reply first, domain/mailbox selectors, filters, lead and campaign context, inline replies from the receiving mailbox, snooze, read/unread, bounces, unmatched and internal mail |
| Leads | Status, due and overdue follow-ups, full send history, duplicate detection, suppressions, and recorded outcomes |
| Sending volume | Daily sends per mailbox and per domain, with limits you set |
| Data coverage | Which days' numbers are complete, approximate or unknown, per campaign |
| Spreadsheets | Real columns and statuses for each sheet, plus how "contacted" and "remaining" are calculated |
| WhatsApp | WAHA sessions, messages sent, ticks and replies, once WAHA is connected |
| Integrations, Reports, Settings | Sync status and errors, CSV exports, sessions |

## Docs

- [docs/SETUP.md](docs/SETUP.md): DNS record, deployment on the Hostinger VPS, environment variables, connecting sources, backups.
- [docs/METRICS.md](docs/METRICS.md): the exact definition of every number.
- [docs/DATA-SOURCES.md](docs/DATA-SOURCES.md): which system feeds what, what history can be imported, and the inspection findings.
- [docs/SECURITY.md](docs/SECURITY.md): login, secrets, read-only mail access, and open risks.

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
