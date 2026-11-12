import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
import { createInterface } from 'node:readline/promises'
import { parseEnv } from 'node:util'

const MODE_FLAGS = new Map([['--no-infra', 'reuse'], ['--reuse-services', 'reuse'], ['--ephemeral', 'ephemeral'], ['--random-ports', 'random'], ['--infra', 'compose']])
export const DEFAULT_SERVICES = [
  { service: 'postgres', envKey: 'POSTGRES_PORT', defaultPort: 5432 },
  { service: 'redis', envKey: 'REDIS_PORT', defaultPort: 6379 },
  { service: 'meilisearch', envKey: 'MEILISEARCH_PORT', defaultPort: 7700 },
]

export function resolveServiceMode(argv) {
  const modes = [...new Set(argv.filter((arg) => MODE_FLAGS.has(arg)).map((arg) => MODE_FLAGS.get(arg)))]
  if (modes.length > 1) throw new Error('Choose only one service option: --reuse-services, --ephemeral, --random-ports, or --infra.')
  return modes[0] ?? 'reuse'
}

const MENU = [['reuse', 'reuse configured services'], ['ephemeral', 'ephemeral Testcontainers'], ['random', 'Docker Compose on random ports'], ['compose', 'Docker Compose on configured ports']]

export class ServiceSelectionError extends Error {
  constructor(selection) {
    super(selection.reason)
    this.name = 'ServiceSelectionError'
    this.problem = selection.problem
  }
}

// Explicit flags keep their exact meaning. Without one, `selectDefault`
// (selectDefaultServiceMode from the infra preflight) picks the mode; a TTY
// may still choose, with that pick as the default. Non-interactive runs never
// prompt.
export async function chooseServiceMode({ argv = [], input = process.stdin, output = process.stdout, selectDefault, log = console.log } = {}) {
  const mode = resolveServiceMode(argv)
  if (argv.some((arg) => MODE_FLAGS.has(arg))) return mode
  const selection = selectDefault ? await selectDefault() : { mode: 'reuse' }
  if (!selection.mode) throw new ServiceSelectionError(selection)
  if (selection.reason) log(`\n🔎 ${selection.reason}\n`)
  if (argv.includes('--non-interactive') || !input.isTTY || !output.isTTY || process.env.CI) return selection.mode
  const prompt = createInterface({ input, output })
  try {
    const choices = MENU.map(([value, label], index) => `  [${index + 1}] ${label}${value === selection.mode ? ' (default)' : ''}`).join('\n')
    const answer = (await prompt.question(`\n🧩 Choose your services\n\n${choices}\n\n  Enter a number [1–4] or press Enter for the default: `)).trim()
    if (!answer) return selection.mode
    const picked = MENU[Number(answer) - 1]
    if (!/^[1-4]$/.test(answer) || !picked) throw new Error('Invalid service choice. Re-run setup and choose 1, 2, 3, or 4.')
    return picked[0]
  } finally {
    prompt.close()
  }
}

export async function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = address.port
      server.close((error) => error ? reject(error) : resolve(port))
    })
  })
}

function envText(file) {
  try { return fs.readFileSync(file, 'utf8') } catch (error) {
    if (error.code === 'ENOENT') return ''
    throw error
  }
}

function assignmentPattern(key) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error('Invalid service configuration key')
  return new RegExp(String.raw`^(?:export[ \t]+)?${key}[ \t]*=[ \t]*(?:"[^"]*"|'[^']*'|[^\r\n]*)(?:[^\r\n]*)(?:\r?\n|$)`, 'gm')
}

function replaceValues(text, values) {
  let result = text
  for (const [key, value] of Object.entries(values)) {
    const pattern = assignmentPattern(key)
    if (value === undefined) result = result.replace(pattern, '')
    else {
      const raw = String(value)
      if (/[\r\n']/.test(raw)) throw new Error(`Cannot safely serialize ${key}; remove line breaks and single quotes before selecting isolated services.`)
      const serialized = /^[A-Za-z0-9_./:@%?=&,+-]*$/.test(raw) ? raw : `'${raw}'`
      const line = `${key}=${serialized}\n`
      result = pattern.test(result) ? result.replace(pattern, () => line) : `${result}${result && !result.endsWith('\n') ? '\n' : ''}${line}`
    }
  }
  return result
}

export const SETUP_SERVICE_IMAGES = {
  postgres: 'pgvector/pgvector:pg17-trixie@sha256:7a7e9f22015b67edb4bef5c59daeebcd7e74bfa570df6ce60ae01237c8648a84',
  redis: 'redis:7-alpine@sha256:892022f9f18c26c92c30e15194d132f90044af87b94a491a75429bbc3982eab1',
  meilisearch: 'getmeili/meilisearch:v1.11@sha256:6f8f1fc29d1ff67b4d8d503bb4e0a69b55c8d42600decafde951344218193a27',
  ryuk: 'testcontainers/ryuk:0.14.0@sha256:7c1a8a9a47c780ed0f983770a662f80deb115d95cce3e2daa3d12115b8cd28f0',
}

function localCredentials(mode, projectDir, stored) {
  const identity = `mercato-local-v2-${crypto.createHash('sha256').update(path.resolve(projectDir)).digest('hex').slice(0, 10)}`
  const keys = ['OM_SETUP_LOCAL_POSTGRES_PASSWORD', 'OM_SETUP_LOCAL_REDIS_PASSWORD', 'OM_SETUP_LOCAL_MEILISEARCH_KEY']
  if (mode === 'random' && stored.OM_SETUP_LOCAL_STACK === identity) {
    if (!keys.every((key) => /^[a-f0-9]{48}$/.test(stored[key] ?? ''))) throw new Error('Owned local service credentials are incomplete. Restore the OM_SETUP_LOCAL_* values before reusing this stack; no services were changed.')
    let database = 'open_mercato_local'
    try {
      const previous = new URL(stored.DATABASE_URL)
      const selected = decodeURIComponent(previous.pathname.slice(1))
      if (previous.hostname === '127.0.0.1' && previous.username === 'mercato' && previous.password === stored[keys[0]] && /^[A-Za-z_][A-Za-z0-9_-]{0,62}$/.test(selected)) database = selected
    } catch {}
    return { identity, postgres: stored[keys[0]], redis: stored[keys[1]], meilisearch: stored[keys[2]], database }
  }
  return { identity, postgres: crypto.randomBytes(24).toString('hex'), redis: crypto.randomBytes(24).toString('hex'), meilisearch: crypto.randomBytes(24).toString('hex') }
}

function localUrl(raw, fallback, host, port) {
  const url = new URL(raw || fallback)
  url.hostname = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host
  url.port = String(port)
  return url.toString()
}

async function importTestcontainers(projectDir) {
  const candidates = [path.join(projectDir, 'package.json'), path.join(projectDir, 'node_modules', '@open-mercato', 'cli', 'package.json'), path.join(projectDir, '..', '..', 'packages', 'cli', 'package.json')]
  for (const candidate of candidates) {
    try {
      const require = createRequire(candidate)
      return require('testcontainers')
    } catch (error) {
      if (error.code !== 'MODULE_NOT_FOUND') throw error
    }
  }
  throw new Error('Testcontainers is unavailable. Run yarn install, then retry yarn setup --ephemeral.')
}

export async function configureServiceMode({ mode, projectDir, env = process.env, envFiles = [], services = DEFAULT_SERVICES, loadTestcontainers = () => importTestcontainers(projectDir), getPort = availablePort, log = console.log } = {}) {
  if (!['reuse', 'compose', 'random', 'ephemeral'].includes(mode)) throw new Error('Unknown service mode.')
  if (mode === 'reuse' || mode === 'compose') return { ok: true, mode, env, noInfra: mode === 'reuse' }
  const files = [...new Set([path.join(projectDir, '.env'), ...envFiles])]
  const before = new Map(files.map((file) => [file, parseEnv(envText(file))]))
  const settings = { ...Object.assign({}, ...files.slice(1).map((file) => before.get(file))), ...before.get(files[0]), ...env }
  const changes = {}
  const containers = []
  const written = new Map()
  const originalText = new Map(files.map((file) => [file, fs.existsSync(file) ? envText(file) : undefined]))
  let committed = false
  let interrupted = false
  const onSignal = () => { interrupted = true }
  if (mode === 'ephemeral') {
    process.on('SIGINT', onSignal)
    process.on('SIGTERM', onSignal)
  }
  let restored = false
  const restoreEnv = {}
  const previousRyuk = process.env.RYUK_CONTAINER_IMAGE
  let containersStopped = false
  const cleanup = async () => {
    if (restored) return
    const failures = []
    if (mode === 'ephemeral' || !committed) {
      for (const [file, content] of written) {
        try {
          if (envText(file) === content) {
            if (originalText.get(file) === undefined) fs.unlinkSync(file)
            else fs.writeFileSync(file, originalText.get(file), { mode: 0o600 })
          } else {
            const current = parseEnv(envText(file))
            const keys = Object.keys(changes).filter((key) => current[key] === String(changes[key]))
            let persistedDatabaseAssignment
            if (current.DATABASE_URL && changes.DATABASE_URL && current.DATABASE_URL !== changes.DATABASE_URL) {
              try {
                const active = new URL(current.DATABASE_URL)
                const owned = new URL(changes.DATABASE_URL)
                if (active.protocol === owned.protocol && active.hostname === owned.hostname && active.port === owned.port) {
                  keys.push('DATABASE_URL')
                  const previous = before.get(file).DATABASE_URL
                  persistedDatabaseAssignment = ''
                  if (previous) {
                    const restoredUrl = new URL(previous)
                    restoredUrl.pathname = active.pathname
                    const raw = (originalText.get(file) ?? '').match(assignmentPattern('DATABASE_URL'))?.join('') ?? ''
                    persistedDatabaseAssignment = raw.includes(previous) ? raw.replace(previous, () => restoredUrl.toString()) : raw
                  }
                }
              } catch {}
            }
            let next = envText(file)
            for (const key of keys) {
              next = next.replace(assignmentPattern(key), '')
              const raw = key === 'DATABASE_URL' && persistedDatabaseAssignment !== undefined
                ? persistedDatabaseAssignment
                : (originalText.get(file) ?? '').match(assignmentPattern(key))?.join('') ?? ''
              if (raw) next += `${next && !next.endsWith('\n') ? '\n' : ''}${raw}${raw.endsWith('\n') ? '' : '\n'}`
            }
            fs.writeFileSync(file, next, { mode: 0o600 })
          }
          written.delete(file)
        } catch (error) { failures.push(error) }
      }
      for (const [key, value] of Object.entries(restoreEnv)) {
        if (env[key] !== String(changes[key])) continue
        if (value === undefined) delete env[key]
        else env[key] = value
      }
    }
    if (!containersStopped) {
      const results = await Promise.allSettled(containers.map((container) => container.stop()))
      containersStopped = results.every((result) => result.status === 'fulfilled')
      if (!containersStopped) failures.push(new Error('Some ephemeral services could not be stopped; inspect Docker before retrying cleanup.'))
    }
    if (mode === 'ephemeral') {
      if (previousRyuk === undefined) delete process.env.RYUK_CONTAINER_IMAGE
      else process.env.RYUK_CONTAINER_IMAGE = previousRyuk
    }
    restored = failures.length === 0
    if (failures.length) throw new AggregateError(failures, 'Could not fully restore service configuration or stop ephemeral services; retry cleanup after resolving the filesystem or Docker error.')
  }

  try {
    const credentials = localCredentials(mode, projectDir, before.get(files[0]))
    const dbUser = 'mercato'
    const dbPassword = credentials.postgres
    const dbName = credentials.database ?? 'open_mercato_local'
    const database = new URL(`postgres://${dbUser}:${dbPassword}@127.0.0.1:5432/${dbName}`)
    changes.POSTGRES_USER = dbUser
    changes.POSTGRES_PASSWORD = dbPassword
    changes.POSTGRES_DB = dbName
    changes.REDIS_PASSWORD = credentials.redis
    changes.MEILISEARCH_API_KEY = credentials.meilisearch
    changes.MEILISEARCH_MASTER_KEY = credentials.meilisearch
    changes.INFRA_BIND_HOST = '127.0.0.1'
    if (mode === 'random') {
      changes.OM_SETUP_LOCAL_STACK = credentials.identity
      changes.OM_SETUP_LOCAL_POSTGRES_PASSWORD = credentials.postgres
      changes.OM_SETUP_LOCAL_REDIS_PASSWORD = credentials.redis
      changes.OM_SETUP_LOCAL_MEILISEARCH_KEY = credentials.meilisearch
    }
    const meiliKey = credentials.meilisearch
    if (mode === 'ephemeral') {
      if (previousRyuk && !/@sha256:[a-f0-9]{64}$/.test(previousRyuk)) throw new Error('RYUK_CONTAINER_IMAGE must use an immutable sha256 digest for ephemeral setup.')
      process.env.RYUK_CONTAINER_IMAGE = previousRyuk || SETUP_SERVICE_IMAGES.ryuk
    }
    const { GenericContainer, Wait } = mode === 'ephemeral' ? await loadTestcontainers() : {}
    for (const definition of services) {
      const { service, envKey, defaultPort } = definition
      let host = '127.0.0.1'
      let port
      if (mode === 'random') {
        do { port = await getPort() } while (Object.values(changes).includes(String(port)))
      } else {
        const definitions = {
          postgres: [SETUP_SERVICE_IMAGES.postgres, { POSTGRES_USER: dbUser, POSTGRES_PASSWORD: dbPassword, POSTGRES_DB: dbName }, ['pg_isready', '-U', dbUser, '-d', dbName]],
          redis: [SETUP_SERVICE_IMAGES.redis, { REDISCLI_AUTH: credentials.redis }, ['redis-cli', 'ping']],
          meilisearch: [SETUP_SERVICE_IMAGES.meilisearch, { MEILI_ENV: 'development', MEILI_MASTER_KEY: meiliKey, MEILI_NO_ANALYTICS: 'true' }, ['curl', '-fsS', 'http://127.0.0.1:7700/health']],
        }
        if (!definitions[service]) continue
        const [image, environment, healthCommand] = definitions[service]
        class LoopbackContainer extends GenericContainer {
          async beforeContainerCreated() {
            for (const bindings of Object.values(this.hostConfig?.PortBindings ?? {})) {
              for (const binding of bindings) binding.HostIp = '127.0.0.1'
            }
          }
        }
        const builder = new LoopbackContainer(image).withEnvironment(environment).withExposedPorts(defaultPort)
        if (service === 'redis') builder.withCommand(['redis-server', '--requirepass', credentials.redis])
        const container = await builder.withHealthCheck({ test: ['CMD', ...healthCommand], interval: 1000, timeout: 3000, retries: 60, startPeriod: 1000 }).withWaitStrategy(Wait.forHealthCheck()).start()
        containers.push(container)
        if (interrupted) throw new Error('Ephemeral service startup interrupted; started services were cleaned up.')
        host = container.getHost()
        port = container.getMappedPort(defaultPort)
      }
      changes[envKey] = String(port)
      if (service === 'postgres') changes.DATABASE_URL = localUrl(database.toString(), '', host, port)
      if (service === 'redis') {
        const redisKeys = new Set(['REDIS_URL', 'CACHE_REDIS_URL', 'QUEUE_REDIS_URL', 'EVENTS_REDIS_URL', 'DOCUMENTS_COLLAB_REDIS_URL', ...Object.keys(settings).filter((key) => key.endsWith('_REDIS_URL'))])
        for (const key of redisKeys) {
          const endpoint = new URL(localUrl(settings[key], 'redis://localhost:6379', host, port))
          endpoint.protocol = 'redis:'
          endpoint.search = ''
          endpoint.hash = ''
          endpoint.username = ''
          endpoint.password = credentials.redis
          changes[key] = endpoint.toString()
        }
      }
      if (service === 'meilisearch') {
        const endpoint = new URL(localUrl(settings.MEILISEARCH_HOST, 'http://localhost:7700', host, port))
        endpoint.protocol = 'http:'
        endpoint.pathname = '/'
        endpoint.search = ''
        endpoint.hash = ''
        endpoint.username = ''
        endpoint.password = ''
        changes.MEILISEARCH_HOST = endpoint.toString()
      }
    }
    if (mode === 'random') {
      changes.MERCATO_STACK = credentials.identity
      changes.COMPOSE_PROJECT_NAME = credentials.identity
    }
    for (const file of files) {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      const content = replaceValues(envText(file), changes)
      const temporary = `${file}.setup-${crypto.randomUUID()}.tmp`
      try {
        fs.writeFileSync(temporary, content, { mode: 0o600, flag: 'wx' })
        fs.renameSync(temporary, file)
        written.set(file, content)
      } finally {
        fs.rmSync(temporary, { force: true })
      }
    }
    for (const [key, value] of Object.entries(changes)) {
      restoreEnv[key] = env[key]
      env[key] = String(value)
    }
    committed = true
    log(`\n✅ ${mode === 'ephemeral' ? 'Ephemeral Testcontainers services are ready; configuration will be restored when setup/dev exits' : 'Random service ports and matching URLs saved to .env'}.`)
    return { ok: true, mode, env, noInfra: mode === 'ephemeral', cleanup: mode === 'ephemeral' ? cleanup : undefined }
  } catch (error) {
    await cleanup()
    throw error
  } finally {
    process.off('SIGINT', onSignal)
    process.off('SIGTERM', onSignal)
  }
}

export function printManualSetup({ log = console.error, monorepo = false } = {}) {
  log('')
  log('🔨 Setup did not complete. Manual setup:')
  log('')
  log('  1. Configure PostgreSQL, Redis and Meilisearch in your .env file:')
  log(monorepo ? '     apps/mercato/.env' : '     .env')
  log('')
  log('  2. Run these commands in order:')
  log('')
  log('     yarn install')
  if (monorepo) log('     yarn build:packages')
  log('     yarn generate')
  if (monorepo) log('     yarn build:packages')
  log('     yarn db:migrate')
  log(monorepo ? '     yarn initialize -- --skip-if-initialized' : '     yarn initialize --skip-if-initialized')
  log('     yarn dev --no-infra')
  log('')
  log('💡 Or retry setup with an isolated or Docker Compose stack:')
  log('')
  log('     yarn setup --random-ports   Docker Compose on free ports')
  log('     yarn setup --ephemeral      Temporary Testcontainers services')
  log('     yarn setup --infra          Docker Compose on configured ports')
  log('')
  log('🔒 Run database commands only against the intended database; reuse preserves your configured URLs.')
  log('')
}
