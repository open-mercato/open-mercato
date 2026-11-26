import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { findUnsafeSecrets, mergeEnvTemplate, parseEnvText } from '../lib/env.mjs'
import { runProcess } from '../lib/exec.mjs'
import { waitForHealth } from '../lib/http.mjs'
import { log, loadContext } from '../lib/context.mjs'
import { assertTargetAcknowledged, loadTarget } from '../lib/target.mjs'
import { PERF_ROOT, STATE_DIR, SUT_ENV_EXAMPLE, SUT_ENV_PATH, SUT_ENV_RELATIVE, TARGET_ENV_PATH, statePath } from '../lib/paths.mjs'
import { readJsonFile, writeTextFile } from '../lib/state.mjs'
import { generatorCompose, k6Environment } from './generator.mjs'

export async function pushSutEnv(sut) {
  if (!sut.remote) return
  await sut.writeHostFile(SUT_ENV_RELATIVE, readFileSync(SUT_ENV_PATH, 'utf8'))
  log('pushed sut.local.env to the SUT (mode 600)')
}

export async function initSecrets() {
  const existing = existsSync(SUT_ENV_PATH) ? parseEnvText(readFileSync(SUT_ENV_PATH, 'utf8')) : new Map()
  const { text, generated } = mergeEnvTemplate(readFileSync(SUT_ENV_EXAMPLE, 'utf8'), existing)
  writeTextFile(SUT_ENV_PATH, text, 0o600)
  log(generated.length ? `generated ${generated.length} secrets: ${generated.join(', ')}` : 'all secrets already present; nothing generated')
  log(`wrote ${SUT_ENV_RELATIVE} (mode 600). Values are never printed.`)
  if (!existsSync(TARGET_ENV_PATH)) {
    log('next: copy perf/config/target.example.env to perf/config/target.local.env and edit it')
    return
  }
  const target = loadTarget()
  if (target.SUT_SSH) {
    const { sut } = loadContext()
    await pushSutEnv(sut)
  }
}

async function ensureStatementsExtension(sut, database) {
  const sql = 'create extension if not exists pg_stat_statements;\n'
  await sut.psql(sql, { database })
  await sut.psql(sql, { database: 'postgres' })
}

export async function build() {
  const { sut } = loadContext()
  await sut.compose(['build', 'app'], { capture: false })
}

export async function up(flags) {
  const { target, sut, sutEnv, database } = loadContext()
  assertTargetAcknowledged(target, flags)
  const problems = findUnsafeSecrets(sutEnv)
  if (problems.length) throw new Error(`[perf] refusing to start: ${problems.join('; ')}. Run perf/bin/perf init-secrets.`)
  await pushSutEnv(sut)
  if (flags.build) await sut.compose(['build', 'app'], { capture: false })
  log('starting the om-perf stack (first boot runs mercato init and can take 10+ minutes)')
  await sut.compose(['up', '-d'], { capture: false })
  await waitForHealth(target.CONTROL_BASE_URL, { log })
  await ensureStatementsExtension(sut, database)
  log(`healthy: ${target.CONTROL_BASE_URL}/api/healthz`)
}

export async function down(flags) {
  const { sut } = loadContext()
  await sut.compose(['down', ...(flags.volumes ? ['--volumes'] : [])], { capture: false })
  if (flags['purge-secrets']) {
    for (const file of ['users.json', 'owners.json', 'tenant.json', 'background-tenants.json']) {
      rmSync(statePath(file), { force: true })
    }
    log('deleted users.json, owners.json, tenant.json and background-tenants.json (sut.local.env and snapshot keys are kept)')
  }
  if (flags.volumes) {
    rmSync(statePath('last-restore.json'), { force: true })
    const snapshotsDir = statePath('snapshots')
    if (existsSync(snapshotsDir)) {
      for (const file of readdirSync(snapshotsDir).filter((name) => name.endsWith('.json'))) rmSync(join(snapshotsDir, file), { force: true })
    }
    log('volumes removed: the Postgres template databases are gone, so snapshot markers were deleted (key backups kept).')
    log('the meili_<tier>_template volumes are not compose volumes and stay; remove them with `docker volume rm` if unwanted.')
  }
}

function summarizeState() {
  if (!existsSync(STATE_DIR)) return ['no state yet']
  const lines = []
  const tenant = readJsonFile(statePath('tenant.json'), null)
  if (tenant) lines.push(`tenant ${tenant.tenantId} org ${tenant.organizationId} admin ${tenant.adminEmail}`)
  const users = readJsonFile(statePath('users.json'), null)
  if (users) lines.push(`users: ${users.length}`)
  const restore = readJsonFile(statePath('last-restore.json'), null)
  if (restore) lines.push(`last restore: tier ${restore.tier} at ${restore.restoredAt}, loadPhaseRanSince=${restore.loadPhaseRanSince}`)
  const snapshotsDir = statePath('snapshots')
  if (existsSync(snapshotsDir)) {
    for (const file of readdirSync(snapshotsDir).filter((name) => name.endsWith('.json'))) {
      const snapshot = readJsonFile(join(snapshotsDir, file))
      lines.push(`snapshot ${snapshot.tier}: ${snapshot.snapshotId} (${snapshot.createdAt}, ${Math.round(snapshot.durationMs / 1000)} s)`)
    }
  }
  return lines.length ? lines : ['no state yet']
}

export async function status() {
  const { target, sut } = loadContext()
  log(`target ${target.PERF_TARGET_NAME} (${target.PERF_TARGET_KIND}) base ${target.BASE_URL} control ${target.CONTROL_BASE_URL}`)
  const ps = await sut.compose(['ps', '--format', 'table {{.Service}}\t{{.State}}\t{{.Status}}'], { allowFail: true })
  process.stdout.write(ps.stdout || ps.stderr)
  for (const line of summarizeState()) log(line)
}

export async function lint() {
  const scenariosDir = join(PERF_ROOT, 'k6', 'scenarios')
  if (!existsSync(scenariosDir)) throw new Error('[perf] perf/k6/scenarios does not exist yet')
  const files = readdirSync(scenariosDir).filter((name) => name.endsWith('.js')).sort()
  if (!files.length) throw new Error('[perf] no scenario files to lint')
  const target = existsSync(TARGET_ENV_PATH) ? loadTarget() : { BASE_URL: 'https://tls:8443', K6_NETWORK: '' }
  const environment = k6Environment({ target, tier: 'XS', scenario: 'lint', profile: 'mini', runId: 'lint', outDir: '/out' })
  mkdirSync(join(STATE_DIR, 'k6-lint'), { recursive: true })
  let failures = 0
  for (const file of files) {
    const envArgs = Object.entries(environment).flatMap(([key, value]) => ['-e', `${key}=${value}`])
    const result = await runProcess('docker', generatorCompose(target, { offline: true }, ['run', '--rm', '--no-deps', ...envArgs, 'k6', 'inspect', `/perf/k6/scenarios/${file}`]), { allowFail: true, env: { PERF_OUT_DIR: join(STATE_DIR, 'k6-lint'), PERF_UID: String(process.getuid?.() ?? 12345), PERF_GID: String(process.getgid?.() ?? 12345) } })
    log(`${result.code === 0 ? 'ok  ' : 'FAIL'} ${file}`)
    if (result.code !== 0) {
      failures += 1
      process.stdout.write(`${result.stderr.slice(-1500)}\n`)
    }
  }
  if (failures) throw new Error(`[perf] ${failures} scenario(s) failed k6 inspect`)
}
