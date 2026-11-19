#!/usr/bin/env node
/**
 * Advisory Money Diff Checker
 *
 * Flags ADDED lines in a unified git diff that look like new monetary fields
 * bypassing the `Money` value object (`@open-mercato/shared/lib/money`) and its
 * `MoneyColumns` embeddable (`@open-mercato/shared/lib/db/moneyColumns`).
 * Introduced by `.ai/specs/2026-10-22-money-value-object.md` (Harness
 * enforcement, D9).
 *
 * Rules:
 *   numeric-money-column  A new numeric/decimal column or property whose name is
 *                         money-like: a name token `amount`, `price`, `total`,
 *                         `subtotal`, `cost` or `fee` (plurals too), or a trailing
 *                         `value` token after another token (`order_value`,
 *                         `dealValue`). Names that also carry a quantity-like token
 *                         (`quantity`, `weight`, `count`, `percent`, ...) are
 *                         ignored. TypeScript lines (trailing `//` comment
 *                         removed) must carry a quoted `'numeric...'` /
 *                         `'decimal...'` type, a `.numeric(` / `.decimal(` call,
 *                         `ExactDecimalType`/`DecimalType` or a
 *                         `type: 'float'|'double'|'real'`; the name comes from
 *                         `name: '...'`, the first quoted call argument
 *                         (`addColumn('x_amount', ...)`), the property key at the
 *                         line start, or, for a decorator without `name:`, the
 *                         property declared on the next added line. SQL (`.sql`
 *                         files, `migrations/` folders and lines containing
 *                         `create table` / `alter table` / `add column`) is matched
 *                         as `"column" numeric|decimal|real|double precision|float|money`.
 *   exact-decimal-key     A new key, property or type member named `<field>Exact`
 *                         declared at the start of a line: `readonly`, optional
 *                         (`?:`), definite (`!:`), or with a type-position value
 *                         (a zod schema, `*Schema` identifier or a `string`/`number`/
 *                         `null` type union). Object-literal writes that map an
 *                         existing value (`amountExact: toMoneyString(x),`), reads
 *                         such as `line.unitPriceExact` and function-valued keys are
 *                         ignored.
 *
 * Not flagged: lines mentioning `MoneyColumns`, the columns a `MoneyColumns`
 * migration adds (a file whose added lines contain `<prefix>amount`,
 * `<prefix>currency_code` and `<prefix>currency_decimal_places`), test files,
 * generated files, `dist/`, `node_modules/`, the money/decimal implementation
 * itself, and entries in `.ai/money-allowlist.json`:
 *   { "description": "...", "entries": [ { "path": "<glob or path prefix>",
 *     "pattern": "<optional regex tested on the line>", "reason": "<why>" } ] }
 *
 * Limits: this is a line-based heuristic. It does not parse TypeScript or SQL,
 * so a column whose name and type sit on different lines (other than the
 * decorator + property pair) is missed, and a money-like name next to an
 * unrelated numeric mention can be a false positive. The review checklist and
 * agent instructions are the actual enforcement; this only points at likely
 * misses.
 *
 * Usage:
 *   node scripts/money-check-new-code.mjs                     # diff vs merge-base with origin/develop (or develop, or HEAD~1) + working tree + untracked files
 *   node scripts/money-check-new-code.mjs --base <ref>        # compare against another ref
 *   node scripts/money-check-new-code.mjs --diff-file <path>  # read a unified diff from a file
 *   node scripts/money-check-new-code.mjs --json              # machine output
 *   node scripts/money-check-new-code.mjs --strict            # exit 1 on any finding
 *
 * Yarn shortcut: `yarn money:check-new-code`
 *
 * Exit code: 0 by default (advisory), 1 with --strict when findings exist,
 * 2 on usage errors (unknown flag, unresolvable base, unreadable diff or allowlist).
 */

import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_ROOT = path.resolve(SCRIPT_DIR, '..')
const ALLOWLIST_RELATIVE_PATH = '.ai/money-allowlist.json'
const DEFAULT_BASE_CANDIDATES = ['origin/develop', 'develop', 'HEAD~1']
const SNIPPET_MAX = 160

export const RULE_NUMERIC_MONEY_COLUMN = 'numeric-money-column'
export const RULE_EXACT_DECIMAL_KEY = 'exact-decimal-key'

const INSPECTED_EXTENSION = /\.(ts|tsx|sql)$/
const EXCLUDED_PATHS = [
  /(^|\/)__tests__\//,
  /(^|\/)__integration__\//,
  /\.(test|spec)\.tsx?$/,
  /\.generated\.tsx?$/,
  /(^|\/)dist\//,
  /(^|\/)node_modules\//,
  /(^|\/)\.snapshot-[^/]*\.json$/,
  /^packages\/shared\/src\/lib\/money\//,
  /^packages\/shared\/src\/lib\/db\/moneyColumns\.ts$/,
  /^packages\/shared\/src\/lib\/decimal\.ts$/,
]

const MONEY_TOKENS = new Set([
  'amount', 'amounts', 'price', 'prices', 'total', 'totals', 'subtotal', 'subtotals',
  'cost', 'costs', 'fee', 'fees',
])
const NON_MONEY_TOKENS = new Set([
  'quantity', 'quantities', 'qty', 'weight', 'count', 'percent', 'percentage', 'ratio',
  'volume', 'duration', 'hours', 'minutes', 'seconds', 'days', 'score', 'points', 'distance',
])

const TS_NUMERIC_TYPE = /['"](?:numeric|decimal|double precision)\b|\.(?:numeric|decimal)\s*\(|\bExactDecimalType\b|\bDecimalType\b|\btype\s*:\s*['"](?:float|double|real)['"]/i
const TRAILING_COMMENT = /\s\/\/.*$/
const SQL_STATEMENT = /\b(?:create\s+table|alter\s+table|add\s+column)\b/i
const SQL_NUMERIC_COLUMN = /(?:^|[\s,(])"?([A-Za-z_][A-Za-z0-9_]*)"?\s+(?:numeric|decimal|double\s+precision|real|float[248]?|money)\b/gi
const NAME_OPTION = /\bname\s*:\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]/g
const FIRST_QUOTED_CALL_ARG = /\(\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]/g
const LEADING_PROPERTY = /^\s*(?:(?:readonly|public|private|protected|declare)\s+)*(['"]?)([A-Za-z_$][\w$]*)\1\s*[!?]?\s*[:=]/
const DECORATOR_LINE = /^\s*@\w+\s*\(/
const DIFF_PATH_PREFIX = /^[abciow12]\//
const EXACT_KEY = /^\s*(readonly\s+)?(['"]?)([A-Za-z_$][\w$]*Exact)\2\s*([?!]?)\s*:(.*)$/
const TYPE_POSITION_VALUE = /^\s*(?:z\s*\.|[A-Za-z_$][\w$]*Schema\b|(?:string|number|bigint|null|undefined|Big|DecimalValue|DecimalInput)(?:\s*\|\s*(?:string|number|bigint|null|undefined|Big|DecimalValue|DecimalInput))*\s*(?:=[^,;]*)?[;,]?\s*$)/
const FUNCTION_VALUE = /^\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*(?::[^=]*)?=>|[A-Za-z_$][\w$]*\s*=>)/
const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*|--)/

export function parseUnifiedDiff(diffText) {
  const files = []
  let current = null
  let oldRemaining = 0
  let newRemaining = 0
  let newLine = 0
  const lines = diffText.split(/\r?\n/)
  for (const raw of lines) {
    const inHunk = oldRemaining > 0 || newRemaining > 0
    if (inHunk && current) {
      if (raw.startsWith('+')) {
        current.addedLines.push({ line: newLine, text: raw.slice(1) })
        newLine += 1
        newRemaining -= 1
        continue
      }
      if (raw.startsWith('-')) {
        oldRemaining -= 1
        continue
      }
      if (raw.startsWith(' ') || raw === '') {
        newLine += 1
        newRemaining -= 1
        oldRemaining -= 1
        continue
      }
      if (raw.startsWith('\\')) continue
    }
    const hunk = raw.match(/^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/)
    if (hunk) {
      oldRemaining = hunk[1] === undefined ? 1 : Number(hunk[1])
      newLine = Number(hunk[2])
      newRemaining = hunk[3] === undefined ? 1 : Number(hunk[3])
      continue
    }
    oldRemaining = 0
    newRemaining = 0
    if (raw.startsWith('diff --git ')) {
      current = null
      continue
    }
    if (raw.startsWith('+++ ')) {
      const target = raw.slice(4).replace(/\t.*$/, '').trim()
      if (target === '/dev/null') {
        current = null
        continue
      }
      const filePath = target.replace(/^"|"$/g, '').replace(DIFF_PATH_PREFIX, '')
      current = files.find((file) => file.path === filePath) ?? null
      if (!current) {
        current = { path: filePath, addedLines: [] }
        files.push(current)
      }
    }
  }
  return files
}

export function isInspectedPath(filePath) {
  const normalized = filePath.replace(/\\/g, '/')
  if (!INSPECTED_EXTENSION.test(normalized)) return false
  return !EXCLUDED_PATHS.some((pattern) => pattern.test(normalized))
}

export function nameTokens(name) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .toLowerCase()
    .split(/[_\W]+/)
    .filter(Boolean)
}

export function isMoneyLikeName(name) {
  const tokens = nameTokens(name)
  if (tokens.length === 0) return false
  if (tokens.some((token) => NON_MONEY_TOKENS.has(token))) return false
  if (tokens.some((token) => MONEY_TOKENS.has(token))) return true
  return tokens.length > 1 && tokens[tokens.length - 1] === 'value'
}

function isSqlContext(filePath, text) {
  return filePath.endsWith('.sql') || /(^|\/)migrations\//.test(filePath) || SQL_STATEMENT.test(text)
}

function collectMatches(regex, text, group) {
  const names = []
  regex.lastIndex = 0
  let match
  while ((match = regex.exec(text)) !== null) names.push(match[group])
  return names
}

function numericColumnCandidates(filePath, text, nextAddedText) {
  const candidates = []
  const sqlContext = isSqlContext(filePath, text)
  if (sqlContext) candidates.push(...collectMatches(SQL_NUMERIC_COLUMN, text, 1))
  if (filePath.endsWith('.sql') || SQL_STATEMENT.test(text)) return candidates
  if (!TS_NUMERIC_TYPE.test(text.replace(TRAILING_COMMENT, ''))) return candidates
  const named = collectMatches(NAME_OPTION, text, 1)
  candidates.push(...named)
  candidates.push(...collectMatches(FIRST_QUOTED_CALL_ARG, text, 1))
  const leading = text.match(LEADING_PROPERTY)
  if (leading) candidates.push(leading[2])
  if (named.length === 0 && DECORATOR_LINE.test(text) && typeof nextAddedText === 'string') {
    const property = nextAddedText.match(LEADING_PROPERTY)
    if (property) candidates.push(property[2])
  }
  return candidates
}

export function findMoneyColumnsPrefixes(addedTexts) {
  const joined = addedTexts.join('\n')
  const prefixes = new Set()
  for (const prefix of collectMatches(/\b([A-Za-z0-9_]*)currency_decimal_places\b/g, joined, 1)) {
    if (joined.includes(`${prefix}currency_code`) && joined.includes(`${prefix}amount`)) prefixes.add(prefix)
  }
  return prefixes
}

function isExactKeyDeclaration([, readonlyModifier, , , marker, value]) {
  if (FUNCTION_VALUE.test(value)) return false
  return Boolean(readonlyModifier) || marker.length > 0 || TYPE_POSITION_VALUE.test(value)
}

export function classifyLine(filePath, text, context = {}) {
  if (COMMENT_LINE.test(text) || text.includes('MoneyColumns')) return []
  const moneyColumnsPrefixes = context.moneyColumnsPrefixes ?? new Set()
  const exemptNames = new Set(Array.from(moneyColumnsPrefixes, (prefix) => `${prefix}amount`))
  const findings = []
  const seen = new Set()
  for (const name of numericColumnCandidates(filePath, text, context.nextAddedText)) {
    if (seen.has(name) || exemptNames.has(name) || !isMoneyLikeName(name)) continue
    seen.add(name)
    findings.push({ rule: RULE_NUMERIC_MONEY_COLUMN, name })
  }
  if (!filePath.endsWith('.sql')) {
    const exact = text.match(EXACT_KEY)
    if (exact && isExactKeyDeclaration(exact)) {
      findings.push({ rule: RULE_EXACT_DECIMAL_KEY, name: exact[3] })
    }
  }
  return findings
}

export function globToRegExp(glob) {
  const GLOBSTAR_SLASH = '\u0000'
  const GLOBSTAR = '\u0001'
  const escaped = glob
    .replace(/[.+^${}()|[\]\\?]/g, '\\$&')
    .replace(/\*\*\//g, GLOBSTAR_SLASH)
    .replace(/\*\*/g, GLOBSTAR)
    .replace(/\*/g, '[^/]*')
    .replaceAll(GLOBSTAR_SLASH, '(?:.*/)?')
    .replaceAll(GLOBSTAR, '.*')
  return new RegExp(`^${escaped}$`)
}

export function normalizeAllowlist(parsed) {
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.entries)) {
    throw new Error(`${ALLOWLIST_RELATIVE_PATH} must be an object with an "entries" array`)
  }
  return parsed.entries.map((entry, index) => {
    if (!entry || typeof entry.path !== 'string' || entry.path.length === 0) {
      throw new Error(`${ALLOWLIST_RELATIVE_PATH} entries[${index}] needs a non-empty "path"`)
    }
    if (entry.pattern !== undefined && typeof entry.pattern !== 'string') {
      throw new Error(`${ALLOWLIST_RELATIVE_PATH} entries[${index}].pattern must be a string`)
    }
    return {
      path: entry.path,
      pathRegex: entry.path.includes('*') ? globToRegExp(entry.path) : null,
      pattern: entry.pattern ? new RegExp(entry.pattern) : null,
      reason: typeof entry.reason === 'string' ? entry.reason : '',
    }
  })
}

export function loadAllowlist(root) {
  const allowlistPath = path.join(root, ALLOWLIST_RELATIVE_PATH)
  if (!fs.existsSync(allowlistPath)) return []
  return normalizeAllowlist(JSON.parse(fs.readFileSync(allowlistPath, 'utf8')))
}

export function findAllowlistEntry(finding, entries) {
  return (
    entries.find((entry) => {
      const pathMatches = entry.pathRegex ? entry.pathRegex.test(finding.path) : finding.path.startsWith(entry.path)
      if (!pathMatches) return false
      return entry.pattern ? entry.pattern.test(finding.text) : true
    }) ?? null
  )
}

export function checkFiles(files, { allowlist = [] } = {}) {
  const findings = []
  let allowlisted = 0
  for (const file of files) {
    if (!isInspectedPath(file.path)) continue
    const moneyColumnsPrefixes = findMoneyColumnsPrefixes(file.addedLines.map((added) => added.text))
    file.addedLines.forEach((added, index) => {
      const next = file.addedLines[index + 1]
      const nextAddedText = next && next.line === added.line + 1 ? next.text : undefined
      for (const match of classifyLine(file.path, added.text, { moneyColumnsPrefixes, nextAddedText })) {
        const finding = { path: file.path, line: added.line, rule: match.rule, name: match.name, text: added.text }
        if (findAllowlistEntry(finding, allowlist)) allowlisted += 1
        else findings.push(finding)
      }
    })
  }
  return { findings, allowlisted }
}

export function checkDiff(diffText, options = {}) {
  return checkFiles(parseUnifiedDiff(diffText), options)
}

function snippetFor(finding) {
  const text = finding.text.trim()
  if (text.length <= SNIPPET_MAX) return text
  const at = Math.max(0, text.indexOf(finding.name) - 40)
  const slice = text.slice(at, at + SNIPPET_MAX)
  return `${at > 0 ? '...' : ''}${slice}${at + SNIPPET_MAX < text.length ? '...' : ''}`
}

export function parseArgs(argv) {
  const options = { base: null, diffFile: null, json: false, strict: false, help: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--json') options.json = true
    else if (arg === '--strict') options.strict = true
    else if (arg === '--help' || arg === '-h') options.help = true
    else if (arg === '--base' || arg === '--diff-file') {
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`)
      if (arg === '--base') options.base = value
      else options.diffFile = value
      index += 1
    } else throw new Error(`Unknown argument: ${arg}`)
  }
  return options
}

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
}

function refExists(root, ref) {
  try {
    git(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])
    return true
  } catch {
    return false
  }
}

function resolveBase(root, requested) {
  if (requested) {
    if (!refExists(root, requested)) throw new Error(`Cannot resolve --base ref "${requested}"`)
    return requested
  }
  const found = DEFAULT_BASE_CANDIDATES.find((candidate) => refExists(root, candidate))
  if (!found) throw new Error(`Cannot resolve a base ref (tried ${DEFAULT_BASE_CANDIDATES.join(', ')}); pass --base <ref>`)
  return found
}

function collectGitFiles(root, base) {
  let mergeBase = base
  try {
    mergeBase = git(root, ['merge-base', base, 'HEAD']).trim() || base
  } catch {
    mergeBase = base
  }
  const files = parseUnifiedDiff(git(root, ['diff', '--unified=0', '--no-color', '--no-ext-diff', '--find-renames', '--src-prefix=a/', '--dst-prefix=b/', mergeBase]))
  const untracked = git(root, ['ls-files', '--others', '--exclude-standard', '-z']).split('\0').filter(Boolean)
  for (const filePath of untracked) {
    if (!isInspectedPath(filePath)) continue
    let content
    try {
      content = fs.readFileSync(path.join(root, filePath), 'utf8')
    } catch {
      continue
    }
    const addedLines = content.split(/\r?\n/).map((text, index) => ({ line: index + 1, text }))
    files.push({ path: filePath, addedLines })
  }
  return files
}

const USAGE = 'Usage: node scripts/money-check-new-code.mjs [--base <ref>] [--diff-file <path>] [--json] [--strict]'

export function run(argv, io = {}) {
  const root = io.root ?? DEFAULT_ROOT
  const out = io.stdout ?? ((text) => process.stdout.write(text))
  const err = io.stderr ?? ((text) => process.stderr.write(text))
  let options
  let files
  let allowlist
  let source
  try {
    options = parseArgs(argv)
    if (options.help) {
      out(`${USAGE}\n`)
      return 0
    }
    allowlist = loadAllowlist(root)
    if (options.diffFile) {
      files = parseUnifiedDiff(fs.readFileSync(path.resolve(root, options.diffFile), 'utf8'))
      source = `diff file ${options.diffFile}`
    } else {
      const base = resolveBase(root, options.base)
      files = collectGitFiles(root, base)
      source = `${base}...HEAD + working tree`
    }
  } catch (error) {
    err(`[money-check-new-code] ${error instanceof Error ? error.message : String(error)}\n${USAGE}\n`)
    return 2
  }

  const { findings, allowlisted } = checkFiles(files, { allowlist })
  const failed = options.strict && findings.length > 0

  if (options.json) {
    const payload = {
      source,
      totalFindings: findings.length,
      totalAllowlisted: allowlisted,
      findings: findings.map(({ path: filePath, line, rule, name, text }) => ({ path: filePath, line, rule, name, text: text.trim() })),
    }
    out(`${JSON.stringify(payload, null, 2)}\n`)
    return failed ? 1 : 0
  }

  out(`[money-check-new-code] Added lines in ${source}\n`)
  if (findings.length === 0) {
    out(`No likely new monetary fields outside Money/MoneyColumns${allowlisted > 0 ? ` (${allowlisted} allowlisted)` : ''}.\n`)
    return 0
  }
  for (const finding of findings) {
    out(`  ${finding.path}:${finding.line}  ${finding.rule}  ${snippetFor(finding)}\n`)
  }
  out(`\n${findings.length} likely new monetary field(s)${allowlisted > 0 ? ` (+${allowlisted} allowlisted)` : ''}.\n`)
  out('New monetary values use Money/Currency from @open-mercato/shared/lib/money and persist through\n')
  out("MoneyColumns (@open-mercato/shared/lib/db/moneyColumns, @Embedded(() => MoneyColumns, { prefix: 'price_' })).\n")
  out(`Intentional exceptions (e.g. extending an existing <field>Exact contract): add an entry to ${ALLOWLIST_RELATIVE_PATH}.\n`)
  out(failed ? 'Strict mode: failing because findings exist.\n' : 'Advisory mode: exit code stays 0. Run with --strict to fail on findings.\n')
  return failed ? 1 : 0
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invokedDirectly) process.exitCode = run(process.argv.slice(2))
