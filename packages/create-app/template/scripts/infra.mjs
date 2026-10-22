#!/usr/bin/env node
// Local infrastructure for this app: PostgreSQL, Redis and Meilisearch from
// the app's own docker-compose.yml.
//
//   yarn infra:up [--profile agents]   start + wait for the healthchecks
//   yarn infra:down [--volumes --yes]  stop (data is kept unless --volumes --yes)
//
// `yarn setup` calls ensureInfra() before any database step; `yarn setup
// --no-infra` skips this module entirely. The Docker preflight itself lives in
// dev-infra-preflight.mjs, mirrored from the monorepo starter.
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'

import { detectDockerRuntime, formatInfraProblem, startInfraServices } from './dev-infra-preflight.mjs'

export const INFRA_SERVICES = [
  { service: 'postgres', envKey: 'POSTGRES_PORT', defaultPort: 5432 },
  { service: 'redis', envKey: 'REDIS_PORT', defaultPort: 6379 },
  { service: 'meilisearch', envKey: 'MEILISEARCH_PORT', defaultPort: 7700 },
]
const AGENTS_SERVICE = { service: 'opencode', envKey: 'OPENCODE_PORT', defaultPort: 4096 }
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', 'host.docker.internal'])

export function readDotEnv(projectDir) {
  try {
    return parseEnv(fs.readFileSync(path.join(projectDir, '.env'), 'utf8'))
  } catch {
    return {}
  }
}

// Same precedence docker compose uses for ${VAR:-default}: shell env, then
// .env, then the compose default.
export function resolveInfraServices(projectDir, { env = process.env, profiles = [] } = {}) {
  const dotEnv = readDotEnv(projectDir)
  const definitions = profiles.includes('agents') ? [...INFRA_SERVICES, AGENTS_SERVICE] : INFRA_SERVICES
  return definitions.map(({ service, envKey, defaultPort }) => {
    const parsed = Number.parseInt(String(env[envKey] ?? dotEnv[envKey] ?? '').trim(), 10)
    const port = Number.isInteger(parsed) && parsed > 0 && parsed < 65536 ? parsed : defaultPort
    return { service, port, envKey }
  })
}

// Infra never rewrites DATABASE_URL. When it points elsewhere, say so instead
// of silently starting a local database the app will not use.
export function externalDatabaseHost(projectDir, env = process.env) {
  const raw = env.DATABASE_URL ?? readDotEnv(projectDir).DATABASE_URL
  if (!raw) return null
  try {
    const host = new URL(raw).hostname.toLowerCase()
    return host && !LOOPBACK_HOSTS.has(host) ? host : null
  } catch {
    return null
  }
}

export function parseInfraArgs(argv) {
  const options = { action: null, profiles: [], volumes: false, yes: false, unknown: [] }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if ((arg === 'up' || arg === 'down') && !options.action) options.action = arg
    else if (arg === '--profile' && argv[index + 1]) options.profiles.push(argv[++index])
    else if (arg === '--volumes') options.volumes = true
    else if (arg === '--yes') options.yes = true
    else options.unknown.push(arg)
  }
  return options
}

export function printInfraProblem(problem, { error = console.error } = {}) {
  const [title, ...rest] = formatInfraProblem(problem)
  error(`❌ ${title}`)
  for (const line of rest) error(` ${line}`)
}

export async function ensureInfra({
  projectDir = process.cwd(),
  env = process.env,
  profiles = [],
  log = console.log,
  error = console.error,
  startImpl = startInfraServices,
} = {}) {
  const services = resolveInfraServices(projectDir, { env, profiles })
  log(`🐳 Starting local infrastructure (${services.map(({ service, port }) => `${service} :${port}`).join(', ')})...`)
  const externalHost = externalDatabaseHost(projectDir, env)
  if (externalHost) {
    log(`   DATABASE_URL points at ${externalHost}; it is kept as is. Use --no-infra to skip the local containers.`)
  }
  const outcome = await startImpl({
    composeArgs: (extra) => ['compose', ...extra],
    services,
    upArgs: profiles.flatMap((profile) => ['--profile', profile]),
    cwd: projectDir,
    log,
  })
  if (!outcome.ok) {
    printInfraProblem(outcome.problem, { error })
    return outcome
  }
  log('✅ Local infrastructure is up and healthy.')
  return outcome
}

export function infraDown({ projectDir = process.cwd(), volumes = false, spawnSyncImpl = spawnSync } = {}) {
  const result = spawnSyncImpl('docker', ['compose', 'down', ...(volumes ? ['--volumes'] : [])], { cwd: projectDir, stdio: 'inherit', windowsHide: true })
  return result?.error ? 1 : (result?.status ?? 1)
}

async function main() {
  const options = parseInfraArgs(process.argv.slice(2))
  if (!options.action || options.unknown.length > 0) {
    console.error('Usage: yarn infra:up [--profile agents] | yarn infra:down [--volumes --yes]')
    process.exit(1)
  }
  if (options.action === 'up') {
    const outcome = await ensureInfra({ profiles: options.profiles })
    if (outcome.ok) console.log('   Next: yarn setup (first run) or yarn dev')
    process.exit(outcome.ok ? 0 : 2)
  }
  if (options.volumes && !options.yes) {
    console.error('❌ --volumes DELETES all local database and search data. Re-run with --yes to confirm.')
    process.exit(1)
  }
  const runtime = detectDockerRuntime()
  if (!runtime.ok) {
    printInfraProblem({ code: runtime.code, detail: runtime.detail })
    process.exit(2)
  }
  process.exit(infraDown({ volumes: options.volumes }))
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isDirectRun) await main()
