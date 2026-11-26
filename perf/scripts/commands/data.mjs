import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { generatePassword, keyBackupText, keyFingerprint } from '../lib/env.mjs'
import { apiRequest, login, sleep, waitForHealth } from '../lib/http.mjs'
import { log, loadContext, quoteIdentifier, requireTier } from '../lib/context.mjs'
import { assertTargetAcknowledged } from '../lib/target.mjs'
import { queryMigrationHead } from '../lib/sutinfo.mjs'
import { ensureStateDir, readJsonFile, writeJsonFile, writeTextFile } from '../lib/state.mjs'
import { APP_SERVICES, CONFIG_DIR, meiliDataVolume, meiliTemplateVolume, statePath, templateDatabaseName, tierDataDir } from '../lib/paths.mjs'
import { provisionUsers } from '../provision-users.mjs'

const HELPER_IMAGE = 'alpine:3.22.7'
const SEED_EXIT_MESSAGES = {
  2: 'seed-perf rejected its arguments (exit 2)',
  3: 'seed-perf verification failed (exit 3); the dataset must not be snapshotted',
  4: 'seed-perf stopped with a resumable failure (exit 4); re-run with --resume',
}

function parseLastJsonLine(text) {
  const line = text.trim().split('\n').reverse().find((entry) => entry.trim().startsWith('{'))
  if (!line) throw new Error('[perf] expected a JSON line from mercato auth setup')
  return JSON.parse(line)
}

async function createTenant(sut, { orgName, orgSlug, email }) {
  const password = generatePassword()
  const result = await sut.exec('app', [
    'yarn', 'mercato', 'auth', 'setup',
    '--orgName', orgName, '--orgSlug', orgSlug, '--email', email, '--password', password,
    '--roles', 'superadmin,admin,employee', '--json',
  ])
  const payload = parseLastJsonLine(result.stdout)
  log(`running module seedDefaults hooks (mercato seed:defaults) for ${orgName}`)
  await sut.exec('app', ['yarn', 'mercato', 'seed:defaults'], { capture: false })
  return { tenantId: payload.tenantId, organizationId: payload.organizationId, adminUserId: payload.adminUserId, adminEmail: email, adminPassword: password }
}

export async function tenant(flags) {
  const { target, sut } = loadContext()
  assertTargetAcknowledged(target, flags)
  ensureStateDir()
  const path = statePath('tenant.json')
  if (existsSync(path)) {
    const current = readJsonFile(path)
    log(`measured tenant already exists: ${current.tenantId} / ${current.organizationId}`)
    return
  }
  const created = await createTenant(sut, { orgName: 'Perf CRM', orgSlug: 'perf-crm', email: flags.email ?? 'perf-admin@perf.local' })
  writeJsonFile(path, created, 0o600)
  log(`measured tenant ${created.tenantId} / org ${created.organizationId} written to perf/.state/tenant.json`)
}

export async function users(flags) {
  const { target } = loadContext({ requireSutEnv: false })
  assertTargetAcknowledged(target, flags)
  const measured = readJsonFile(statePath('tenant.json'))
  const result = await provisionUsers({ baseUrl: target.CONTROL_BASE_URL, tenant: measured, total: Number(flags.count ?? 200), admins: Number(flags.admins ?? 20), log })
  log(`users.json (mode 600) and owners.json written: ${result.users} users, ${result.admins} admins`)
}

function seedArgs({ scope, tier, flags, ownersPath, outDir, scale }) {
  const args = ['yarn', 'mercato', 'customers', 'seed-perf', '--tenant', scope.tenantId, '--org', scope.organizationId, '--tier', tier, '--owners-file', ownersPath, '--out-dir', outDir]
  for (const name of ['profile', 'seed', 'anchor', 'batch']) {
    if (flags[name] !== undefined && flags[name] !== true) args.push(`--${name}`, String(flags[name]))
  }
  if (flags.resume) args.push('--resume')
  if (scale !== undefined) args.push('--scale', String(scale))
  return args
}

async function runSeeder(sut, args) {
  const result = await sut.exec('app', args, { capture: false, allowFail: true })
  if (result.code !== 0) throw new Error(`[perf] ${SEED_EXIT_MESSAGES[result.code] ?? `seed-perf exited with ${result.code}`}`)
}

async function reindexQueryIndex(sut, scope, flags) {
  const args = ['yarn', 'mercato', 'search', 'reindex', '--tenant', scope.tenantId, '--org', scope.organizationId, '--force']
  if (flags.partitions) args.push('--partitions', String(flags.partitions))
  await sut.exec('app', args, { capture: false })
}

async function meiliStats(sut) {
  const result = await sut.exec('meilisearch', ['sh', '-c', 'curl -fsS -H "Authorization: Bearer $MEILI_MASTER_KEY" http://127.0.0.1:7700/stats'], { allowFail: true })
  if (result.code !== 0) return null
  const stats = JSON.parse(result.stdout)
  const indexes = Object.entries(stats.indexes ?? {}).map(([uid, index]) => ({ uid, documents: index.numberOfDocuments ?? 0, indexing: Boolean(index.isIndexing) }))
  return { documents: indexes.reduce((total, index) => total + index.documents, 0), indexing: indexes.some((index) => index.indexing), indexes }
}

const QUEUE_BACKLOG_SCRIPT = "local clock = redis.call('TIME') local horizon = tonumber(clock[1]) * 1000 * 4096 local total = 0 for _, pattern in ipairs(ARGV) do for _, key in ipairs(redis.call('KEYS', pattern)) do local kind = redis.call('TYPE', key).ok if kind == 'list' then total = total + redis.call('LLEN', key) elseif kind == 'zset' then if string.sub(key, -8) == ':delayed' then total = total + redis.call('ZCOUNT', key, '-inf', horizon) else total = total + redis.call('ZCARD', key) end end end end return total"

async function queueBacklog(sut) {
  const result = await sut.exec('redis', ['redis-cli', '--raw', 'EVAL', QUEUE_BACKLOG_SCRIPT, '0', 'bull:*:wait', 'bull:*:active', 'bull:*:delayed', 'bull:*:prioritized'], { allowFail: true })
  const value = Number(result.stdout.trim())
  return Number.isFinite(value) ? value : null
}

async function reindexFulltext(sut, target, scope, { stablePolls = 6, intervalMs = 10000, timeoutMs = 4 * 3600 * 1000 } = {}) {
  const token = await login(target.CONTROL_BASE_URL, { email: scope.adminEmail, password: scope.adminPassword, tenantId: scope.tenantId })
  const response = await apiRequest(target.CONTROL_BASE_URL, '/api/search/reindex', { method: 'POST', token, json: { action: 'reindex' }, timeoutMs: 10 * 60 * 1000 })
  if (!response.ok) throw new Error(`[perf] POST /api/search/reindex failed (HTTP ${response.status}: ${JSON.stringify(response.data).slice(0, 300)})`)
  log('fulltext reindex enqueued; waiting for the worker and Meilisearch to settle')
  const deadline = Date.now() + timeoutMs
  let previous = -1
  let stable = 0
  let stats = null
  while (Date.now() < deadline) {
    await sleep(intervalMs)
    stats = await meiliStats(sut)
    const backlog = await queueBacklog(sut)
    const documents = stats?.documents ?? -1
    stable = documents === previous && !stats?.indexing && backlog === 0 ? stable + 1 : 0
    previous = documents
    log(`meilisearch documents ${documents}, indexing ${stats?.indexing ?? 'n/a'}, queue backlog ${backlog ?? 'n/a'} (stable ${stable}/${stablePolls})`)
    if (stable >= stablePolls) return stats
  }
  throw new Error('[perf] Meilisearch did not settle before the timeout')
}

async function verifySearch(target, scope, catalog) {
  const term = catalog?.searchTerms?.unique?.[0]?.term
  if (!term) return { ok: false, reason: 'catalog has no unique search term' }
  const token = await login(target.CONTROL_BASE_URL, { email: scope.adminEmail, password: scope.adminPassword, tenantId: scope.tenantId })
  const global = await apiRequest(target.CONTROL_BASE_URL, `/api/search/search/global?q=${encodeURIComponent(term)}&limit=10`, { token })
  const people = await apiRequest(target.CONTROL_BASE_URL, `/api/customers/people?search=${encodeURIComponent(term)}&pageSize=5`, { token })
  const companies = await apiRequest(target.CONTROL_BASE_URL, `/api/customers/companies?search=${encodeURIComponent(term)}&pageSize=5`, { token })
  const globalHits = (global.data?.results ?? global.data?.items ?? []).length
  const tokenHits = (people.data?.items ?? []).length + (companies.data?.items ?? []).length
  return { ok: global.ok && globalHits > 0 && tokenHits > 0, globalStatus: global.status, globalHits, tokenHits }
}

async function vacuumAnalyze(sut, database) {
  log('VACUUM (ANALYZE) on the measured database')
  await sut.psql('vacuum (analyze);\n', { database })
}

async function seedMeasured(context, tier, flags) {
  const { target, sut, database } = context
  const scope = readJsonFile(statePath('tenant.json'))
  const owners = readFileSync(statePath('owners.json'), 'utf8')
  const startedAt = Date.now()
  await sut.writeFile('app', '/tmp/perf/owners.json', owners)
  const outDir = `/tmp/perf-seed/${tier}`
  await runSeeder(sut, seedArgs({ scope, tier, flags, ownersPath: '/tmp/perf/owners.json', outDir }))
  const seededAt = Date.now()
  const dataDir = tierDataDir(tier)
  for (const file of ['manifest.json', 'catalog.json']) {
    writeTextFile(join(dataDir, file), await sut.readFile('app', `${outDir}/${file}`))
  }
  const manifest = readJsonFile(join(dataDir, 'manifest.json'))
  const catalog = readJsonFile(join(dataDir, 'catalog.json'))
  log(`copied manifest and catalog to perf/data/${tier}/`)
  if (flags['skip-query-index']) log('skipping the query_index reindex (--skip-query-index)')
  else await reindexQueryIndex(sut, scope, flags)
  const indexedAt = Date.now()
  const meili = flags['skip-fulltext'] ? null : await reindexFulltext(sut, target, scope)
  const fulltextAt = Date.now()
  await vacuumAnalyze(sut, database)
  const searchCheck = await verifySearch(target, scope, catalog)
  const verified = searchCheck.ok && meili !== null
  writeJsonFile(statePath(`seed-${tier}.json`), {
    tier,
    verified,
    manifestChecksum: manifest.checksum,
    anchor: manifest.anchor,
    counts: manifest.counts,
    meiliDocuments: meili?.documents ?? null,
    searchCheck,
    durationsMs: { seed: seededAt - startedAt, queryIndex: indexedAt - seededAt, fulltext: fulltextAt - indexedAt, total: Date.now() - startedAt },
    finishedAt: new Date().toISOString(),
  })
  log(`seed ${tier} ${verified ? 'verified' : 'NOT verified'} in ${Math.round((Date.now() - startedAt) / 1000)} s (${JSON.stringify(searchCheck)})`)
  if (!verified) throw new Error('[perf] seed verification failed; fix the cause before taking a snapshot')
}

async function seedBackground(context, tier, flags) {
  const { sut } = context
  const tiers = readJsonFile(join(CONFIG_DIR, 'tiers.json'))
  const profile = tiers.profiles[flags.profile ?? 'perf-v1']
  const settings = profile.tiers[tier]
  const path = statePath('background-tenants.json')
  const tenants = readJsonFile(path, [])
  for (let index = 1; index <= settings.backgroundTenants; index += 1) {
    if (!tenants[index - 1]) {
      tenants[index - 1] = await createTenant(sut, { orgName: `Perf Background ${index}`, orgSlug: `perf-bg-${index}`, email: `perf-bg-${index}@perf.local` })
      writeJsonFile(path, tenants, 0o600)
    }
    const scope = tenants[index - 1]
    const ownersPath = `/tmp/perf/owners-bg-${index}.json`
    await sut.writeFile('app', ownersPath, JSON.stringify({ owners: [{ userId: scope.adminUserId, staffMemberId: null }] }))
    log(`seeding background tenant ${index}/${settings.backgroundTenants} at scale ${settings.backgroundScale}`)
    await runSeeder(sut, seedArgs({ scope, tier, flags, ownersPath, outDir: `/tmp/perf-seed/bg-${index}`, scale: settings.backgroundScale }))
    await reindexQueryIndex(sut, scope, flags)
  }
  log(`background tenants ready: ${settings.backgroundTenants} (Meilisearch is not indexed for them)`)
}

export async function seed(flags) {
  const context = loadContext()
  assertTargetAcknowledged(context.target, flags)
  const tier = requireTier(flags.tier ?? 'S')
  if (flags.background) await seedBackground(context, tier, flags)
  else await seedMeasured(context, tier, flags)
}

async function stopAppServices(sut) {
  await sut.compose(['stop', ...APP_SERVICES], { capture: false })
}

async function startAppServices(sut, target) {
  await sut.compose(['up', '-d', ...APP_SERVICES], { capture: false })
  await waitForHealth(target.CONTROL_BASE_URL, { log })
}

function terminateSql(database) {
  return `select pg_terminate_backend(pid) from pg_stat_activity where datname = '${database.replace(/'/g, "''")}' and pid <> pg_backend_pid();\n`
}

async function copyVolume(sut, source, destination) {
  await sut.docker(['volume', 'create', destination])
  await sut.docker(['run', '--rm', '-v', `${source}:/from:ro`, '-v', `${destination}:/to`, HELPER_IMAGE, 'sh', '-c', 'find /to -mindepth 1 -delete && cp -a /from/. /to/'], { capture: false })
}

async function withMeiliStopped(sut, action) {
  await sut.compose(['stop', 'meilisearch'], { capture: false })
  try {
    await action()
  } finally {
    await sut.compose(['up', '-d', '--wait', 'meilisearch'], { capture: false })
  }
}

function requireKeys(sutEnv) {
  for (const key of ['TENANT_DATA_ENCRYPTION_FALLBACK_KEY', 'LOOKUP_HASH_PEPPER']) {
    if (!sutEnv.get(key)) throw new Error(`[perf] ${key} is missing from sut.local.env; a snapshot without its keys is unreadable`)
  }
}

export async function snapshot(flags) {
  const { target, sut, sutEnv, database, deployEnv } = loadContext()
  assertTargetAcknowledged(target, flags)
  const tier = requireTier(flags.tier ?? 'S')
  const seedState = readJsonFile(statePath(`seed-${tier}.json`), null)
  if (!seedState?.verified) throw new Error(`[perf] no verified seed for tier ${tier} (perf/.state/seed-${tier}.json); snapshots are only taken from verified datasets`)
  requireKeys(sutEnv)
  const startedAt = Date.now()
  const migrationHead = await queryMigrationHead(sut, database)
  const templateName = templateDatabaseName(tier)
  await stopAppServices(sut)
  log(`copying ${database} to ${templateName} (STRATEGY FILE_COPY)`)
  await sut.psql([
    terminateSql(database),
    `drop database if exists ${quoteIdentifier(templateName)};`,
    `create database ${quoteIdentifier(templateName)} template ${quoteIdentifier(database)} strategy file_copy;`,
    `alter database ${quoteIdentifier(templateName)} with allow_connections false;`,
  ].join('\n').concat('\n'), { database: 'postgres' })
  await withMeiliStopped(sut, () => copyVolume(sut, meiliDataVolume(deployEnv), meiliTemplateVolume(tier)))
  await startAppServices(sut, target)
  const createdAt = new Date().toISOString()
  const record = {
    tier,
    snapshotId: `${tier}-${String(seedState.manifestChecksum ?? 'nochecksum').slice(0, 8)}-${createdAt.slice(0, 16).replace(/[-:T]/g, '')}`,
    manifestChecksum: seedState.manifestChecksum,
    anchor: seedState.anchor,
    migrationHead,
    keyFingerprint: keyFingerprint(sutEnv),
    createdAt,
    durationMs: Date.now() - startedAt,
  }
  writeJsonFile(statePath('snapshots', `${tier}.json`), record)
  writeTextFile(statePath('snapshots', `${tier}.keys.env`), keyBackupText(sutEnv), 0o600)
  log(`snapshot ${record.snapshotId} taken in ${Math.round(record.durationMs / 1000)} s; keys backed up to perf/.state/snapshots/${tier}.keys.env`)
}

export async function restore(flags) {
  const { target, sut, sutEnv, database, deployEnv } = loadContext()
  assertTargetAcknowledged(target, flags)
  const tier = requireTier(flags.tier ?? readJsonFile(statePath('last-restore.json'), {}).tier ?? 'S')
  const record = readJsonFile(statePath('snapshots', `${tier}.json`), null)
  if (!record) throw new Error(`[perf] no snapshot for tier ${tier}; run perf/bin/perf snapshot --tier ${tier}`)
  if (record.keyFingerprint !== keyFingerprint(sutEnv)) {
    throw new Error(`[perf] encryption keys in sut.local.env do not match snapshot ${record.snapshotId}; restore the keys from perf/.state/snapshots/${tier}.keys.env`)
  }
  const startedAt = Date.now()
  await stopAppServices(sut)
  log(`recreating ${database} from ${templateDatabaseName(tier)}`)
  await sut.psql([
    terminateSql(database),
    `drop database if exists ${quoteIdentifier(database)} with (force);`,
    `create database ${quoteIdentifier(database)} template ${quoteIdentifier(templateDatabaseName(tier))} strategy file_copy;`,
  ].join('\n').concat('\n'), { database: 'postgres' })
  await withMeiliStopped(sut, () => copyVolume(sut, meiliTemplateVolume(tier), meiliDataVolume(deployEnv)))
  await sut.exec('redis', ['redis-cli', 'FLUSHALL'])
  await startAppServices(sut, target)
  await sut.psql('analyze;\ncreate extension if not exists pg_stat_statements;\nselect pg_stat_statements_reset();\n', { database })
  const migrationHead = await queryMigrationHead(sut, database)
  const marker = {
    tier,
    snapshotId: record.snapshotId,
    restoredAt: new Date().toISOString(),
    migrationHead,
    loadPhaseRanSince: false,
    durationMs: Date.now() - startedAt,
  }
  writeJsonFile(statePath('last-restore.json'), marker)
  log(`restored ${record.snapshotId} in ${Math.round(marker.durationMs / 1000)} s (migration head ${migrationHead.hash})`)
}
