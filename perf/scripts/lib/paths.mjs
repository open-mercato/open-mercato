import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const PERF_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
export const REPO_ROOT = resolve(PERF_ROOT, '..')
export const CONFIG_DIR = join(PERF_ROOT, 'config')
export const STATE_DIR = join(PERF_ROOT, '.state')
export const DATA_DIR = join(PERF_ROOT, 'data')
export const RESULTS_DIR = join(PERF_ROOT, 'results')
export const SUT_ENV_RELATIVE = 'perf/config/sut.local.env'
export const SUT_ENV_PATH = join(REPO_ROOT, SUT_ENV_RELATIVE)
export const SUT_ENV_EXAMPLE = join(CONFIG_DIR, 'sut.example.env')
export const TARGET_ENV_PATH = join(CONFIG_DIR, 'target.local.env')
export const COMPOSE_PROJECT = 'om-perf'
export const GENERATOR_PROJECT = 'om-perf-gen'
export const COMPOSE_FILES = [
  'docker-compose.fullapp.yml',
  'perf/sut/compose.perf.yml',
  'perf/monitoring/compose.monitoring.yml',
]
export const APP_SERVICES = ['app', 'worker', 'scheduler']
export const TIERS = ['XS', 'S', 'M', 'L']

export function statePath(...segments) {
  return join(STATE_DIR, ...segments)
}

export function tierDataDir(tier) {
  return join(DATA_DIR, tier)
}

export function templateDatabaseName(tier) {
  return `perf_${tier.toLowerCase()}_template`
}

export function meiliTemplateVolume(tier) {
  return `meili_${tier.toLowerCase()}_template`
}

export function meiliDataVolume(deployEnv = 'perf') {
  return `mercato-meilisearch-data-${deployEnv}`
}
