import { config } from 'dotenv';
config({ path: '.env' });

import pkg from 'pg';
const { Client } = pkg;
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(join(__dirname, 'drizzle', '0001_rename_fix_schema.sql'), 'utf8');

const client = new Client({ connectionString: process.env.DATABASE_URL });

try {
  await client.connect();
  console.log('Connected to database.');
  await client.query(sql);
  console.log('Migration applied successfully.');
} catch (err) {
  console.error('Migration failed:', err.message);
  process.exit(1);
} finally {
  await client.end();
}
