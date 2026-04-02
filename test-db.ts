import pg from 'pg';
import { config } from 'dotenv';
config({ path: '.env' });

const { Client } = pg;
const client = new Client({
  connectionString: process.env.DATABASE_URL
});

async function test() {
  try {
    await client.connect();
    console.log("Connected successfully!");
    const res = await client.query('SELECT NOW()');
    console.log(res.rows);
    await client.end();
  } catch (err) {
    console.error("Connection error:", err);
    process.exit(1);
  }
}

test();
