#!/usr/bin/env bun

import { Pool } from 'pg';

let pool: Pool | null = null;

export function getDbPool(connectionString?: string): Pool {
  if (!pool) {
    pool = new Pool({ connectionString: connectionString || process.env.DATABASE_URL });
  }
  return pool;
}

