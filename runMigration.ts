import { config } from 'dotenv';
config({ path: '.env' });

import pkg from 'pg';
const { Client } = pkg;
import { readdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, 'drizzle');
const migrationFiles = readdirSync(migrationsDir)
  .filter((file) => file.endsWith('.sql'))
  .sort();

const client = new Client({ connectionString: process.env.DATABASE_URL });

try {
  await client.connect();
  console.log('Connected to database.');

  for (const file of migrationFiles) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    await client.query(sql);
    console.log(`Applied migration: ${file}`);
  }

  console.log('All migrations applied successfully.');
} catch (err) {
  console.error('Migration failed:', err.message);
  process.exit(1);
} finally {
  await client.end();
}
