/**
 * i18n Hardcoded-String Checker
 *
 * Scans `.ts` / `.tsx` sources under `packages/**\/src` and
 * `apps/mercato/src/modules/**` for user-facing English literals that bypass
 * the i18n pipeline:
 *  - JSX text nodes that read like English phrases.
 *  - JSX attribute literals on user-visible props (label/title/placeholder/...).
 *  - throw new Error('...') / createCrudFormError('...') / raiseCrudError('...')
 *    / toast.<level>('...') whose first argument is an English-like string and
 *    is not prefixed with `[internal]`.
 *
 * Each module may opt out specific lines via
 * `<module>/i18n/.hardcoded-allowlist.json` (see the spec at
 * `.ai/specs/2026-05-26-missing-translations-audit-and-remediation.md`).
 *
 * Usage:
 *   tsx scripts/i18n-check-hardcoded.ts                 # report
 *   tsx scripts/i18n-check-hardcoded.ts --quiet         # totals only
 *   tsx scripts/i18n-check-hardcoded.ts --path <glob>   # narrow the scan
 *   tsx scripts/i18n-check-hardcoded.ts --json          # machine output
 *
 * Exit code: always 0 in Phase 1 (advisory). Switching to a hard gate is
 * deferred to the Phase 6 baseline-file rollout.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { globSync } from 'glob'
// @ts-expect-error — JS sibling module shared with the node:test suite.
import { scanText, filterFindings, buildAllowlistMatchers } from './i18n-hardcoded-scanner.mjs'

interface HardcodedFinding {
  kind: string
  value: string
  attribute?: string
  file: string
  line: number
  column: number
  raw: string
}

interface AllowlistEntry {
  file?: string
  line?: number
  match?: string
  kind?: string
  reason?: string
}

interface AllowlistFile {
  version?: number
  entries?: AllowlistEntry[]
}

const __filename_ = typeof __filename !== 'undefined' ? __filename : fileURLToPath(import.meta.url)
const ROOT = path.resolve(path.dirname(__filename_), '..')

const red = (s: string) => `\x1b[31m${s}\x1b[0m`
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`
const green = (s: string) => `\x1b[32m${s}\x1b[0m`
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`

const DEFAULT_SCAN_GLOBS = [
  'packages/*/src/modules/**/*.{ts,tsx}',
  'packages/*/src/**/*.{ts,tsx}',
  'apps/mercato/src/modules/**/*.{ts,tsx}',
]

const DEFAULT_IGNORE = [
  '**/node_modules/**',
  '**/dist/**',
  '**/.next/**',
  '**/generated/**',
  '**/*.generated.ts',
  '**/*.generated.tsx',
  '**/*-generated.d.ts',
  '**/*.test.ts',
  '**/*.test.tsx',
  '**/*.spec.ts',
  '**/*.spec.tsx',
  '**/__tests__/**',
  '**/i18n/**',
  '**/create-app/template/**',
  '**/external/official-modules/**',
]

interface CliOptions {
  quiet: boolean
  json: boolean
  paths: string[]
  showFindingLimit: number
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    quiet: false,
    json: false,
    paths: [],
    showFindingLimit: 12,
  }
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

function deriveModuleKey(filePath: string): string {
  const rel = path.relative(ROOT, filePath)
  const m = rel.match(/^packages\/([^/]+)\/src\/modules\/([^/]+)\//)
  if (m) return `${m[1]}/${m[2]}`
  const c = rel.match(/^packages\/core\/src\/modules\/([^/]+)\//)
  if (c) return `core/${c[1]}`
  const u = rel.match(/^packages\/([^/]+)\/src\//)
  if (u) return `packages/${u[1]}`
  const a = rel.match(/^apps\/mercato\/src\/modules\/([^/]+)\//)
  if (a) return `app/${a[1]}`
  return 'other'
}

function locateAllowlistForFile(absFile: string): string | null {
  const rel = path.relative(ROOT, absFile)
  const segments = rel.split(path.sep)
  const modulesIdx = segments.indexOf('modules')
  if (modulesIdx < 0) return null
  const moduleDir = segments.slice(0, modulesIdx + 2).join(path.sep)
  const candidate = path.join(ROOT, moduleDir, 'i18n', '.hardcoded-allowlist.json')
  return fs.existsSync(candidate) ? candidate : null
}

function loadAllowlist(allowlistPath: string): AllowlistFile {
  try {
    const raw = fs.readFileSync(allowlistPath, 'utf-8')
    return JSON.parse(raw) as AllowlistFile
  } catch (err) {
    console.error(yellow(`[i18n-hardcoded] failed to parse ${path.relative(ROOT, allowlistPath)}: ${(err as Error).message}`))
    return { entries: [] }
  }
}

interface ModuleReport {
  moduleKey: string
  files: number
  findings: HardcodedFinding[]
  allowlisted: number
}

function collectSources(opts: CliOptions): string[] {
  const patterns = opts.paths.length > 0 ? opts.paths : DEFAULT_SCAN_GLOBS
  const seen = new Set<string>()
  for (const pattern of patterns) {
    const matches = globSync(pattern, {
      cwd: ROOT,
      ignore: DEFAULT_IGNORE,
      absolute: true,
    })
    for (const m of matches) seen.add(m)
  }
  return Array.from(seen).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  const files = collectSources(opts)
  const startedAt = Date.now()

  const allowlistCache = new Map<string, ReturnType<typeof buildAllowlistMatchers>>()
  const moduleReports = new Map<string, ModuleReport>()

  for (const absFile of files) {
    const relFile = path.relative(ROOT, absFile)
    let content: string
    try {
      content = fs.readFileSync(absFile, 'utf-8')
    } catch {
      continue
    }
    const findings = scanText(content, { file: relFile }) as HardcodedFinding[]
    if (findings.length === 0) {
      const key = deriveModuleKey(absFile)
      const report = moduleReports.get(key) ?? { moduleKey: key, files: 0, findings: [], allowlisted: 0 }
      report.files += 1
      moduleReports.set(key, report)
      continue
    }
    const allowlistPath = locateAllowlistForFile(absFile)
    let matchers = allowlistCache.get(allowlistPath ?? '__none__')
    if (!matchers) {
      const allowlist = allowlistPath ? loadAllowlist(allowlistPath) : { entries: [] }
      matchers = buildAllowlistMatchers(allowlist)
      allowlistCache.set(allowlistPath ?? '__none__', matchers)
    }
    const { kept, allowlisted } = filterFindings(findings, matchers)
    const key = deriveModuleKey(absFile)
    const report = moduleReports.get(key) ?? { moduleKey: key, files: 0, findings: [], allowlisted: 0 }
    report.files += 1
    report.findings.push(...kept)
    report.allowlisted += allowlisted.length
    moduleReports.set(key, report)
  }

  const reports = Array.from(moduleReports.values()).sort((a, b) =>
    b.findings.length - a.findings.length || a.moduleKey.localeCompare(b.moduleKey),
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
      modules: reports.map((r) => ({
        moduleKey: r.moduleKey,
        files: r.files,
        findings: r.findings,
        allowlisted: r.allowlisted,
      })),
    }
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n')
    process.exit(0)
  }

  console.log(`${cyan('[check]')} Hardcoded i18n strings — scanned ${totalFiles} files in ${elapsedMs}ms`)
  console.log(dim(`Patterns: JSX text, JSX attributes (label/title/placeholder/aria-label/...), throw/createCrudFormError/raiseCrudError/toast.* calls`))
  console.log('')

  if (totalFindings === 0 && totalAllowlisted === 0) {
    console.log(green('No hardcoded user-facing strings detected.'))
    process.exit(0)
  }

  for (const report of reports) {
    if (report.findings.length === 0) continue
    const summary = report.allowlisted > 0
      ? `${red(`${report.findings.length}`)} (${yellow(`+${report.allowlisted} allowlisted`)})`
      : red(`${report.findings.length}`)
    console.log(`[${report.moduleKey}] ${summary} hardcoded strings`)
    if (opts.quiet) continue
    const shown = report.findings.slice(0, opts.showFindingLimit)
    for (const finding of shown) {
      const attrSuffix = finding.attribute ? ` ${dim(`(@${finding.attribute})`)}` : ''
      console.log(
        `  ${finding.file}:${finding.line} ${dim(`[${finding.kind}]`)}${attrSuffix} ${red(JSON.stringify(finding.value))}`,
      )
    }
    if (report.findings.length > opts.showFindingLimit) {
      console.log(dim(`  ... and ${report.findings.length - opts.showFindingLimit} more`))
    }
  }

  console.log('')
  console.log(
    `Summary: ${red(`${totalFindings} hardcoded`)} • ${yellow(`${totalAllowlisted} allowlisted`)} • across ${reports.filter((r) => r.findings.length > 0).length} modules`,
  )
  console.log(dim('Phase 1 of the i18n remediation plan is advisory — exit code stays 0.'))
  console.log(dim('Allowlist format: <module>/i18n/.hardcoded-allowlist.json — see .ai/specs/2026-05-26-missing-translations-audit-and-remediation.md.'))
  process.exit(0)
}

main()
