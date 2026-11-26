import { GENERATOR_PROJECT } from '../lib/paths.mjs'

const GENERATOR_FILE = 'perf/generator/compose.generator.yml'
export const K6_IMAGE = 'grafana/k6:1.8.2-with-browser'

const GENERATOR_OVERLAYS = {
  sut: 'perf/generator/compose.generator.local.yml',
  host: 'perf/generator/compose.generator.vps.yml',
  laptop: 'perf/generator/compose.generator.laptop.yml',
}

export function resolveGeneratorNetwork(target) {
  const mode = String(target.GENERATOR_NETWORK ?? '').trim()
  if (mode) {
    if (!GENERATOR_OVERLAYS[mode]) throw new Error(`[perf] GENERATOR_NETWORK must be one of ${Object.keys(GENERATOR_OVERLAYS).join(', ')}`)
    return mode
  }
  return target.K6_NETWORK ? 'sut' : 'host'
}

export function generatorCompose(target, { offline = false } = {}, args = []) {
  const files = ['-f', GENERATOR_FILE]
  if (!offline) files.push('-f', GENERATOR_OVERLAYS[resolveGeneratorNetwork(target)])
  return ['compose', '-p', GENERATOR_PROJECT, ...files, ...args]
}

export function k6Environment({ target, tier, scenario, profile, runId, outDir = '/out', samples, knee, label }) {
  const environment = {
    BASE_URL: target.BASE_URL,
    TIER: tier,
    CATALOG: `/perf/data/${tier}/catalog.json`,
    USERS: '/perf/.state/users.json',
    WORKLOAD: '/perf/config/workload.json',
    PROFILE: profile ?? scenario,
    RUN_ID: runId,
    PHASE: scenario,
    INSECURE_TLS: String(target.INSECURE_TLS ?? '1'),
    K6_PROMETHEUS_RW_SERVER_URL: target.PROM_RW_URL ?? '',
    K6_PROMETHEUS_RW_TREND_STATS: 'p(50),p(95),p(99),max',
    SUMMARY_OUT: `${outDir}/summary.json`,
  }
  if (samples !== undefined) environment.SAMPLES = String(samples)
  if (knee !== undefined) environment.KNEE_VUS = String(knee)
  if (label !== undefined) environment.LABEL = String(label)
  return environment
}

export const SCENARIO_FILES = {
  smoke: 'smoke.js',
  baseline: 'baseline.js',
  step: 'mixed.js',
  stress: 'mixed.js',
  soak: 'mixed.js',
  interference: 'interference.js',
  browser: 'browser.js',
}

export const DEFAULT_PROFILES = {
  smoke: 'smoke',
  baseline: 'baseline',
  step: 'step',
  stress: 'stress',
  soak: 'soak',
  interference: 'interference',
  browser: 'browser',
}

export function k6RunArgs({ scenario, runId, prometheus = true }) {
  const outputs = ['--out', 'csv=/out/metrics.csv.gz']
  if (prometheus) outputs.push('--out', 'experimental-prometheus-rw')
  return ['run', '--tag', `run_id=${runId}`, ...outputs, `/perf/k6/scenarios/${SCENARIO_FILES[scenario]}`]
}
