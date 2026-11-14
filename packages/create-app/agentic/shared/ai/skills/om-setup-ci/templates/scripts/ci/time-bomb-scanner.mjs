#!/usr/bin/env node
// Time-bomb test scanner.
//
// A "time-bomb" test is one that hardcodes an absolute date/datetime literal
// whose pass/fail outcome depends on the wall clock at run time. The classic
// failure mode (see issue #2384) is a literal that was "just over the horizon"
// when authored and asserted as valid/future — it silently flips to failing
// once that timestamp elapses, turning CI red on unrelated PRs.
//
// This scanner walks test files, extracts absolute date literals, and uses the
// surrounding lines (±2) to judge whether the assertion is clock-dependent:
//
//   HIGH   — future literal asserted as future-valid (will flip when it elapses),
//            or a future-validity assertion whose literal has already elapsed
//            (likely failing right now).
//   MEDIUM — near-future fixture literal (becomes past soon), or a far-future
//            (> 5y) "slow" time-bomb, or an ambiguous past-in-validity-context.
//   LOW    — literal echoed in an equality/format assertion (both sides
//            hardcoded → not clock-dependent), or a plain past fixture.
//
// Intentional "rejects past datetime" tests (a past literal asserted to throw)
// are recognised and NOT flagged. The safe, time-independent patterns
// (`Date.now()`, `new Date()`, `new Date(Date.now() + 60_000)`) contain no
// literal and are naturally ignored.
//
// Usage:
//   node scripts/time-bomb-scanner.mjs [--json] [--all] [--fail]
//        [--fail-on=high|medium] [--now=<ISO>] [path ...]

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const rawArgs = process.argv.slice(2)
const flags = new Set(rawArgs.filter((a) => a.startsWith('--')))
const positional = rawArgs.filter((a) => !a.startsWith('--'))

const json = flags.has('--json')
const includeLow = flags.has('--all')
const shouldFail = flags.has('--fail')

function flagValue(name, fallback) {
  const hit = rawArgs.find((a) => a.startsWith(`${name}=`))
  return hit ? hit.split('=').slice(1).join('=') : fallback
}

const failOn = flagValue('--fail-on', 'high').toLowerCase()
const nowArg = flagValue('--now', null)
const now = nowArg ? new Date(nowArg).getTime() : Date.now()
if (Number.isNaN(now)) {
  console.error(`Invalid --now value: ${nowArg}`)
  process.exit(2)
}

const allowlistPath = path.join(root, '.ai/time-bomb-allowlist.json')

const YEAR_MS = 365 * 24 * 60 * 60 * 1000
const FAR_FUTURE_YEARS = 5
const CONTEXT_RADIUS = 2 // lines of context examined on each side of a literal
const SEVERITY_ORDER = { high: 3, medium: 2, low: 1 }
const IGNORE_DIRS = new Set(['node_modules', '.next', '.mercato', 'dist', 'coverage', 'generated', '.git'])
const TEST_FILE_RE = /(?:\.(?:test|spec)\.[mc]?[jt]sx?$)|(?:[\\/]__tests__[\\/])/
const SENTINEL_YEAR = 9000 // years >= this are treated as never-expiring sentinels (e.g. 9999-12-31)

// Quoted ISO-8601 date or datetime literal, e.g. '2026-06-01T12:00:00.000Z' or "2025-01-01".
const ISO_LITERAL_RE =
  /(['"`])(\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})?)?)\1/g

// Context markers.
const VALIDITY_RE = /\buntil\b|isFuture|\bfuture\b|must be a future|toBeGreaterThan|isAfter\b/i
const REJECT_RE = /\.toThrow|toThrow\(/
const ACCEPT_RE = /not\.toThrow/
const ECHO_RE = /\.(?:toBe|toEqual|toStrictEqual|toContain)\(|toHaveValue\(|toHaveBeenCalledWith\(/

function loadAllowlist() {
  if (!existsSync(allowlistPath)) return { locations: new Set(), literals: new Set() }
  try {
    const parsed = JSON.parse(readFileSync(allowlistPath, 'utf8'))
    const entries = Array.isArray(parsed) ? parsed : parsed.entries ?? []
    const locations = new Set()
    const literals = new Set()
    for (const entry of entries) {
      const value = typeof entry === 'string' ? entry : entry?.match
      if (!value) continue
      if (/:\d+$/.test(value) || value.includes('/')) locations.add(value)
      else literals.add(value)
    }
    return { locations, literals }
  } catch (err) {
    console.error(`Failed to parse ${rel(allowlistPath)}: ${err.message}`)
    return { locations: new Set(), literals: new Set() }
  }
}

function normalize(file) {
  return file.split(path.sep).join('/')
}

function rel(file) {
  return normalize(path.relative(root, file))
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry)) continue
    const full = path.join(dir, entry)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) walk(full, out)
    else if (TEST_FILE_RE.test(normalize(full))) out.push(full)
  }
  return out
}

function classify(timestamp, line, context) {
  const year = new Date(timestamp).getUTCFullYear()
  if (year >= SENTINEL_YEAR) return null // never-expiring sentinel

  const future = timestamp > now
  const yearsOut = (timestamp - now) / YEAR_MS
  const isValidity = VALIDITY_RE.test(context)
  const expectsReject = REJECT_RE.test(context)
  const expectsAccept = ACCEPT_RE.test(context)
  const isEcho = ECHO_RE.test(line)

  if (isValidity) {
    if (future) {
      if (yearsOut > FAR_FUTURE_YEARS) {
        return { severity: 'medium', reason: 'far-future validity literal — slow time-bomb' }
      }
      return { severity: 'high', reason: 'future literal in a future-validity assertion — flips when it elapses' }
    }
    // past literal in a future-validity context
    if (expectsReject && !expectsAccept) {
      return null // intentional "rejects past datetime" test — correct by design
    }
    if (expectsAccept) {
      return {
        severity: 'high',
        reason: 'future-validity assertion whose literal has already elapsed — likely failing now',
      }
    }
    return { severity: 'medium', reason: 'past literal in a future-validity context — review for clock dependence' }
  }

  if (isEcho) {
    return { severity: 'low', reason: 'literal echoed in an equality/format assertion — not clock-dependent' }
  }

  if (future) {
    if (yearsOut > FAR_FUTURE_YEARS) {
      return { severity: 'medium', reason: 'far-future fixture literal — slow time-bomb' }
    }
    return {
      severity: 'medium',
      reason: 'near-future fixture literal — becomes past soon; verify no future-dependent assertion relies on it',
    }
  }
  return { severity: 'low', reason: 'past date fixture — usually stable' }
}

function scanFile(file) {
  const text = readFileSync(file, 'utf8')
  const lines = text.split(/\r?\n/)
  const findings = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const context = lines.slice(Math.max(0, i - CONTEXT_RADIUS), i + CONTEXT_RADIUS + 1).join('\n')
    ISO_LITERAL_RE.lastIndex = 0
    let match
    while ((match = ISO_LITERAL_RE.exec(line)) !== null) {
      const literal = match[2]
      const timestamp = new Date(literal).getTime()
      if (Number.isNaN(timestamp)) continue
      const verdict = classify(timestamp, line, context)
      if (!verdict) continue
      findings.push({
        file: rel(file),
        line: i + 1,
        literal,
        iso: new Date(timestamp).toISOString(),
        severity: verdict.severity,
        reason: verdict.reason,
        snippet: line.trim().slice(0, 160),
      })
    }
  }
  return findings
}

const allowlist = loadAllowlist()

function isAllowlisted(finding) {
  if (allowlist.literals.has(finding.literal)) return true
  if (allowlist.locations.has(`${finding.file}:${finding.line}`)) return true
  if (allowlist.locations.has(finding.file)) return true
  return false
}

const searchRoots = positional.length
  ? positional.map((p) => path.resolve(root, p))
  : [path.join(root, 'packages'), path.join(root, 'apps'), path.join(root, 'external')]

const files = searchRoots.flatMap((target) => {
  if (!existsSync(target)) return []
  return statSync(target).isDirectory() ? walk(target) : [target]
})

let findings = files
  .flatMap(scanFile)
  .filter((f) => !isAllowlisted(f))
  .filter((f) => includeLow || f.severity !== 'low')

findings.sort(
  (a, b) =>
    SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity] ||
    a.file.localeCompare(b.file) ||
    a.line - b.line
)

const counts = findings.reduce(
  (acc, f) => ((acc[f.severity] = (acc[f.severity] ?? 0) + 1), acc),
  { high: 0, medium: 0, low: 0 }
)

if (json) {
  console.log(
    JSON.stringify(
      { now: new Date(now).toISOString(), scannedFiles: files.length, counts, findings },
      null,
      2
    )
  )
} else {
  printReport()
}

function severityLabel(severity) {
  return { high: 'HIGH  ', medium: 'MEDIUM', low: 'LOW   ' }[severity]
}

function printReport() {
  console.log(`Time-bomb test scan`)
  console.log(`  reference now : ${new Date(now).toISOString()}`)
  console.log(`  test files    : ${files.length}`)
  console.log(
    `  findings      : ${findings.length} (high: ${counts.high}, medium: ${counts.medium}, low: ${counts.low}${
      includeLow ? '' : ' — low hidden, pass --all to show'
    })`
  )
  console.log('')

  if (findings.length === 0) {
    console.log('  No actionable time-bomb literals detected. ✅')
    return
  }

  for (const f of findings) {
    console.log(`  [${severityLabel(f.severity)}] ${f.file}:${f.line}`)
    console.log(`            literal "${f.literal}" → ${f.iso}`)
    console.log(`            ${f.reason}`)
    console.log(`            ${f.snippet}`)
    console.log('')
  }

  console.log('  Fix: replace the literal with a clock-relative value computed at run time, e.g.')
  console.log("       const future = new Date(Date.now() + 60_000).toISOString()")
  console.log(`  Intentional literals can be allowlisted in ${rel(allowlistPath)}.`)
}

if (shouldFail) {
  const threshold = SEVERITY_ORDER[failOn] ?? SEVERITY_ORDER.high
  const breaching = findings.filter((f) => SEVERITY_ORDER[f.severity] >= threshold)
  if (breaching.length > 0) process.exit(1)
}
