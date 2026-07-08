/**
 * Advisory Raw console.* Checker
 *
 * Scans `.ts` / `.tsx` sources under `packages/*\/src` for raw `console.*`
 * calls that bypass the structured logging facade
 * (`@open-mercato/shared/lib/logger`). Introduced by
 * `.ai/specs/2026-07-02-structured-logging-facade.md` (Phase 3).
 *
 * The check is informational: existing call sites migrate incrementally via
 * the Boy Scout rule, so the script always exits 0. Whole packages whose
 * stdout output is intentional (CLI user output) are allowlisted in
 * `scripts/logger-console-allowlist.json` with the shape
 * `{ "packages": { "<package-dir>": "<reason>" } }`.
 *
 * Usage:
 *   node scripts/logger-check-console.mjs                 # report
 *   node scripts/logger-check-console.mjs --quiet         # totals only
 *   node scripts/logger-check-console.mjs --json          # machine output
 *   node scripts/logger-check-console.mjs --path <glob>   # narrow the scan
 *   node scripts/logger-check-console.mjs --limit <n>     # findings shown per package
 *
 * Exit code: always 0 (advisory). Promotion to a blocking gate is deferred
 * until the bulk of existing sites is migrated.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { globSync } from 'glob'

const __filename_ = typeof __filename !== 'undefined' ? __filename : fileURLToPath(import.meta.url)
const ROOT = path.resolve(path.dirname(__filename_), '..')

const ALLOWLIST_PATH = path.join(ROOT, 'scripts', 'logger-console-allowlist.json')

const red = (s) => `\x1b[31m${s}\x1b[0m`
const yellow = (s) => `\x1b[33m${s}\x1b[0m`
const green = (s) => `\x1b[32m${s}\x1b[0m`
const dim = (s) => `\x1b[2m${s}\x1b[0m`
const cyan = (s) => `\x1b[36m${s}\x1b[0m`

const DEFAULT_SCAN_GLOBS = ['packages/*/src/**/*.{ts,tsx}']

const DEFAULT_IGNORE = [
  '**/node_modules/**',
  '**/dist/**',
  '**/.next/**',
  '**/generated/**',
  '**/*.generated.ts',
  '**/*.generated.tsx',
  '**/*.d.ts',
  '**/*.test.ts',
  '**/*.test.tsx',
  '**/*.spec.ts',
  '**/*.spec.tsx',
  '**/__tests__/**',
  '**/__mocks__/**',
  '**/create-app/template/**',
  'packages/shared/src/lib/logger/**',
]

const CONSOLE_CALL_PATTERN = /\bconsole\.(log|info|warn|error|debug|trace|table|dir|group|groupCollapsed|groupEnd|count|time|timeEnd|timeLog|assert)\s*\(/g

function parseArgs(argv) {
  const opts = { quiet: false, json: false, paths: [], showFindingLimit: 12 }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--quiet') opts.quiet = true
    else if (arg === '--json') opts.json = true
    else if (arg === '--path' && argv[i + 1]) {
      opts.paths.push(argv[i + 1])
      i++
    } else if (arg === '--limit' && argv[i + 1]) {
      const n = Number(argv[i + 1])
      if (Number.isFinite(n) && n > 0) opts.showFindingLimit = n
      i++
    }
  }
  return opts
}

function loadAllowlistedPackages() {
  try {
    const raw = fs.readFileSync(ALLOWLIST_PATH, 'utf-8')
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed.packages === 'object' && parsed.packages !== null
      ? parsed.packages
      : {}
  } catch (err) {
    console.error(yellow(`[logger-check-console] failed to read ${path.relative(ROOT, ALLOWLIST_PATH)}: ${err.message}`))
    return {}
  }
}

function derivePackageKey(relFile) {
  const match = relFile.match(/^packages\/([^/]+)\/src\//)
  return match ? match[1] : 'other'
}

function isCommentLine(line) {
  const trimmed = line.trimStart()
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')
}

function scanFile(relFile, content) {
  const findings = []
  const lines = content.split('\n')
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx]
    if (isCommentLine(line)) continue
    CONSOLE_CALL_PATTERN.lastIndex = 0
    let match
    while ((match = CONSOLE_CALL_PATTERN.exec(line)) !== null) {
      findings.push({
        file: relFile,
        line: lineIdx + 1,
        method: match[1],
        raw: line.trim().slice(0, 160),
      })
    }
  }
  return findings
}

function collectSources(opts) {
  const patterns = opts.paths.length > 0 ? opts.paths : DEFAULT_SCAN_GLOBS
  const seen = new Set()
  for (const pattern of patterns) {
    const matches = globSync(pattern, { cwd: ROOT, ignore: DEFAULT_IGNORE, absolute: true })
    for (const m of matches) seen.add(m)
  }
  return Array.from(seen).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  const allowlistedPackages = loadAllowlistedPackages()
  const files = collectSources(opts)
  const startedAt = Date.now()

  const packageReports = new Map()

  for (const absFile of files) {
    const relFile = path.relative(ROOT, absFile)
    let content
    try {
      content = fs.readFileSync(absFile, 'utf-8')
    } catch {
      continue
    }
    const key = derivePackageKey(relFile)
    const report = packageReports.get(key) ?? {
      packageKey: key,
      files: 0,
      findings: [],
      allowlisted: 0,
      allowlistReason: allowlistedPackages[key] ?? null,
    }
    report.files += 1
    const findings = scanFile(relFile, content)
    if (report.allowlistReason) report.allowlisted += findings.length
    else report.findings.push(...findings)
    packageReports.set(key, report)
  }

  const reports = Array.from(packageReports.values()).sort(
    (a, b) => b.findings.length - a.findings.length || a.packageKey.localeCompare(b.packageKey),
  )

  const totalFindings = reports.reduce((acc, r) => acc + r.findings.length, 0)
  const totalAllowlisted = reports.reduce((acc, r) => acc + r.allowlisted, 0)
  const totalFiles = reports.reduce((acc, r) => acc + r.files, 0)
  const elapsedMs = Date.now() - startedAt

  if (opts.json) {
    const payload = {
      totalFindings,
      totalAllowlisted,
      totalFiles,
      elapsedMs,
      packages: reports.map((r) => ({
        packageKey: r.packageKey,
        files: r.files,
        count: r.findings.length,
        allowlisted: r.allowlisted,
        allowlistReason: r.allowlistReason,
        findings: r.findings,
      })),
    }
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n')
    return
  }

  console.log(`${cyan('[check]')} Raw console.* usage — scanned ${totalFiles} files in ${elapsedMs}ms`)
  console.log(dim('Advisory only: prefer createLogger() from @open-mercato/shared/lib/logger for new code.'))
  console.log(dim('Docs: apps/docs/docs/framework/runtime/logging.mdx • Spec: .ai/specs/2026-07-02-structured-logging-facade.md'))
  console.log('')

  if (totalFindings === 0 && totalAllowlisted === 0) {
    console.log(green('No raw console.* calls detected.'))
    return
  }

  for (const report of reports) {
    if (report.findings.length === 0 && report.allowlisted === 0) continue
    if (report.allowlistReason) {
      console.log(`[${report.packageKey}] ${yellow(`${report.allowlisted} allowlisted`)} ${dim(`(${report.allowlistReason})`)}`)
      continue
    }
    console.log(`[${report.packageKey}] ${red(`${report.findings.length}`)} raw console.* calls`)
    if (opts.quiet) continue
    const shown = report.findings.slice(0, opts.showFindingLimit)
    for (const finding of shown) {
      console.log(`  ${finding.file}:${finding.line} ${dim(`[console.${finding.method}]`)} ${dim(finding.raw)}`)
    }
    if (report.findings.length > opts.showFindingLimit) {
      console.log(dim(`  ... and ${report.findings.length - opts.showFindingLimit} more`))
    }
  }

  console.log('')
  console.log(
    `Summary: ${red(`${totalFindings} raw console.* calls`)} • ${yellow(`${totalAllowlisted} allowlisted`)} • across ${reports.filter((r) => r.findings.length > 0).length} packages`,
  )
  console.log(dim('This checker is advisory — exit code stays 0. Migrate incrementally via the Boy Scout rule.'))
  console.log(dim('Package allowlist: scripts/logger-console-allowlist.json ({ "packages": { "<dir>": "<reason>" } }).'))
}

main()
