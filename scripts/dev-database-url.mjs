import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'

const DATABASE_URL_KEY = 'DATABASE_URL'
const DATABASE_NAME_FLAG = '--database-name'
const NO_UPDATE_ENV_FLAG = '--no-update-env'
const UPDATE_ENV_FLAG = '--update-env'
const DATABASE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]*$/
const MAX_DATABASE_NAME_LENGTH = 63

export function collectForwardedSetupFlags(argv) {
  const out = []
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === DATABASE_NAME_FLAG) {
      out.push(arg)
      const next = argv[index + 1]
      if (typeof next === 'string' && !next.startsWith('-')) {
        out.push(next)
        index += 1
      }
      continue
    }
    if (typeof arg === 'string' && arg.startsWith(`${DATABASE_NAME_FLAG}=`)) {
      out.push(arg)
      continue
    }
    if (arg === NO_UPDATE_ENV_FLAG || arg === UPDATE_ENV_FLAG) {
      out.push(arg)
    }
  }
  return out
}

export function parseDatabaseNameArgs(argv) {
  const remaining = []
  let provided = false
  let rawValue = null
  let updateEnv = null

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === DATABASE_NAME_FLAG) {
      provided = true
      const next = argv[index + 1]
      if (typeof next === 'string' && !next.startsWith('-')) {
        rawValue = next
        index += 1
      } else {
        rawValue = null
      }
      continue
    }
    if (typeof arg === 'string' && arg.startsWith(`${DATABASE_NAME_FLAG}=`)) {
      provided = true
      rawValue = arg.slice(DATABASE_NAME_FLAG.length + 1)
      continue
    }
    if (arg === NO_UPDATE_ENV_FLAG) {
      updateEnv = false
      continue
    }
    if (arg === UPDATE_ENV_FLAG) {
      updateEnv = true
      continue
    }
    remaining.push(arg)
  }

  return {
    provided,
    rawValue,
    updateEnv,
    remainingArgv: remaining,
  }
}

export function deriveDatabaseNameFromCwd(cwd) {
  const basename = path.basename(String(cwd ?? ''))
  const lower = basename.toLowerCase()
  const withUnderscores = lower.replace(/[^a-z0-9]+/g, '_')
  const trimmed = withUnderscores.replace(/^_+|_+$/g, '')
  if (!trimmed) return 'open_mercato_dev'
  if (/^[0-9]/.test(trimmed)) return `om_${trimmed}`
  return trimmed
}

export function validateDatabaseName(name) {
  if (typeof name !== 'string') {
    return { ok: false, reason: 'Database name must be a string.' }
  }
  if (name.length === 0) {
    return { ok: false, reason: 'Database name must not be empty.' }
  }
  if (name.length > MAX_DATABASE_NAME_LENGTH) {
    return {
      ok: false,
      reason: `Database name must be ${MAX_DATABASE_NAME_LENGTH} characters or fewer.`,
    }
  }
  if (!DATABASE_NAME_PATTERN.test(name)) {
    return {
      ok: false,
      reason: 'Database name must start with a letter or underscore and contain only letters, digits, underscores, or hyphens.',
    }
  }
  return { ok: true }
}

export function resolveDatabaseName({ rawValue, cwd }) {
  const trimmed = typeof rawValue === 'string' ? rawValue.trim() : ''
  if (!trimmed) {
    const derived = deriveDatabaseNameFromCwd(cwd)
    return { name: derived, source: 'cwd' }
  }
  return { name: trimmed, source: 'explicit' }
}

export function rewriteDatabaseUrl(url, databaseName) {
  if (typeof url !== 'string' || url.length === 0) {
    throw new Error('DATABASE_URL is empty.')
  }
  const parsed = new URL(url)
  parsed.pathname = `/${encodeURIComponent(databaseName)}`
  return parsed.toString()
}

export function updateDatabaseUrlInEnvText(source, databaseName) {
  const lines = source.split(/\r?\n/)
  let replaced = false
  let changed = false
  let previousValue = null
  let nextValue = null

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const match = line.match(/^(\s*(?:export\s+)?DATABASE_URL\s*=\s*)(.*)$/)
    if (!match) continue
    const prefix = match[1]
    const rawCurrent = match[2]
    const { value: currentValue, quote } = stripEnvValueQuotes(rawCurrent)
    if (replaced) {
      continue
    }
    replaced = true
    previousValue = currentValue
    try {
      nextValue = rewriteDatabaseUrl(currentValue, databaseName)
    } catch (error) {
      throw new Error(`Failed to rewrite ${DATABASE_URL_KEY}: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (nextValue === currentValue) {
      continue
    }
    lines[index] = `${prefix}${quote}${nextValue}${quote}`
    changed = true
  }

  if (!replaced) {
    throw new Error(`No ${DATABASE_URL_KEY} entry found in env file.`)
  }

  return {
    text: lines.join('\n'),
    changed,
    previousValue,
    nextValue,
  }
}

function stripEnvValueQuotes(rawValue) {
  if (typeof rawValue !== 'string') return { value: '', quote: '' }
  const trimmed = rawValue.replace(/\s+#.*$/, '').trim()
  if (
    trimmed.length >= 2
    && (
      (trimmed.startsWith('"') && trimmed.endsWith('"'))
      || (trimmed.startsWith("'") && trimmed.endsWith("'"))
    )
  ) {
    return { value: trimmed.slice(1, -1), quote: trimmed[0] }
  }
  return { value: trimmed, quote: '' }
}

export function readEnvDatabaseUrl(source) {
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?DATABASE_URL\s*=\s*(.*)$/)
    if (!match) continue
    return stripEnvValueQuotes(match[1]).value
  }
  return null
}

export function isNonInteractiveEnvironment({ env, stdinIsTTY }) {
  if (env && typeof env === 'object') {
    const ci = String(env.CI ?? '').trim().toLowerCase()
    if (['1', 'true', 'yes', 'on'].includes(ci)) return true
  }
  if (stdinIsTTY === false) return true
  return false
}

export function parseUpdateEnvAnswer(answer) {
  if (typeof answer !== 'string') return null
  const normalized = answer.trim().toLowerCase()
  if (normalized === '') return true
  if (['y', 'yes', '1', 'true'].includes(normalized)) return true
  if (['n', 'no', '0', 'false'].includes(normalized)) return false
  return null
}

async function promptUpdateEnv({ databaseName, input, output }) {
  if (!input || !output) return true
  const rl = readline.createInterface({ input, output })
  try {
    return await new Promise((resolve) => {
      rl.question(`[dev] Update .env to use database "${databaseName}"? [Y/n] `, (answer) => {
        const parsed = parseUpdateEnvAnswer(answer)
        resolve(parsed === null ? true : parsed)
      })
    })
  } finally {
    rl.close()
  }
}

export function resolveUpdateEnvDecisionFromEnv(env) {
  if (!env || typeof env !== 'object') return null
  const raw = env.OM_DEV_DATABASE_UPDATE_ENV
  if (typeof raw !== 'string') return null
  const normalized = raw.trim().toLowerCase()
  if (['', '1', 'true', 'yes', 'on', 'y'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off', 'n'].includes(normalized)) return false
  return null
}

export function readDatabaseNameEnvOverride(env) {
  if (!env || typeof env !== 'object') return null
  const raw = env.OM_DEV_DATABASE_NAME
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (trimmed.length === 0) return null
  return trimmed
}

export async function resolveDatabaseNameOverride(options) {
  const {
    argv = [],
    env = {},
    cwd = process.cwd(),
    envFilePath,
    stdin = null,
    stdout = null,
    logger = noopLogger(),
    fsImpl = fs,
  } = options

  const parsed = parseDatabaseNameArgs(argv)
  const envOverrideName = readDatabaseNameEnvOverride(env)

  const flagPresent = parsed.provided || envOverrideName !== null
  if (!flagPresent) {
    return { applied: false, remainingArgv: parsed.remainingArgv }
  }

  const rawValue = parsed.provided ? parsed.rawValue : envOverrideName
  const resolved = resolveDatabaseName({ rawValue, cwd })

  const validation = validateDatabaseName(resolved.name)
  if (!validation.ok) {
    throw new Error(`Invalid database name "${resolved.name}": ${validation.reason}`)
  }

  if (!envFilePath) {
    throw new Error('Cannot resolve env file path for database-name override.')
  }

  if (!fsImpl.existsSync(envFilePath)) {
    throw new Error(`Env file not found at ${envFilePath}. Cannot apply --database-name.`)
  }

  const envSource = fsImpl.readFileSync(envFilePath, 'utf8')
  const previousUrl = readEnvDatabaseUrl(envSource)
  if (!previousUrl) {
    throw new Error(`Env file ${envFilePath} does not declare ${DATABASE_URL_KEY}.`)
  }

  const rewritten = updateDatabaseUrlInEnvText(envSource, resolved.name)

  logger.info?.(`[dev] Using database "${resolved.name}" from ${parsed.provided ? '--database-name' : 'OM_DEV_DATABASE_NAME'}.`)

  let updateEnvDecision
  if (parsed.updateEnv === false) {
    updateEnvDecision = false
  } else if (parsed.updateEnv === true) {
    updateEnvDecision = true
  } else {
    const envDecision = resolveUpdateEnvDecisionFromEnv(env)
    if (envDecision !== null) {
      updateEnvDecision = envDecision
    } else if (isNonInteractiveEnvironment({ env, stdinIsTTY: stdin?.isTTY })) {
      updateEnvDecision = true
    } else {
      updateEnvDecision = await promptUpdateEnv({
        databaseName: resolved.name,
        input: stdin,
        output: stdout,
      })
    }
  }

  if (updateEnvDecision) {
    if (rewritten.changed) {
      fsImpl.writeFileSync(envFilePath, rewritten.text)
      logger.info?.(`[dev] Updated ${path.basename(envFilePath)} ${DATABASE_URL_KEY}.`)
    } else {
      logger.info?.(`[dev] ${path.basename(envFilePath)} already targets database "${resolved.name}".`)
    }
  } else {
    logger.info?.(`[dev] Leaving ${path.basename(envFilePath)} unchanged; child commands will use database "${resolved.name}" for this run.`)
  }

  return {
    applied: true,
    databaseName: resolved.name,
    source: resolved.source,
    envFilePath,
    previousDatabaseUrl: previousUrl,
    nextDatabaseUrl: rewritten.nextValue,
    envFileUpdated: updateEnvDecision && rewritten.changed,
    envFileWriteSkipped: !updateEnvDecision,
    childEnv: { [DATABASE_URL_KEY]: rewritten.nextValue },
    remainingArgv: parsed.remainingArgv,
  }
}

function noopLogger() {
  return { info: () => {}, warn: () => {}, error: () => {} }
}

export const __DATABASE_URL_KEY__ = DATABASE_URL_KEY
