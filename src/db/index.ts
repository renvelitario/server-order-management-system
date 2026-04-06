import { drizzle } from 'drizzle-orm/node-postgres';
import pkg from 'pg';
const { Pool } = pkg;
import * as schema from './schema.js';
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const requireEnv = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required.`);
  }

  return value;
};

const pool = new Pool({
  connectionString: requireEnv('DATABASE_URL'),
});

export const db = drizzle(pool, { schema });

const supabaseUrl = requireEnv('SUPABASE_URL');
const supabaseServiceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');

export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);
