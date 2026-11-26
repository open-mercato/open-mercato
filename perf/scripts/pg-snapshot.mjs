#!/usr/bin/env node
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { createSut } from './lib/exec.mjs'
import { loadTarget } from './lib/target.mjs'
import { parsePostgresLog, groupSlowStatements, isExplainableSelect } from './lib/pglog.mjs'
import { writeJsonFile, writeTextFile } from './lib/state.mjs'

const TOP_LIMIT = 20
const EXPLAIN_LIMIT = 10

const STATEMENT_COLUMNS = `queryid::text as queryid, calls, round(total_exec_time::numeric, 2)::float as total_exec_time,
  round(mean_exec_time::numeric, 3)::float as mean_exec_time, rows, shared_blks_hit, shared_blks_read,
  temp_blks_written, round((shared_blk_read_time + shared_blk_write_time)::numeric, 2)::float as io_time_ms, left(query, 4000) as query`

function topStatementsSql(orderBy, minCalls) {
  return `select ${STATEMENT_COLUMNS} from pg_stat_statements
    where dbid = (select oid from pg_database where datname = current_database()) and calls >= ${minCalls}
    and query not ilike '%pg_stat_statements%'
    order by ${orderBy} desc limit ${TOP_LIMIT}`
}

export async function resetStatements(sut, database) {
  await sut.psql('create extension if not exists pg_stat_statements;\nselect pg_stat_statements_reset();\n', { database })
}

async function explainGeneric(sut, database, statements) {
  const plans = []
  for (const statement of statements.filter((entry) => isExplainableSelect(entry.query)).slice(0, EXPLAIN_LIMIT)) {
    const sql = `set statement_timeout = '15s';\nexplain (generic_plan, costs on, verbose off) ${statement.query};\n`
    const result = await sut.psql(sql, { database, allowFail: true })
    plans.push({
      queryid: statement.queryid,
      ok: result.code === 0,
      plan: result.code === 0 ? result.stdout.trim().split('\n').filter((line) => line !== 'SET').join('\n') : result.stderr.trim().slice(0, 500),
    })
  }
  return plans
}

async function databaseStats(sut, database) {
  const [stats] = await sut.psqlJson(`select numbackends, xact_commit, xact_rollback, blks_read, blks_hit,
    case when blks_hit + blks_read > 0 then round(blks_hit::numeric / (blks_hit + blks_read), 4)::float end as cache_hit_ratio,
    temp_files, temp_bytes, deadlocks, tup_returned, tup_fetched, tup_inserted, tup_updated, tup_deleted
    from pg_stat_database where datname = current_database()`, { database })
  const connections = await sut.psqlJson(`select coalesce(state, 'unknown') as state, count(*)::int as count from pg_stat_activity
    where datname = current_database() group by 1 order by 2 desc`, { database })
  const [settings] = await sut.psqlJson(`select current_setting('max_connections') as max_connections, current_setting('shared_buffers') as shared_buffers,
    current_setting('effective_cache_size') as effective_cache_size, current_setting('work_mem') as work_mem, version() as version`, { database })
  return { stats: stats ?? null, connections, settings: settings ?? null }
}

export async function capturePgSnapshot(sut, { database, since, requestCount, outDir }) {
  const byTotal = await sut.psqlJson(topStatementsSql('total_exec_time', 1), { database })
  const byMean = await sut.psqlJson(topStatementsSql('mean_exec_time', 5), { database })
  for (const statement of [...byTotal, ...byMean]) {
    statement.callsPerRequest = requestCount ? statement.calls / requestCount : null
  }
  const genericPlans = await explainGeneric(sut, database, byTotal)
  const database_ = await databaseStats(sut, database)
  const logsResult = await sut.compose(['logs', '--no-color', '--no-log-prefix', '--since', since, 'postgres'], { allowFail: true })
  const logText = `${logsResult.stdout}\n${logsResult.stderr}`
  const parsedLog = parsePostgresLog(logText)
  const snapshot = {
    capturedAt: new Date().toISOString(),
    since,
    requestCount: requestCount ?? null,
    topByTotal: byTotal,
    topByMean: byMean,
    genericPlans,
    database: database_,
    autoExplain: parsedLog.autoExplain.slice(0, 20),
    slowStatementGroups: groupSlowStatements(parsedLog.slowStatements),
    slowStatementCount: parsedLog.slowStatements.length,
    lockWaits: parsedLog.lockWaits.slice(0, 50),
    lockWaitCount: parsedLog.lockWaits.length,
    tempFiles: { count: parsedLog.tempFiles.length, bytes: parsedLog.tempFiles.reduce((total, entry) => total + (entry.bytes ?? 0), 0) },
    deadlocks: parsedLog.deadlocks,
    logErrors: parsedLog.errors,
  }
  if (outDir) {
    writeJsonFile(join(outDir, 'pg-snapshot.json'), snapshot)
    writeTextFile(join(outDir, 'logs', 'postgres.log'), logText)
  }
  return snapshot
}

async function main() {
  const args = process.argv.slice(2)
  const option = (name, fallback) => {
    const index = args.indexOf(`--${name}`)
    return index >= 0 ? args[index + 1] : fallback
  }
  const target = loadTarget()
  const sut = createSut(target)
  const database = option('db', 'open-mercato')
  if (args.includes('--reset')) {
    await resetStatements(sut, database)
    process.stdout.write('pg_stat_statements reset\n')
    return
  }
  const snapshot = await capturePgSnapshot(sut, {
    database,
    since: option('since', new Date(Date.now() - 3600000).toISOString()),
    requestCount: option('requests') ? Number(option('requests')) : null,
    outDir: option('out'),
  })
  if (!option('out')) process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`)
    process.exit(1)
  })
}
