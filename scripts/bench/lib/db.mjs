// Database access for the benchmark scripts. Connects with the same DATABASE_URL the app uses
// (environment first, then apps/mercato/.env), so it works for local and Docker setups alike as
// long as Postgres is reachable from the host.
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { parse } from 'dotenv'
import pg from 'pg'

export function resolveDatabaseUrl({ root, explicit, env = process.env }) {
  if (explicit) return explicit
  if (env.DATABASE_URL) return env.DATABASE_URL
  const envFile = path.join(root, 'apps/mercato/.env')
  if (existsSync(envFile)) {
    const parsed = parse(readFileSync(envFile))
    if (parsed.DATABASE_URL) return parsed.DATABASE_URL
  }
  return null
}

export async function connect(url) {
  const client = new pg.Client({ connectionString: url, application_name: 'om-bench' })
  await client.connect()
  return client
}

export async function queryValue(client, sql, params = []) {
  const { rows } = await client.query(sql, params)
  if (!rows.length) return null
  return Object.values(rows[0])[0]
}

/**
 * Makes sure pg_stat_statements can be read in the current database. The library must be in
 * `shared_preload_libraries` (a server restart); the extension itself is created on demand.
 * Returns null when ready, or a message explaining what to change.
 */
export async function ensurePgStatStatements(client) {
  const preload = String(await queryValue(client, 'show shared_preload_libraries') ?? '')
  if (!preload.split(',').map((s) => s.trim()).includes('pg_stat_statements')) {
    return 'pg_stat_statements is not loaded. Start Postgres with `-c shared_preload_libraries=pg_stat_statements` '
      + '(for the repo compose file: `docker compose -f docker-compose.yml -f scripts/bench/compose.pg-stat-statements.yml up -d postgres`).'
  }
  await client.query('create extension if not exists pg_stat_statements')
  return null
}

// Statements issued by this script itself carry these markers and are excluded from the counts.
export const OWN_STATEMENT_FILTER = "query not ilike '%pg_stat_statements%' and query not ilike '%/* om-bench */%'"

export async function resetStatements(client) {
  await client.query('/* om-bench */ select pg_stat_statements_reset()')
}

export async function backgroundCalls(client) {
  return Number(await queryValue(client, `/* om-bench */
    select coalesce(sum(calls), 0) from pg_stat_statements
    where dbid = (select oid from pg_database where datname = current_database()) and ${OWN_STATEMENT_FILTER}`))
}

export async function readStatements(client) {
  const { rows } = await client.query(`/* om-bench */
    select queryid::text as queryid, calls::bigint as calls, rows::bigint as rows,
           round(total_exec_time::numeric, 3)::float8 as total_exec_time,
           round(mean_exec_time::numeric, 4)::float8 as mean_exec_time,
           shared_blks_hit::bigint as shared_blks_hit, shared_blks_read::bigint as shared_blks_read,
           left(query, 4000) as query
    from pg_stat_statements
    where dbid = (select oid from pg_database where datname = current_database()) and ${OWN_STATEMENT_FILTER}
    order by total_exec_time desc`)
  return rows.map((r) => ({ ...r, calls: Number(r.calls), rows: Number(r.rows), shared_blks_hit: Number(r.shared_blks_hit), shared_blks_read: Number(r.shared_blks_read) }))
}
