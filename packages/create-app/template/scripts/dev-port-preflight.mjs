import fs from 'node:fs'
import { createServer } from 'node:net'
import path from 'node:path'
import { parseEnv } from 'node:util'

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])
const DEFAULT_SEARCH_LIMIT = 20
const APP_ENV_FILE_NAMES = ['.env', '.env.development', '.env.local', '.env.development.local']
const BUSY_ERROR_CODES = new Set(['EADDRINUSE', 'EACCES'])

export function readAppEnvFileValues(appDir, keys, fsImpl = fs) {
  const values = {}
  for (const fileName of APP_ENV_FILE_NAMES) {
    let parsed
    try {
      parsed = parseEnv(fsImpl.readFileSync(path.join(appDir, fileName), 'utf8'))
    } catch {
      continue
    }
    for (const key of keys) {
      if (parsed[key] !== undefined) values[key] = parsed[key]
    }
  }
  return values
}

export function isPortAvailable(port, host) {
  return new Promise((resolve) => {
    const probe = createServer()
    probe.unref()
    probe.once('error', (error) => resolve(!BUSY_ERROR_CODES.has(error?.code)))
    probe.listen({ port, host, exclusive: true }, () => {
      probe.close(() => resolve(true))
    })
  })
}

// `next dev` binds the wildcard address, so a server on either loopback family
// or on 0.0.0.0 makes the port unusable for it.
export async function isAppPortFree(port, probe = isPortAvailable) {
  for (const host of [undefined, '127.0.0.1', '::1']) {
    try {
      if (!await probe(port, host)) return false
    } catch {
      return false
    }
  }
  return true
}

function parseUrl(value) {
  if (typeof value !== 'string' || value.trim().length === 0) return null
  try {
    return new URL(value.trim())
  } catch {
    return null
  }
}

function isLoopbackUrl(url) {
  return url !== null && LOOPBACK_HOSTS.has(url.hostname.toLowerCase())
}

function withPort(value, port) {
  const url = parseUrl(value)
  if (!url) return value
  url.port = String(port)
  return url.toString().replace(/\/$/, value.trim().endsWith('/') ? '/' : '')
}

// Next.js silently moves to the next port when the configured one is taken,
// while the splash, the readiness probe and APP_URL redirects keep pointing at
// whatever already answers there. Settle the port once, before anything starts.
//
// env: the parent process env (PORT / APP_URL set in the shell are explicit).
// appEnvFileValues: APP_URL / NEXT_PUBLIC_APP_URL read from the app's .env files.
// Returns { status: 'free' | 'moved' | 'busy', port, envOverrides }.
export async function resolveAppPortPreflight({
  port,
  env = {},
  appEnvFileValues = {},
  isFree = isAppPortFree,
  searchLimit = DEFAULT_SEARCH_LIMIT,
} = {}) {
  if (!Number.isInteger(port) || port <= 0) return { status: 'free', port, envOverrides: {} }
  if (await isFree(port)) return { status: 'free', port, envOverrides: {} }

  const explicitlyPinned = (typeof env.PORT === 'string' && env.PORT.trim().length > 0)
    || (typeof env.APP_URL === 'string' && env.APP_URL.trim().length > 0)
  const fileAppUrl = appEnvFileValues.APP_URL
  const filePublicAppUrl = appEnvFileValues.NEXT_PUBLIC_APP_URL
  const fileUrlsMovable = [fileAppUrl, filePublicAppUrl]
    .every((value) => value === undefined || isLoopbackUrl(parseUrl(value)))
  if (explicitlyPinned || !fileUrlsMovable) return { status: 'busy', port, envOverrides: {} }

  for (let candidate = port + 1; candidate <= Math.min(port + searchLimit, 65535); candidate += 1) {
    if (!await isFree(candidate)) continue
    const envOverrides = { PORT: String(candidate) }
    envOverrides.APP_URL = fileAppUrl !== undefined ? withPort(fileAppUrl, candidate) : `http://localhost:${candidate}`
    if (filePublicAppUrl !== undefined) envOverrides.NEXT_PUBLIC_APP_URL = withPort(filePublicAppUrl, candidate)
    return { status: 'moved', port: candidate, envOverrides }
  }

  return { status: 'busy', port, envOverrides: {} }
}
