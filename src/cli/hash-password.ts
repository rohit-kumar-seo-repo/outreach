// Prints an ADMIN_PASSWORD_HASH for .env. The password is read from stdin (never from argv,
// so it does not land in shell history or `ps` output).
import readline from 'node:readline';
import { hashPassword } from '../lib/auth/password';

async function readPassword(): Promise<string> {
  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const c of process.stdin) chunks.push(c as Buffer);
    return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
  let prompted = false;
  out._writeToOutput = (s: string) => {
    if (!prompted) {
      out.output.write(s);
      prompted = true;
    }
  };
  return new Promise((resolve) => rl.question('New dashboard password (min 12 chars): ', (a) => { rl.close(); process.stdout.write('\n'); resolve(a); }));
}

readPassword()
  .then(hashPassword)
  .then((h) => console.log(h))
  .catch((err) => {
    console.error((err as Error).message);
    process.exit(1);
  });
