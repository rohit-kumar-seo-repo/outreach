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

/**
 * hPanel's Docker Manager limits each environment value to 256 characters, so a long secret
 * (an n8n API key is ~270) can be split across NAME, NAME_2, NAME_3 and is joined here.
 * n8n keys are JWTs (header.payload.signature): if the split dropped dots at the part
 * boundaries, the missing ones are restored there.
 */
export function joinParts(parts: (string | undefined)[]): string {
  const vals = parts.map((p) => (p ?? '').trim()).filter(Boolean);
  const plain = vals.join('');
  if (!plain.startsWith('eyJ')) return plain;
  let missing = 2 - (plain.match(/\./g)?.length ?? 0);
  if (missing <= 0) return plain;
  let out = vals[0] ?? '';
  for (const next of vals.slice(1)) {
    if (missing > 0 && !out.endsWith('.') && !next.startsWith('.')) {
      out += '.';
      missing--;
    }
    out += next;
  }
  return out;
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
  /** Plain password, only used when no ADMIN_PASSWORD_HASH is set (e.g. typed into hPanel's env editor). */
  get adminPassword() {
    return read('ADMIN_PASSWORD') ?? '';
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
    return joinParts([read('N8N_API_KEY'), read('N8N_API_KEY_2'), read('N8N_API_KEY_3')]);
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
  /** One token per mail order: comma-separated in HOSTINGER_MAIL_TOKENS and/or one per HOSTINGER_MAIL_TOKENS_2.._6. */
  get hostingerMailTokens() {
    const names = ['HOSTINGER_MAIL_TOKENS', 'HOSTINGER_MAIL_TOKENS_2', 'HOSTINGER_MAIL_TOKENS_3', 'HOSTINGER_MAIL_TOKENS_4', 'HOSTINGER_MAIL_TOKENS_5', 'HOSTINGER_MAIL_TOKENS_6'];
    return [...new Set(names.flatMap((n) => list(n)))];
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
      alerts: int('SYNC_ALERTS_SECONDS', 300),
    };
  },
};

export function configured(...values: string[]): boolean {
  return values.every((v) => v !== '');
}
