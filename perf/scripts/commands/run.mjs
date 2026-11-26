import { existsSync, mkdirSync, chmodSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { envHash, notableEnv } from '../lib/env.mjs'
import { runProcess } from '../lib/exec.mjs'
import { log, loadContext, requireTier } from '../lib/context.mjs'
import { assertTargetAcknowledged, isLocalValidation } from '../lib/target.mjs'
import { datasetAgeDays, gitSha, hardwareFacts, imageDigest, queryMigrationHead, readModuleList } from '../lib/sutinfo.mjs'
import { readJsonFile, writeJsonFile, writeTextFile } from '../lib/state.mjs'
import { APP_SERVICES, CONFIG_DIR, RESULTS_DIR, statePath, tierDataDir } from '../lib/paths.mjs'
import { calibrate } from '../calibrate.mjs'
import { capturePgSnapshot, resetStatements } from '../pg-snapshot.mjs'
import { generateReport } from '../report.mjs'
import { compareRunDirs } from '../compare.mjs'
import { DEFAULT_PROFILES, K6_IMAGE, SCENARIO_FILES, generatorCompose, k6Environment, k6RunArgs } from './generator.mjs'

const LOG_SERVICES = [...APP_SERVICES, 'postgres', 'redis', 'meilisearch', 'tls']

export function buildRunId({ date, tier, scenario, label }) {
  const safeLabel = String(label ?? 'run').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'run'
  return `${date}-${tier}-${scenario}-${safeLabel}`
}

function uniqueRunDir(runId) {
  let candidate = runId
  let suffix = 2
  while (existsSync(join(RESULTS_DIR, candidate))) {
    candidate = `${runId}-${suffix}`
    suffix += 1
  }
  return { runId: candidate, dir: join(RESULTS_DIR, candidate) }
}

export function assertRunnable({ restoreMarker, tier, scenario }) {
  if (!restoreMarker) throw new Error('[perf] no restore marker (perf/.state/last-restore.json); run perf/bin/perf restore --tier <T> first')
  if (restoreMarker.loadPhaseRanSince) throw new Error(`[perf] a load phase already ran since the last restore (${restoreMarker.restoredAt}); run perf/bin/perf restore --tier ${restoreMarker.tier}`)
  if (restoreMarker.tier !== tier) throw new Error(`[perf] the SUT holds tier ${restoreMarker.tier}, not ${tier}; restore tier ${tier} first`)
  if (!SCENARIO_FILES[scenario]) throw new Error(`[perf] unknown scenario ${scenario}; use one of ${Object.keys(SCENARIO_FILES).join(', ')}`)
}

async function k6Version(target) {
  mkdirSync(statePath('k6-lint'), { recursive: true })
  const result = await runProcess('docker', generatorCompose(target, { offline: true }, ['run', '--rm', '--no-deps', 'k6', 'version']), { allowFail: true, env: { PERF_OUT_DIR: statePath('k6-lint') } })
  return result.stdout.trim().split('\n')[0] || K6_IMAGE
}

async function collectLogs(sut, since, rawDir) {
  for (const service of LOG_SERVICES) {
    const result = await sut.compose(['logs', '--no-color', '--no-log-prefix', '--since', since, service], { allowFail: true })
    writeTextFile(join(rawDir, 'logs', `${service}.log`), `${result.stdout}${result.stderr}`)
  }
}

async function buildRunMetadata(context, { runId, scenario, profile, tier, flags, restoreMarker }) {
  const { target, sut, sutEnv, database, deployEnv } = context
  const manifest = readJsonFile(join(tierDataDir(tier), 'manifest.json'), null)
  const modules = readModuleList()
  return {
    runId,
    scenario,
    profile,
    tier,
    label: flags.label ?? null,
    gitSha: await gitSha(sut),
    imageDigest: await imageDigest(sut, `open-mercato/app:${deployEnv}`),
    modules: modules.staticIds,
    conditionalModules: modules.conditionalIds,
    envHash: envHash(sutEnv),
    envNotable: notableEnv(sutEnv),
    hardwareProfile: target.HARDWARE_PROFILE,
    hardware: await hardwareFacts(sut),
    generatorLocation: target.GENERATOR_LOCATION,
    targetName: target.PERF_TARGET_NAME,
    rtt: null,
    k6Version: await k6Version(target),
    migrationHead: await queryMigrationHead(sut, database),
    datasetAnchor: manifest?.anchor ?? null,
    datasetAgeDays: datasetAgeDays(manifest?.anchor),
    datasetChecksum: manifest?.checksum ?? null,
    datasetSeed: manifest?.seed ?? null,
    snapshotId: restoreMarker.snapshotId,
    startedAt: null,
    finishedAt: null,
    params: { samples: flags.samples ?? null, knee: flags.knee ?? null, workload: readJsonFile(join(CONFIG_DIR, 'workload.json')).name ?? null },
    localValidation: isLocalValidation(target),
    k6ExitCode: null,
  }
}

async function runK6(target, { scenario, profile, runId, tier, rawDir, flags }) {
  const environment = k6Environment({ target, tier, scenario, profile, runId, samples: flags.samples, knee: flags.knee, label: flags.label })
  const envArgs = Object.entries(environment).flatMap(([key, value]) => ['-e', `${key}=${value}`])
  const args = generatorCompose(target, {}, ['run', '--rm', '--no-deps', ...envArgs, 'k6', ...k6RunArgs({ scenario, runId, prometheus: Boolean(target.PROM_RW_URL) })])
  const uid = typeof process.getuid === 'function' ? String(process.getuid()) : '12345'
  const gid = typeof process.getgid === 'function' ? String(process.getgid()) : '12345'
  const result = await runProcess('docker', args, { capture: false, allowFail: true, env: { PERF_OUT_DIR: rawDir, PERF_UID: uid, PERF_GID: gid } })
  return result.code
}

export async function run(positional, flags) {
  const scenario = positional[0]
  if (!scenario) throw new Error('[perf] usage: perf/bin/perf run <smoke|baseline|step|stress|soak|interference|browser> [--tier T] [--profile P] [--label L] [--samples N] [--knee N]')
  const context = loadContext()
  const { target, sut, database } = context
  assertTargetAcknowledged(target, flags)
  const restoreMarker = readJsonFile(statePath('last-restore.json'), null)
  const tier = requireTier(flags.tier ?? restoreMarker?.tier ?? 'S')
  assertRunnable({ restoreMarker, tier, scenario })
  for (const required of [join(tierDataDir(tier), 'catalog.json'), statePath('users.json')]) {
    if (!existsSync(required)) throw new Error(`[perf] missing ${required}`)
  }
  const profile = flags.profile ?? DEFAULT_PROFILES[scenario]
  const date = new Date().toISOString().slice(0, 10)
  const { runId, dir } = uniqueRunDir(buildRunId({ date, tier, scenario, label: flags.label ?? profile }))
  const rawDir = join(dir, 'raw')
  mkdirSync(rawDir, { recursive: true })
  chmodSync(rawDir, 0o777)
  const metadata = await buildRunMetadata(context, { runId, scenario, profile, tier, flags, restoreMarker })
  log(`calibrating RTT against ${target.CALIBRATE_URL}`)
  metadata.rtt = await calibrate(target.CALIBRATE_URL, { samples: 30 })
  if (metadata.rtt.failures > 0) throw new Error(`[perf] ${metadata.rtt.failures}/30 calibration requests to ${target.CALIBRATE_URL} failed; the target is not healthy or not the configured SUT`)
  await resetStatements(sut, database)
  metadata.startedAt = new Date().toISOString()
  writeJsonFile(join(dir, 'run.json'), metadata)
  writeJsonFile(statePath('last-restore.json'), { ...restoreMarker, loadPhaseRanSince: true, lastRunId: runId })
  log(`run ${runId}: k6 ${SCENARIO_FILES[scenario]} profile ${profile}`)
  const exitCode = await runK6(target, { scenario, profile, runId, tier, rawDir, flags })
  metadata.finishedAt = new Date().toISOString()
  metadata.k6ExitCode = exitCode
  writeJsonFile(join(dir, 'run.json'), metadata)
  log(`k6 exited with ${exitCode}; capturing the database snapshot and logs`)
  const requestCount = readRequestCount(rawDir)
  await capturePgSnapshot(sut, { database, since: metadata.startedAt, requestCount, outDir: rawDir })
  await collectLogs(sut, metadata.startedAt, rawDir)
  const result = await generateReport(dir, { promUrl: target.PROM_QUERY_URL })
  log(`report: ${result.reportPath}`)
  if (exitCode !== 0) log(exitCode === 99 ? 'a k6 threshold/safety abort fired; stop and report before continuing' : `k6 failed with exit code ${exitCode}`)
  return exitCode
}

function readRequestCount(rawDir) {
  const summaryPath = join(rawDir, 'summary.json')
  if (!existsSync(summaryPath)) return null
  const summary = readJsonFile(summaryPath)
  return summary?.metrics?.http_reqs?.values?.count ?? null
}

export async function report(positional, flags) {
  const runDir = positional[0]
  if (!runDir) throw new Error('[perf] usage: perf/bin/perf report <run-dir>')
  const { target } = loadContext({ requireSutEnv: false })
  const result = await generateReport(resolve(runDir), { promUrl: flags.prom ?? target.PROM_QUERY_URL })
  log(`report: ${result.reportPath}`)
}

export async function compare(positional, flags) {
  if (positional.length !== 2) throw new Error('[perf] usage: perf/bin/perf compare <run-dir-a> <run-dir-b> [--force]')
  const markdown = compareRunDirs(resolve(positional[0]), resolve(positional[1]), { force: Boolean(flags.force) })
  if (flags.out) writeTextFile(resolve(flags.out), markdown)
  process.stdout.write(markdown)
}
