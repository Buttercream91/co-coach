import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { env } from '../env.js';
import * as schema from './schema.js';

// Standard node-postgres driver — works with any Postgres (Render, Neon's
// standard endpoint, a self-hosted instance, etc). SSL is enabled when the
// connection string includes `sslmode=require` (Render's managed Postgres,
// Neon, and most hosted providers).
const needsSsl = /sslmode=(require|verify-ca|verify-full)/.test(env.DATABASE_URL);
const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
});

export const db = drizzle(pool, { schema });
export type DB = typeof db;
