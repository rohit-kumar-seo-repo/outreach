// Generates a TOTP secret for two-factor login. Add it to .env as ADMIN_TOTP_SECRET and scan the
// otpauth:// URL (or type the secret) into Google Authenticator / 1Password / Authy.
import { generateSecret, otpauthUrl } from '../lib/auth/totp';

const account = process.argv[2] ?? 'admin';
const secret = generateSecret();
console.log(`ADMIN_TOTP_SECRET=${secret}`);
console.log(`Authenticator URL: ${otpauthUrl(secret, account)}`);
