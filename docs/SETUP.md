# Setup and deployment

The dashboard runs as its own Docker Manager project on the Hostinger VPS (`srv1904708`, 76.13.185.202). It sits next to the existing projects: n8n, WAHA, Traefik, EspoCRM and others. It does not change any of them.

HTTPS comes from the existing **Traefik** project, which already issues Let's Encrypt certificates for the other sites on this VPS.

## 1. DNS: one record to add

In the DNS zone for `rohitkumarseo.com`, add:

| Type | Name | Value | TTL |
|---|---|---|---|
| A | `outreach` | `76.13.185.202` | 3600 |
| AAAA (optional) | `outreach` | `2a02:4780:5e:513e::1` | 3600 |

Do **not** change or remove any other record. In particular, leave these alone: `@`/`www` (website), `MX`, the SPF `TXT` record, `DKIM` (`*._domainkey`), `DMARC`, and the existing `os` record.

Traefik requests the certificate automatically after the record resolves to the VPS, usually within a few minutes.

## 2. Deploy the project

hPanel → **VPS** → **Docker Manager** → **Compose** → create a project named `outreach`.

Paste the contents of `deploy/hostinger/docker-compose.yml` as the compose file. The project is already deployed this way.

A raw GitHub URL also works once the file is on `main`. Docker Manager could not fetch it from a branch whose name contains `/`.

Docker Manager only pulls images and never builds them, so the project uses public images only:

- A one-shot `builder` container (`node:22-alpine`) clones this repository at `GIT_REF`, builds it, and writes the release into the `outreach_release` volume.
- `migrate`, `app` and `worker` run that release with `node:22-alpine`.
- `backup` runs `pg_dump` with `postgres:16-alpine`.

**To update the live site, redeploy the project.** The builder rebuilds from `GIT_REF`, which defaults to `main`. Until this work is merged into `main`, set `GIT_REF=claude/dreamy-ptolemy-1pzokr`.

> The builder clones anonymously, so it needs the repository to be public. If you make the repository private, switch to a pre-built image instead, e.g. GitHub Actions → `ghcr.io`, which is how `clientos` is deployed.

### Environment variables

Set these in the project's **Environment** tab in hPanel. They live only on the VPS. Never put them in the repository, a screenshot or a chat.

| Variable | Required | What it is |
|---|---|---|
| `POSTGRES_PASSWORD` | yes | Database password. Use a long random string; nobody types it. |
| `ADMIN_EMAIL` | yes | The email address you log in with. |
| `ADMIN_PASSWORD` | yes* | Your login password, 12+ characters. It is hashed in memory and never logged. |
| `ADMIN_PASSWORD_HASH` | yes* | Alternative to `ADMIN_PASSWORD`: output of `npm run hash-password` (takes precedence). |
| `ADMIN_TOTP_SECRET` | recommended | Two-factor login. Create with `npm run totp-setup` and scan the QR/URI in an authenticator app. |
| `GIT_REF` | no | Branch or tag to build (default `main`). |
| `DOMAIN` | no | Default `outreach.rohitkumarseo.com`. |
| `N8N_BASE_URL`, `N8N_API_KEY` | for n8n history | n8n's address and an API key (n8n → Settings → n8n API → Create API key). On this VPS the address can be `http://host.docker.internal:<n8n host port>`, the port Docker Manager shows for the n8n project. |
| `N8N_API_KEY_2` | if needed | hPanel accepts at most 256 characters per value, and n8n keys are about 270. Put everything **before the last `.`** in `N8N_API_KEY`, and the last `.` plus the rest in `N8N_API_KEY_2`. The dashboard joins them. |
| `N8N_BRIDGE_URL`, `N8N_BRIDGE_KEY` | for sheets | `<n8n URL>/webhook/outreach-dashboard-bridge` and the key you store in the bridge's Header Auth credential (see step 3). |
| `HOSTINGER_MAIL_TOKENS`, `HOSTINGER_MAIL_TOKENS_2` … `_6` | for mailboxes | Hostinger Email API tokens, one per variable. One token covers the mailboxes of one mail order (rohitkumarseo.tech, adssuspensionrecovery.com, rkdigitalmedia.in). Create each with scope *All mailboxes*. |
| `IMAP_ACCOUNTS_JSON` | alternative to tokens | `[{"address":"agency@adssuspensionrecovery.com","password":"…"}]`. Host defaults to `imap.hostinger.com:993`. Access is read-only: messages are never marked read or moved. |
| `WAHA_BASE_URL`, `WAHA_API_KEY` | for WhatsApp | WAHA's address, e.g. `http://host.docker.internal:<WAHA host port>`, and its API key. |
| `INGEST_KEY` | optional | Enables `POST /api/ingest/n8n` for workflows that push events. |
| `BACKUP_AT`, `BACKUP_RETENTION_DAYS` | no | Nightly backup time (default `02:30`) and retention in days (default 14). |

\* Set one of `ADMIN_PASSWORD` or `ADMIN_PASSWORD_HASH`.

After a change, redeploy the project. The **Integrations** page lists which settings are present. It shows only yes/no, never the values.

## 3. Connect the data sources

Each source is optional. Anything not connected shows "Not connected" on the dashboard, never a made-up number.

1. **Sheets (n8n Data Bridge).** The workflow "Outreach Dashboard — Data Bridge (read-only)" already exists in n8n and is **inactive**.
   1. Create a new *Header Auth* credential in n8n. Name: `X-Outreach-Bridge-Key`. Value: a long random string.
   2. Select that credential on the "Bridge Webhook" node, replacing the one n8n picked automatically.
   3. Activate the workflow.
   4. Put the same string in `N8N_BRIDGE_KEY`.

   The bridge only reads sheets, using n8n's existing Google credential.
2. **n8n execution history.** Set `N8N_BASE_URL` and `N8N_API_KEY`. n8n keeps executions for about 6 days, so connect this early. The dashboard stores every send permanently once it has seen it.
3. **Mailboxes.**
   - Add one Hostinger Email API token per mail order (rohitkumarseo.tech, adssuspensionrecovery.com, rkdigitalmedia.in), or use `IMAP_ACCOUNTS_JSON`.
   - Inbox, Sent and Junk are read.
   - Messages are fetched without changing their read status.
4. **WhatsApp.** Set `WAHA_BASE_URL` and `WAHA_API_KEY`.
   - Only chats with contacted leads are read.
   - The dashboard never sends messages.

## 4. Verify

- Open `https://outreach.rohitkumarseo.com/api/health`. It should return `{"ok":true}`.
- Log in and open **Integrations**: every connected source should show a recent successful sync.
- In hPanel Docker Manager, the `outreach` project should list `db`, `app`, `worker` and `backup` as running. `builder` and `migrate` run once and exit with code 0.

## Backups and restore

The `backup` container writes a `pg_dump` to the `outreach_backups` volume every night and keeps 14 days of dumps.

To restore, work over SSH on the VPS from the project folder:

```sh
cd /docker/outreach
docker compose exec backup ls -l /backups                       # list dumps
docker compose stop app worker
docker compose exec -T db sh -c 'psql -U outreach -d postgres -c "alter database outreach rename to outreach_before_restore" && createdb -U outreach outreach'
docker compose exec -T backup pg_restore -h db -U outreach -d outreach --no-owner /backups/outreach-YYYYMMDD-HHMM.dump
docker compose start app worker
```

The old database is kept as `outreach_before_restore` until you drop it.

`deploy/restore.sh` does the same steps for the plain `deploy/docker-compose.yml` stack.

**Reports → Export** downloads CSVs of campaigns, daily activity, send attempts, replies and leads.

## Local development

```sh
npm ci
cp deploy/.env.example .env.local   # fill DATABASE_URL etc.
npm run migrate && npm run dev      # web app on :3000
npm run worker                      # sync loop
npm test                            # unit tests; set TEST_DATABASE_URL for the DB integration test
```

`PREVIEW_MODE=true` with a database whose name contains `preview` allows `npm run seed:preview`. This fills the database with clearly labelled sample data for a design preview. The production database refuses it.
