import { createSut } from './exec.mjs'
import { configureTls } from './http.mjs'
import { loadSutEnv, loadTarget } from './target.mjs'

export function log(message) {
  process.stdout.write(`[perf] ${message}\n`)
}

export function parseFlags(argv, booleanFlags = []) {
  const flags = {}
  const positional = []
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!arg.startsWith('--')) {
      positional.push(arg)
      continue
    }
    const [name, inlineValue] = arg.slice(2).split('=', 2)
    if (inlineValue !== undefined) flags[name] = inlineValue
    else if (booleanFlags.includes(name) || argv[index + 1] === undefined || argv[index + 1].startsWith('--')) flags[name] = true
    else {
      flags[name] = argv[index + 1]
      index += 1
    }
  }
  return { flags, positional }
}

export function loadContext({ requireSutEnv = true } = {}) {
  const target = loadTarget()
  configureTls(target)
  const sutEnv = requireSutEnv ? loadSutEnv() : null
  if (sutEnv?.get('POSTGRES_DB')) target.POSTGRES_DB = sutEnv.get('POSTGRES_DB')
  const sut = createSut(target)
  return { target, sutEnv, sut, database: target.POSTGRES_DB ?? 'open-mercato', deployEnv: sutEnv?.get('DEPLOY_ENV') ?? 'perf' }
}

export function requireTier(value, allowed = ['XS', 'S', 'M', 'L']) {
  const tier = String(value ?? '').toUpperCase()
  if (!allowed.includes(tier)) throw new Error(`[perf] --tier must be one of ${allowed.join(', ')}`)
  return tier
}

export function quoteIdentifier(name) {
  return `"${String(name).replace(/"/g, '""')}"`
}
