import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { parseEnv } from 'node:util'

const DEFAULT_TIMEOUT_MS = 5000

function readSettings(projectDir, envFiles, env) {
  const settings = {}
  for (const file of [...envFiles, path.join(projectDir, '.env')]) {
    try { Object.assign(settings, parseEnv(fs.readFileSync(file, 'utf8'))) }
    catch (error) { if (error.code !== 'ENOENT') throw new Error('Cannot read service configuration. Check the permissions and syntax of the project .env files.') }
  }
  return Object.assign(settings, env)
}

async function loadClientModule(projectDir, name) {
  const manifests = [path.join(projectDir, 'package.json'), path.join(projectDir, 'node_modules', '@open-mercato', 'cli', 'package.json'), path.join(projectDir, '..', '..', 'packages', 'cli', 'package.json')]
  for (const manifest of manifests) {
    try { return createRequire(manifest)(name) }
    catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error }
  }
  throw Object.assign(new Error('Service connection dependency is unavailable.'), { code: 'MISSING_DEPENDENCY' })
}

function endpoint(url) {
  return `${url.protocol}//${url.host}${url.protocol.startsWith('postgres') ? url.pathname : ''}`
}

export class ServiceConnectionError extends Error {
  constructor(service, envKey, target, kind) {
    const advice = {
      authentication: 'The service rejected the configured credentials or permissions. Check the username/password or API key and access rights in .env.',
      unreachable: 'The service is unreachable or timed out. Start it and check the configured host, port, network, and TLS settings.',
      dependency: 'Install project dependencies with yarn install, then retry setup.',
      configuration: 'The service URL is missing or invalid. Check its value in .env.',
      database: 'The configured PostgreSQL database does not exist. Create it or select the intended existing database in .env.',
      connection: 'The service connection check failed. Check its configuration and server logs before retrying setup.',
    }
    super(`[setup] ${service} connection failed (${envKey}${target ? ` at ${target}` : ''}). ${advice[kind]}`)
    this.name = 'ServiceConnectionError'
    this.service = service
    this.envKey = envKey
    this.kind = kind
  }
}

function failureKind(error) {
  const code = error.code ?? error.cause?.code
  if (error.code === 'MISSING_DEPENDENCY') return 'dependency'
  if (error.code === '28P01' || error.code === '28000' || /WRONGPASS|NOAUTH|NOPERM|\bAUTH\b|invalid username-password/i.test(error.message ?? '')) return 'authentication'
  if (error.code === '3D000') return 'database'
  if (['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EHOSTUNREACH', 'CONNECTION_TIMEOUT'].includes(code) || ['TimeoutError', 'AbortError'].includes(error.name) || /timeout|timed out/i.test(error.message ?? '')) return 'unreachable'
  return 'connection'
}

function parseTarget(raw, protocols, service, key) {
  try {
    const url = new URL(raw)
    if (!protocols.includes(url.protocol) || !url.hostname) throw new Error('Invalid service URL')
    return url
  } catch { throw new ServiceConnectionError(service, key, '', 'configuration') }
}

async function bounded(operation, timeoutMs) {
  let timer
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error('Connection timed out'), { code: 'CONNECTION_TIMEOUT' })), timeoutMs) }),
    ])
  } finally { clearTimeout(timer) }
}

// A Redis URL that belongs to an optional feature is only verified when that
// feature is switched on: .env.example ships DOCUMENTS_COLLAB_REDIS_URL, but
// realtime collaboration stays off until NEXT_PUBLIC_DOCUMENTS_COLLAB_URL is set,
// so a machine without Redis must not fail setup on it.
const OPTIONAL_REDIS_KEYS = { DOCUMENTS_COLLAB_REDIS_URL: 'NEXT_PUBLIC_DOCUMENTS_COLLAB_URL' }

export function redisKeyInUse(key, settings) {
  const enabledBy = OPTIONAL_REDIS_KEYS[key]
  return !enabledBy || Boolean(settings[enabledBy]?.trim())
}

export async function verifyServiceConnections({ projectDir = process.cwd(), envFiles = [], env = process.env, timeoutMs = DEFAULT_TIMEOUT_MS, loadModule = loadClientModule, fetchImpl = fetch, log = console.log } = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) throw new Error('Service connection timeout must be a positive integer.')
  const settings = readSettings(projectDir, envFiles, env)
  const checked = []
  const database = parseTarget(settings.DATABASE_URL, ['postgres:', 'postgresql:'], 'PostgreSQL', 'DATABASE_URL')
  try {
    const { Client } = await loadModule(projectDir, 'pg')
    const probePostgres = async (target) => {
      const client = new Client({ connectionString: target.toString(), connectionTimeoutMillis: timeoutMs, query_timeout: timeoutMs, statement_timeout: timeoutMs })
      client.on?.('error', () => {})
      try {
        await bounded(() => client.connect(), timeoutMs)
        await bounded(() => client.query('SELECT 1'), timeoutMs)
      } finally {
        try { await bounded(() => client.end(), Math.min(timeoutMs, 1000)) }
        catch { client.connection?.stream?.destroy() }
      }
    }
    try {
      await probePostgres(database)
      log(`[setup] PostgreSQL connection verified at ${endpoint(database)}.`)
    } catch (error) {
      if (error.code !== '3D000') throw error
      const maintenance = new URL(database)
      maintenance.pathname = '/postgres'
      maintenance.searchParams.delete('database')
      maintenance.searchParams.delete('dbname')
      await probePostgres(maintenance)
      log(`[setup] PostgreSQL credentials verified at ${endpoint(maintenance)}. The selected database does not exist yet; initialization will handle its creation.`)
    }
    checked.push('DATABASE_URL')
  } catch (error) {
    throw new ServiceConnectionError('PostgreSQL', 'DATABASE_URL', endpoint(database), failureKind(error))
  }

  const redisKeys = Object.keys(settings).filter((key) => (key === 'REDIS_URL' || key.endsWith('_REDIS_URL')) && settings[key]?.trim() && redisKeyInUse(key, settings))
  for (const key of redisKeys) {
    const target = parseTarget(settings[key], ['redis:', 'rediss:'], 'Redis', key)
    let redis
    let redisFailure
    try {
      const module = await loadModule(projectDir, 'ioredis')
      const Redis = module.default ?? module.Redis ?? module
      redis = new Redis(target.toString(), { lazyConnect: true, connectTimeout: timeoutMs, commandTimeout: timeoutMs, maxRetriesPerRequest: 0, enableOfflineQueue: false, retryStrategy: () => null })
      redis.on('error', (error) => { redisFailure = error })
      await bounded(() => redis.connect(), timeoutMs)
      const reply = await bounded(() => redis.ping(), timeoutMs)
      if (reply !== 'PONG') throw new Error('Unexpected Redis reply')
      checked.push(key)
      log(`[setup] Redis connection verified for ${key} at ${endpoint(target)}.`)
    } catch (error) {
      throw new ServiceConnectionError('Redis', key, endpoint(target), failureKind(redisFailure ?? error))
    } finally { redis?.disconnect() }
  }

  if (settings.MEILISEARCH_HOST?.trim()) {
    const target = parseTarget(settings.MEILISEARCH_HOST, ['http:', 'https:'], 'Meilisearch', 'MEILISEARCH_HOST')
    try {
      const api = new URL(target)
      api.pathname = `${api.pathname.replace(/\/$/, '')}/indexes`
      api.search = '?limit=1'
      api.hash = ''
      const key = settings.MEILISEARCH_API_KEY
      const response = await bounded(() => fetchImpl(api, { method: 'GET', headers: key ? { Authorization: `Bearer ${key}` } : {}, signal: AbortSignal.timeout(timeoutMs) }), timeoutMs)
      try {
        if (response.status === 401 || response.status === 403) throw Object.assign(new Error('API key rejected'), { code: '28000' })
        if (!response.ok) throw new Error('Protected API request failed')
        const payload = await bounded(() => response.json(), timeoutMs)
        if (!payload || !Array.isArray(payload.results)) throw new Error('Unexpected Meilisearch API response')
        checked.push('MEILISEARCH_HOST')
        log(`[setup] Meilisearch authenticated API connection verified at ${endpoint(target)}.`)
      } finally {
        if (response.body && !response.bodyUsed && !response.body.locked) {
          try { await bounded(() => response.body.cancel(), Math.min(timeoutMs, 1000)) } catch {}
        }
      }
    } catch (error) {
      throw new ServiceConnectionError('Meilisearch', 'MEILISEARCH_HOST / MEILISEARCH_API_KEY', endpoint(target), failureKind(error))
    }
  }
  return { ok: true, checked }
}
