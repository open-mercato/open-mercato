import 'dotenv/config'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'

declare global {
  // eslint-disable-next-line no-var
  var __drizzlePool: Pool | undefined
}

function getPool() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set')
  }
  if (!global.__drizzlePool) {
    global.__drizzlePool = new Pool({ connectionString: process.env.DATABASE_URL })
  }
  return global.__drizzlePool
}

export function getDb() {
  return drizzle(getPool())
}
