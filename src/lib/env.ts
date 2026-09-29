// Server-side configuration. Every secret comes from the environment (or a
// *_FILE path, for Docker secrets) and is never sent to the browser.
import fs from 'node:fs';

function read(name: string): string | undefined {
  const direct = process.env[name];
  if (direct !== undefined && direct !== '') return direct;
  const file = process.env[`${name}_FILE`];
  if (file) {
    try {
      return fs.readFileSync(file, 'utf8').trim();
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function list(name: string): string[] {
  return (read(name) ?? '')
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function int(name: string, fallback: number): number {
  const v = read(name);
  const n = v ? Number.parseInt(v, 10) : Number.NaN;
  return Number.isFinite(n) ? n : fallback;
}

export interface ImapAccount {
  address: string;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
}

function imapAccounts(): ImapAccount[] {
  const raw = read('IMAP_ACCOUNTS_JSON');
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Partial<ImapAccount>[];
    return parsed
      .filter((a) => a.address && a.password)
      .map((a) => ({
        address: String(a.address).toLowerCase(),
        host: a.host ?? 'imap.hostinger.com',
        port: a.port ?? 993,
        secure: a.secure ?? true,
        user: a.user ?? String(a.address),
        password: String(a.password),
      }));
  } catch {
    // A malformed value must not crash the app; the worker reports it as an integration error.
    return [];
  }
}

export const env = {
  get databaseUrl() {
    return read('DATABASE_URL') ?? 'postgres://outreach:outreach@localhost:5432/outreach';
  },
  get timezone() {
    return read('APP_TIMEZONE') ?? 'Asia/Kolkata';
  },
  get publicUrl() {
    return read('PUBLIC_URL') ?? 'https://outreach.rohitkumarseo.com';
  },
  get previewMode() {
    return read('PREVIEW_MODE') === 'true';
  },
  // auth
  get adminEmail() {
    return (read('ADMIN_EMAIL') ?? '').toLowerCase();
  },
  get adminPasswordHash() {
    return read('ADMIN_PASSWORD_HASH') ?? '';
  },
  get totpSecret() {
    return read('ADMIN_TOTP_SECRET') ?? '';
  },
  get sessionTtlHours() {
    return int('SESSION_TTL_HOURS', 12);
  },
  get cookieSecure() {
    return read('COOKIE_SECURE') !== 'false';
  },
  // n8n
  get n8nBaseUrl() {
    return (read('N8N_BASE_URL') ?? '').replace(/\/+$/, '');
  },
  get n8nApiKey() {
    return read('N8N_API_KEY') ?? '';
  },
  get bridgeUrl() {
    return read('N8N_BRIDGE_URL') ?? '';
  },
  get bridgeKey() {
    return read('N8N_BRIDGE_KEY') ?? '';
  },
  get ingestKey() {
    return read('INGEST_KEY') ?? '';
  },
  // mailboxes
  get hostingerMailTokens() {
    return list('HOSTINGER_MAIL_TOKENS');
  },
  get hostingerMailBaseUrl() {
    return (read('HOSTINGER_MAIL_BASE_URL') ?? 'https://api.mail.hostinger.com').replace(/\/+$/, '');
  },
  get imapAccounts() {
    return imapAccounts();
  },
  get mailInitialDays() {
    return int('MAIL_INITIAL_SYNC_DAYS', 120);
  },
  get mailMaxPerFolder() {
    return int('MAIL_MAX_MESSAGES_PER_FOLDER', 2000);
  },
  // whatsapp
  get wahaBaseUrl() {
    return (read('WAHA_BASE_URL') ?? '').replace(/\/+$/, '');
  },
  get wahaApiKey() {
    return read('WAHA_API_KEY') ?? '';
  },
  // worker cadence (seconds)
  get intervals() {
    return {
      n8n: int('SYNC_N8N_SECONDS', 300),
      sheets: int('SYNC_SHEETS_SECONDS', 900),
      mail: int('SYNC_MAIL_SECONDS', 600),
      waha: int('SYNC_WAHA_SECONDS', 900),
      derive: int('SYNC_DERIVE_SECONDS', 300),
      workflows: int('SYNC_WORKFLOW_SCAN_SECONDS', 3600),
    };
  },
};

export function configured(...values: string[]): boolean {
  return values.every((v) => v !== '');
}
