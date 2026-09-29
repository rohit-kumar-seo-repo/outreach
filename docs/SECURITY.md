# Security

## Access

- **One admin account.**
  - `ADMIN_EMAIL` plus a scrypt-hashed password: `ADMIN_PASSWORD_HASH`, or `ADMIN_PASSWORD` hashed in memory at startup.
  - Optional TOTP two-factor login (`ADMIN_TOTP_SECRET`), which is recommended.
- **Sessions.**
  - Random 256-bit tokens, stored hashed in Postgres.
  - Cookie `rks_session` is HttpOnly, Secure and SameSite=Lax.
  - Sessions expire after 12 h by default.
  - Settings → "Sign out everywhere" revokes all sessions.
- **Login throttling.** 5 failures per email or 10 per IP in 15 minutes blocks further attempts. Failed logins take about the same time whether or not the email exists.
- **Server actions** check the request origin against `PUBLIC_URL`.
- **Audit log.** Every data export and every manual change is recorded: replies sent, assignments, sentiment, suppressions, snoozes, read/unread, notes, business outcomes, sending limits and alert settings.
- **Security headers.** Strict CSP, HSTS, `frame-ancestors 'none'`, `noindex`. `robots.txt` disallows everything.

## Secrets

- **Where secrets live.** Only in the VPS project environment (hPanel → Docker Manager → Environment) or a local `.env` that git ignores. Nothing secret is in this repository, the compose file, the frontend bundle or the logs.
- **The Integrations page** shows only whether a setting is present (yes/no), never its value.
- **Integration errors** are redacted before they are stored or shown: bearer tokens, API keys, passwords and key/token query parameters are masked.
- **The n8n bridge** is protected by a header key (`X-Outreach-Bridge-Key`) and only reads sheets.
- **Alert notifications** are on (switched on at the owner's request, migration 004) and can be switched off on the Alerts page. The worker posts alert titles and details to the n8n `outreach-dashboard-alerts` webhook with the same header key. Error messages in alerts are redacted like integration errors.
- **The ingest endpoint** (`/api/ingest/n8n`) is disabled unless `INGEST_KEY` is set, and it rejects any request without that key.

## Mail and WhatsApp safety

- **The only email the dashboard sends is a reply you write and click Send on in the inbox.** Outreach, follow-ups and WhatsApp messages stay in your approved n8n workflows. There is no bulk, scheduled or automatic sending. Alert emails come from the n8n workflow "Outreach Dashboard — Alerts".
- **Reply safety** (`src/lib/mail/reply.ts`):
  - Sent through the Hostinger Email API with the server-side token; the browser never sees a credential.
  - The sender must be a connected mailbox (Hostinger API, last sync OK) that holds a copy of the conversation, so the reply stays in the thread. Other mailboxes are listed but disabled, with the reason.
  - At most 5 recipients, plain text, 20,000 characters, no attachments. Hard-bounced addresses are blocked.
  - Every submit carries a one-time key: a double click or a resubmitted form returns the first result instead of sending again. The same text to the same conversation is refused for 10 minutes.
  - The send is never retried automatically. A timeout is recorded as "not confirmed" and confirmed later from the Sent-folder copy.
  - Every attempt (sent, refused or unconfirmed) is stored in `mail_replies` and written to the audit log.
- **Limits and alerts never change sending.** They do not pause workflows, edit sheets or stop follow-ups in n8n.
- **Mailbox access is otherwise read-only.**
  - IMAP uses `EXAMINE` and `BODY.PEEK`.
  - The Hostinger Email API is read with GET. The only writes are sending a reply (the API also flags the answered message `\Answered`) and, if reading a body ever marks an unread message read, putting the unread flag back.
  - Messages are never moved or deleted. Read/unread and snooze in the inbox are dashboard-only.
  - Hostinger's `/text` endpoint marks messages read, so the dashboard never calls it. It reads the raw source instead and checks the flag afterwards; if restoring ever fails, unread messages are only loaded after a warning.
- **Email bodies are shown in a sandboxed iframe.** Scripts, forms and remote images are blocked, so opening a message cannot trigger a tracking pixel.

## Findings to act on

These were found while inspecting the existing setup. None of them was changed by this project.

1. **The repository is public.**
   - It holds no secrets. It does describe your campaigns, mailbox addresses and n8n workflow IDs.
   - Consider making it private. If you do, switch the compose `build:` to a pre-built image.
2. **The WAHA API key is written directly into three n8n workflows**, and it is visible in the WAHA project environment.
   - Move it to an n8n credential.
   - Rotate it after the dashboard has its own copy.
3. **The "Outreach Metrics Read API" webhook in n8n has no authentication.** Add Header Auth or deactivate it.
4. **The Hostinger API token used for automation can read every Docker project's environment**, including other apps' payment keys and passwords. Treat that token as a master key, and rotate it if it has been shared.
5. **The SEO dispatcher's HTTP node uses "never error".** An API error can be written back to the sheet as "Sent". The dashboard counts a send as accepted only when the recorded response shows success.
