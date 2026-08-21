import { randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { assertSafeVariables, formatVariableValue } from './redaction'

export type RailwayServiceRole = 'app' | 'worker'

export function resolveEnvFile(cwd: string, requested?: string): string {
  const candidates = requested ? [requested] : ['.env.production', '.env']
  for (const candidate of candidates) {
    const path = resolve(cwd, candidate)
    if (existsSync(path)) return path
  }
  throw new Error(`Environment file not found. Checked: ${candidates.join(', ')}.`)
}

export function parseEnvFile(contents: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const normalized = line.startsWith('export ') ? line.slice(7).trim() : line
    const separator = normalized.indexOf('=')
    if (separator <= 0) continue
    const key = normalized.slice(0, separator).trim()
    let value = normalized.slice(separator + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    result[key] = value.replace(/\\n/g, '\n')
  }
  return result
}

export function generateProtectedSecrets(existing: Record<string, string>): Record<string, string> {
  return {
    AUTH_SECRET: existing.AUTH_SECRET || randomBytes(64).toString('hex'),
    JWT_SECRET: existing.JWT_SECRET || randomBytes(64).toString('hex'),
    TENANT_DATA_ENCRYPTION_FALLBACK_KEY:
      existing.TENANT_DATA_ENCRYPTION_FALLBACK_KEY || randomBytes(32).toString('base64url'),
  }
}

export function computeRailwayVariables(input: {
  env: Record<string, string>
  role: RailwayServiceRole
  workerEnabled: boolean
  appUrl?: string
  protectedSecrets: Record<string, string>
  railwayToken?: string
  allowedSecretKeys?: string[]
}): Record<string, string> {
  const variables: Record<string, string> = {
    ...input.env,
    ...input.protectedSecrets,
    DATABASE_URL: '${{Postgres.DATABASE_URL}}',
    REDIS_URL: '${{Redis.REDIS_URL}}',
    CACHE_STRATEGY: 'redis',
    NODE_ENV: 'production',
    NEXT_TELEMETRY_DISABLED: '1',
    PORT: '3000',
    OM_AI_PROVIDER: input.env.OM_AI_PROVIDER || 'openai',
    OM_AI_MODEL: input.env.OM_AI_MODEL || 'gpt-5-mini',
    QUEUE_STRATEGY: 'async',
    NEXT_PUBLIC_QUEUE_STRATEGY: 'async',
    AUTO_SPAWN_WORKERS: input.role === 'app' && !input.workerEnabled ? 'true' : 'false',
    OM_AUTO_SPAWN_WORKERS: input.role === 'app' && !input.workerEnabled ? 'true' : 'false',
  }

  if (input.appUrl) {
    variables.APP_URL = input.appUrl
    variables.NEXT_PUBLIC_APP_URL = input.appUrl
  }

  delete variables.RAILWAY_API_TOKEN
  delete variables.RAILWAY_TOKEN
  assertSafeVariables(variables, {
    railwayToken: input.railwayToken,
    allowedKeys: input.allowedSecretKeys,
  })
  return variables
}

export function formatVariablePlan(
  variables: Record<string, string>,
  railwayToken?: string,
): string[] {
  return Object.keys(variables)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((key) => `+ ADD ${key}=${formatVariableValue(key, variables[key] ?? '', railwayToken)}`)
}

export function writeGeneratedSecrets(envFile: string, secrets: Record<string, string>): void {
  const ignoreCheck = spawnSync('git', ['check-ignore', '--quiet', envFile], {
    cwd: dirname(envFile),
    stdio: 'ignore',
  })
  if (ignoreCheck.status !== 0) {
    throw new Error(`Refusing --write-env because ${envFile} is not ignored by Git.`)
  }
  const existing = readFileSync(envFile, 'utf8')
  const missing = Object.entries(secrets).filter(([key]) => !new RegExp(`^${key}=`, 'm').test(existing))
  if (missing.length === 0) return
  const suffix = missing.map(([key, value]) => `${key}=${value}`).join('\n')
  writeFileSync(envFile, `${existing.trimEnd()}\n\n# DO NOT COMMIT: generated for Railway deployment\n${suffix}\n`, {
    mode: 0o600,
  })
}
