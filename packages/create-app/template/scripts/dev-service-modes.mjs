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

export async function chooseServiceMode({ argv = [], input = process.stdin, output = process.stdout } = {}) {
  const mode = resolveServiceMode(argv)
  if (argv.some((arg) => MODE_FLAGS.has(arg)) || argv.includes('--non-interactive') || !input.isTTY || !output.isTTY || process.env.CI) return mode
  const prompt = createInterface({ input, output })
  try {
    const answer = (await prompt.question('Services: [1] reuse configured services (default), [2] ephemeral Testcontainers, [3] Docker Compose on random ports, [4] Docker Compose on configured ports: ')).trim()
    if (!answer || answer === '1') return 'reuse'
    if (answer === '2') return 'ephemeral'
    if (answer === '3') return 'random'
    if (answer === '4') return 'compose'
    throw new Error('Invalid service choice. Re-run setup and choose 1, 2, 3, or 4.')
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

function localCredential(value) {
  return /[^A-Za-z0-9_.-]/.test(value) ? `local_${crypto.createHash('sha256').update(value).digest('hex').slice(0, 32)}` : value
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
            let next = envText(file)
            for (const key of keys) {
              next = next.replace(assignmentPattern(key), '')
              const raw = (originalText.get(file) ?? '').match(assignmentPattern(key))?.join('') ?? ''
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
    restored = failures.length === 0
    if (failures.length) throw new AggregateError(failures, 'Could not fully restore service configuration or stop ephemeral services; retry cleanup after resolving the filesystem or Docker error.')
  }

  try {
    const database = new URL(settings.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/open-mercato')
    database.search = ''
    const dbUser = localCredential(decodeURIComponent(database.username || settings.POSTGRES_USER || 'postgres'))
    const dbPassword = localCredential(decodeURIComponent(database.password || settings.POSTGRES_PASSWORD || 'postgres'))
    const dbName = localCredential(decodeURIComponent(database.pathname.slice(1) || settings.POSTGRES_DB || 'open-mercato'))
    database.username = encodeURIComponent(dbUser)
    database.password = encodeURIComponent(dbPassword)
    database.pathname = `/${encodeURIComponent(dbName)}`
    database.hash = ''
    changes.POSTGRES_USER = dbUser
    changes.POSTGRES_PASSWORD = dbPassword
    changes.POSTGRES_DB = dbName
    const meiliKey = localCredential(settings.MEILISEARCH_API_KEY || settings.MEILISEARCH_MASTER_KEY || 'meilisearch-dev-key')
    changes.MEILISEARCH_API_KEY = meiliKey
    changes.MEILISEARCH_MASTER_KEY = meiliKey
    const { GenericContainer, Wait } = mode === 'ephemeral' ? await loadTestcontainers() : {}
    for (const definition of services) {
      const { service, envKey, defaultPort } = definition
      let host = '127.0.0.1'
      let port
      if (mode === 'random') {
        do { port = await getPort() } while (Object.values(changes).includes(String(port)))
      } else {
        const definitions = {
          postgres: ['pgvector/pgvector:pg17-trixie', { POSTGRES_USER: dbUser, POSTGRES_PASSWORD: dbPassword, POSTGRES_DB: dbName }, ['pg_isready', '-U', dbUser, '-d', dbName]],
          redis: ['redis:7-alpine', {}, ['redis-cli', 'ping']],
          meilisearch: ['getmeili/meilisearch:v1.11', { MEILI_ENV: 'development', MEILI_MASTER_KEY: meiliKey, MEILI_NO_ANALYTICS: 'true' }, ['curl', '-fsS', 'http://127.0.0.1:7700/health']],
        }
        if (!definitions[service]) continue
        const [image, environment, healthCommand] = definitions[service]
        const container = await new GenericContainer(image).withEnvironment(environment).withExposedPorts(defaultPort).withHealthCheck({ test: ['CMD', ...healthCommand], interval: 1000, timeout: 3000, retries: 60, startPeriod: 1000 }).withWaitStrategy(Wait.forHealthCheck()).start()
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
          endpoint.password = ''
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
      const identity = `mercato-${crypto.createHash('sha256').update(path.resolve(projectDir)).digest('hex').slice(0, 10)}`
      changes.MERCATO_STACK = identity
      changes.COMPOSE_PROJECT_NAME = identity
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
    log(`[setup] ${mode === 'ephemeral' ? 'Ephemeral Testcontainers services are ready; configuration will be restored when setup/dev exits' : 'Random service ports and matching URLs saved to .env'}.`)
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
  log('Setup did not complete. Manual setup:')
  log('  1. Configure .env for your PostgreSQL, Redis and Meilisearch services (apps/mercato/.env in the monorepo).')
  log('     Or retry with yarn setup --random-ports, yarn setup --ephemeral, or yarn setup --infra.')
  log('  2. yarn install')
  if (monorepo) log('  3. yarn build:packages')
  log('  yarn generate')
  if (monorepo) log('  yarn build:packages')
  log('  yarn db:migrate')
  log(monorepo ? '  yarn initialize -- --skip-if-initialized' : '  yarn initialize --skip-if-initialized')
  log('  yarn dev --no-infra')
  log('Run database commands only against the intended database; reuse preserves your configured URLs.')
}
