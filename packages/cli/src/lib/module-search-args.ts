export const MODULE_SEARCH_KINDS = ['module', 'provider', 'library', 'tool', 'built-in'] as const
export type ModuleSearchKind = (typeof MODULE_SEARCH_KINDS)[number]

export type ParsedModuleSearchArgs = {
  query: string | null
  category: string | null
  kinds: ModuleSearchKind[] | null
  allLines: boolean
  limit: number
  json: boolean
}

export type ParsedModuleInfoArgs = {
  ref: string | null
  json: boolean
}

export const MODULE_SEARCH_DEFAULT_LIMIT = 10
export const MODULE_SEARCH_MAX_LIMIT = 20
const QUERY_MAX_LENGTH = 200
const CATEGORY_PATTERN = /^[a-z0-9][a-z0-9-]{0,40}$/

function readValue(args: string[], index: number, flag: string): string {
  const next = args[index + 1]
  if (next === undefined || next.startsWith('--')) {
    throw new Error(`${flag} requires a value`)
  }
  return next
}

function splitFlag(arg: string): { flag: string; inline: string | null } {
  const eq = arg.indexOf('=')
  return eq === -1 ? { flag: arg, inline: null } : { flag: arg.slice(0, eq), inline: arg.slice(eq + 1) }
}

function parseKinds(value: string): ModuleSearchKind[] {
  const kinds = value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '')
  if (kinds.length === 0) throw new Error('--kind requires a value')
  return kinds.map((kind) => {
    const match = MODULE_SEARCH_KINDS.find((candidate) => candidate === kind)
    if (!match) throw new Error(`--kind must be one of: ${MODULE_SEARCH_KINDS.join(', ')}`)
    return match
  })
}

function parseLimit(value: string): number {
  if (!/^\d+$/.test(value)) throw new Error(`--limit must be a whole number between 1 and ${MODULE_SEARCH_MAX_LIMIT}`)
  const limit = Number(value)
  if (limit < 1 || limit > MODULE_SEARCH_MAX_LIMIT) {
    throw new Error(`--limit must be a whole number between 1 and ${MODULE_SEARCH_MAX_LIMIT}`)
  }
  return limit
}

export function parseModuleSearchArgs(args: string[]): ParsedModuleSearchArgs {
  const words: string[] = []
  let category: string | null = null
  let kinds: ModuleSearchKind[] | null = null
  let allLines = false
  let limit = MODULE_SEARCH_DEFAULT_LIMIT
  let json = false

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (!arg) continue
    if (!arg.startsWith('--')) {
      words.push(arg)
      continue
    }
    const { flag, inline } = splitFlag(arg)
    if (flag === '--json' || flag === '--all-lines') {
      if (inline !== null) throw new Error(`${flag} does not accept a value`)
      if (flag === '--json') json = true
      else allLines = true
      continue
    }
    if (flag === '--category' || flag === '--kind' || flag === '--limit') {
      const value = inline ?? readValue(args, index, flag)
      if (inline === null) index += 1
      if (flag === '--category') {
        if (!CATEGORY_PATTERN.test(value)) throw new Error('--category expects a catalog category id, for example payments-finance')
        category = value
      } else if (flag === '--kind') {
        kinds = parseKinds(value)
      } else {
        limit = parseLimit(value)
      }
      continue
    }
    throw new Error(`Unsupported option: ${flag}`)
  }

  const query = words.join(' ').trim()
  if (query.length > QUERY_MAX_LENGTH) throw new Error(`The query is longer than ${QUERY_MAX_LENGTH} characters`)
  return { query: query === '' ? null : query, category, kinds, allLines, limit, json }
}

export function parseModuleInfoArgs(args: string[]): ParsedModuleInfoArgs {
  let ref: string | null = null
  let json = false
  for (const arg of args) {
    if (!arg) continue
    if (arg === '--json') {
      json = true
      continue
    }
    if (arg.startsWith('--')) throw new Error(`Unsupported option: ${splitFlag(arg).flag}`)
    if (ref !== null) throw new Error('module info takes one package name or module id')
    ref = arg.trim()
  }
  if (ref !== null && ref.length > 220) throw new Error('The package name or module id is too long')
  return { ref: ref === '' ? null : ref, json }
}
