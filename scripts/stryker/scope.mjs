/**
 * Diff → per-package mutate lists, emitted as a GitHub Actions matrix.
 *
 * StrykerJS has no `--since` flag, so diff scoping is ours to compute: we resolve the
 * changed files against a base ref, keep only business-logic paths inside allowlisted
 * packages, and hand the result to `stryker run --mutate <list>`.
 *
 * The filter here is deliberately stricter than the `mutate` globs in createConfig.mjs.
 * Those globs describe "what could be mutated in a full-package run"; this filter
 * describes "what is worth mutating in a pull request" — which excludes API route
 * handlers (thin transport wrappers whose logic lives in commands and validators) and
 * every `.tsx` file (rendering, covered by UI tests rather than mutation scoring).
 *
 * Usage:
 *   node scripts/stryker/scope.mjs [--base <ref>]
 *
 * Output is always the matrix JSON on stdout; dropped-file warnings go to stderr so
 * they never pollute it.
 *
 * Always exits 0. An empty matrix means "nothing in scope", which the workflow treats
 * as a skip — never as a failure and never as a synthetic score.
 *
 * @see .ai/specs/2026-07-31-stryker-mutation-testing-ci-gate.md
 */

import { execFileSync } from 'node:child_process'

export const DEFAULT_BASE_REF = 'origin/develop'
export const DEFAULT_MAX_FILES = 25

/**
 * Packages whose changed files are mutated in CI. Adding a package here is a
 * deliberate, measured decision: a package joins only after a timing run shows a
 * PR-sized diff completes well inside the workflow's timeout.
 */
export const ALLOWLISTED_PACKAGES = Object.freeze(['shared'])

const IN_SCOPE_PREFIXES = Object.freeze(['src/lib/', 'src/modules/', 'src/security/'])

const OUT_OF_SCOPE_SEGMENTS = Object.freeze([
  '/__tests__/',
  '/__mocks__/',
  '/api/',
  '/migrations/',
  '/generated/',
  '/testing/',
])

export function isInScopePath(relativePath) {
  if (typeof relativePath !== 'string' || relativePath === '') return false
  if (!relativePath.endsWith('.ts')) return false
  if (relativePath.endsWith('.d.ts')) return false
  if (relativePath.endsWith('.test.ts')) return false
  if (relativePath.endsWith('.spec.ts')) return false

  if (!IN_SCOPE_PREFIXES.some((prefix) => relativePath.startsWith(prefix))) return false

  const padded = `/${relativePath}`
  return !OUT_OF_SCOPE_SEGMENTS.some((segment) => padded.includes(segment))
}

/**
 * Code-point ordering, not `localeCompare`. The mutate list must be byte-identical
 * across machines and CI runners so a re-run mutates the same files in the same
 * order; a locale-sensitive collation would make that environment-dependent.
 */
export function compareByCodePoint(left, right) {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function splitPackagePath(changedPath) {
  const match = /^packages\/([^/]+)\/(.+)$/.exec(changedPath)
  if (match === null) return null
  return { packageName: match[1], relativePath: match[2] }
}

/**
 * @param {string[]} changedFiles paths relative to the repository root
 * @returns {{ matrix: { include: Array<{ package: string, mutate: string }> }, dropped: Array<{ package: string, files: string[] }> }}
 */
export function computeScope(changedFiles, options = {}) {
  const { allowlist = ALLOWLISTED_PACKAGES, maxFiles = DEFAULT_MAX_FILES } = options
  const byPackage = new Map()

  for (const changedPath of changedFiles) {
    const split = splitPackagePath(changedPath)
    if (split === null) continue
    if (!allowlist.includes(split.packageName)) continue
    if (!isInScopePath(split.relativePath)) continue

    const existing = byPackage.get(split.packageName)
    if (existing === undefined) byPackage.set(split.packageName, [split.relativePath])
    else existing.push(split.relativePath)
  }

  const include = []
  const dropped = []

  for (const packageName of [...byPackage.keys()].sort(compareByCodePoint)) {
    const files = [...new Set(byPackage.get(packageName))].sort(compareByCodePoint)
    const kept = files.slice(0, maxFiles)
    const truncated = files.slice(maxFiles)

    if (kept.length > 0) include.push({ package: packageName, mutate: kept.join(',') })
    if (truncated.length > 0) dropped.push({ package: packageName, files: truncated })
  }

  return { matrix: { include }, dropped }
}

export function readChangedFiles(baseRef, runGit = defaultRunGit) {
  const output = runGit(['diff', '--name-only', '--diff-filter=d', `${baseRef}...HEAD`])
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
}

function defaultRunGit(args) {
  return execFileSync('git', args, { encoding: 'utf8' })
}

export function parseArgs(argv) {
  const args = { base: DEFAULT_BASE_REF }

  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--base' && index + 1 < argv.length) {
      args.base = argv[index + 1]
      index += 1
    }
  }

  return args
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const changedFiles = readChangedFiles(args.base)
  const { matrix, dropped } = computeScope(changedFiles)

  for (const entry of dropped) {
    process.stderr.write(
      `[stryker:scope] ${entry.package}: capped at ${DEFAULT_MAX_FILES} files; ` +
        `not mutated in this run: ${entry.files.join(', ')}\n`,
    )
  }

  process.stdout.write(`${JSON.stringify(matrix)}\n`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
