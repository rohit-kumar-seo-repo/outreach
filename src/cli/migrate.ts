import { pool } from '../lib/db';
import { migrate } from '../lib/migrate';
import { syncRegistry } from '../lib/registry/sync';

migrate()
  .then(async (applied) => {
    await syncRegistry();
    console.log(applied.length ? `Applied ${applied.length} migration(s).` : 'Database already up to date.');
    await pool().end();
  })
  .catch(async (err) => {
    console.error(err);
    await pool().end();
    process.exit(1);
  });
