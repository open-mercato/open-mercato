import { createHash, randomBytes } from 'node:crypto'

export const GENERATE_PLACEHOLDER = '__GENERATE__'

const SECRET_KEY_PATTERN = /(SECRET|PASSWORD|PASS|TOKEN|PEPPER|PRIVATE|API_KEY|MASTER_KEY|LICENSE_KEY|FALLBACK_KEY|ENCRYPTION_KEY)/i

const COMPOSE_DEFAULT_SECRETS = {
  POSTGRES_PASSWORD: ['postgres', 'password'],
  MEILISEARCH_MASTER_KEY: ['meilisearch-dev-key'],
  OM_INIT_SUPERADMIN_PASSWORD: ['password', 'secret'],
}

const MANDATORY_SECRETS = [
  'POSTGRES_PASSWORD',
  'JWT_SECRET',
  'MEILISEARCH_MASTER_KEY',
  'OM_INIT_SUPERADMIN_PASSWORD',
  'GRAFANA_ADMIN_PASSWORD',
  'TENANT_DATA_ENCRYPTION_FALLBACK_KEY',
  'LOOKUP_HASH_PEPPER',
]

const NOTABLE_KEYS = [
  'DB_POOL_MAX',
  'DB_POOL_MIN',
  'WORKER_DB_POOL_MAX',
  'NODE_OPTIONS',
  'WORKER_NODE_OPTIONS',
  'REDIS_MAXMEMORY',
  'PG_MAX_CONNECTIONS',
  'PG_SHARED_BUFFERS',
  'PG_EFFECTIVE_CACHE_SIZE',
  'PG_WORK_MEM',
  'PG_MAINTENANCE_WORK_MEM',
  'TENANT_DATA_ENCRYPTION',
  'ENABLE_CRUD_API_CACHE',
  'TELEMETRY_SAMPLING_RATIO',
  'RATE_LIMIT_LOGIN_IP_POINTS',
  'NODE_ENV',
]

const NOTABLE_PREFIXES = ['OM_']

function unquote(value) {
  const trimmed = value.trim()
  const quoted = trimmed.length >= 2 && (trimmed[0] === '"' || trimmed[0] === "'") && trimmed.at(-1) === trimmed[0]
  return quoted ? trimmed.slice(1, -1) : trimmed
}

export function parseEnvText(text) {
  const entries = new Map()
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const separator = line.indexOf('=')
    if (separator <= 0) continue
    const key = line.slice(0, separator).trim().replace(/^export\s+/, '')
    entries.set(key, unquote(line.slice(separator + 1)))
  }
  return entries
}

export function isSecretKey(key) {
  return SECRET_KEY_PATTERN.test(key)
}

export function redactEnv(entries) {
  const result = {}
  for (const [key, value] of entries) {
    result[key] = isSecretKey(key) && value !== '' ? '<redacted>' : value
  }
  return result
}

export function envHash(entries) {
  const redacted = redactEnv(entries)
  const canonical = Object.keys(redacted).sort().map((key) => `${key}=${redacted[key]}`).join('\n')
  return createHash('sha256').update(canonical).digest('hex')
}

export function notableEnv(entries) {
  const result = {}
  for (const [key, value] of entries) {
    const notable = NOTABLE_KEYS.includes(key) || NOTABLE_PREFIXES.some((prefix) => key.startsWith(prefix))
    if (notable && !isSecretKey(key)) result[key] = value
  }
  return result
}

export function generateHexSecret(bytes = 32) {
  return randomBytes(bytes).toString('hex')
}

export function generatePassword() {
  const body = randomBytes(18).toString('base64url')
  return `Pf!${body}9aZ`
}

export function generateValueFor(key) {
  return /PASSWORD/i.test(key) ? generatePassword() : generateHexSecret(32)
}

export function mergeEnvTemplate(templateText, existingEntries, generate = generateValueFor) {
  const generated = []
  const lines = String(templateText).split(/\r?\n/).map((rawLine) => {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(rawLine.trim())
    if (!match) return rawLine
    const key = match[1]
    if (existingEntries.has(key) && existingEntries.get(key) !== GENERATE_PLACEHOLDER) {
      return `${key}=${existingEntries.get(key)}`
    }
    if (unquote(match[2]) === GENERATE_PLACEHOLDER) {
      generated.push(key)
      return `${key}=${generate(key)}`
    }
    return rawLine
  })
  const templateKeys = new Set(parseEnvText(templateText).keys())
  const extras = [...existingEntries].filter(([key]) => !templateKeys.has(key))
  if (extras.length) {
    lines.push('', '# --- Local additions kept by init-secrets ---')
    for (const [key, value] of extras) lines.push(`${key}=${value}`)
  }
  return { text: lines.join('\n'), generated }
}

export function findUnsafeSecrets(entries) {
  const problems = []
  for (const key of MANDATORY_SECRETS) {
    const value = entries.get(key) ?? ''
    if (!value || value === GENERATE_PLACEHOLDER) {
      problems.push(`${key} is unset`)
      continue
    }
    if ((COMPOSE_DEFAULT_SECRETS[key] ?? []).includes(value)) problems.push(`${key} still equals the compose default`)
    if (/KEY|PEPPER|SECRET/.test(key) && Buffer.byteLength(value, 'utf8') < 32) problems.push(`${key} is shorter than 32 bytes`)
  }
  return problems
}

export function keyFingerprint(entries) {
  const material = ['TENANT_DATA_ENCRYPTION_FALLBACK_KEY', 'LOOKUP_HASH_PEPPER'].map((key) => `${key}=${entries.get(key) ?? ''}`).join('\n')
  return createHash('sha256').update(material).digest('hex').slice(0, 16)
}

export function keyBackupText(entries) {
  return ['TENANT_DATA_ENCRYPTION_FALLBACK_KEY', 'LOOKUP_HASH_PEPPER']
    .map((key) => `${key}=${entries.get(key) ?? ''}`)
    .join('\n')
    .concat('\n')
}
