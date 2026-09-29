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

/**
 * The mutate list this module emits is consumed as a command argument
 * (`stryker run --mutate <list>`), and its input is the diff of a pull request that
 * anyone may open — so a changed path is untrusted text, not a trusted filename.
 *
 * The allowlist is derived from what the repository actually contains rather than
 * guessed: across all 2376 in-scope `.ts` files, the only characters outside
 * `[A-Za-z0-9._/-]` are the square brackets of Next.js dynamic route segments
 * (87 `page.meta.ts` files such as `.../roles/[id]/edit/page.meta.ts`), which are
 * inert once the value is passed through the environment. Anything else — a space,
 * `$`, a backtick, a quote, `;`, `|`, `&`, `(`, `)`, a newline — is not a legitimate
 * source path here, so it is dropped at the source.
 *
 * An allowlist rather than a denylist of shell metacharacters, and enforced here
 * rather than only at the call site, so the guarantee does not depend on every
 * present and future consumer quoting the value correctly.
 */
const SAFE_PATH_PATTERN = /^[A-Za-z0-9._/[\]-]+$/

export function hasSafePathCharacters(relativePath) {
  return typeof relativePath === 'string' && SAFE_PATH_PATTERN.test(relativePath)
}

export function isInScopePath(relativePath) {
  if (typeof relativePath !== 'string' || relativePath === '') return false
  if (!hasSafePathCharacters(relativePath)) return false
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
  const args = { base: DEFAULT_BASE_REF, package: null, mutate: null }

  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--base' && index + 1 < argv.length) {
      args.base = argv[index + 1]
      index += 1
    } else if (argv[index] === '--package' && index + 1 < argv.length) {
      args.package = argv[index + 1]
      index += 1
    } else if (argv[index] === '--mutate' && index + 1 < argv.length) {
      args.mutate = argv[index + 1]
      index += 1
    }
  }

  return args
}

/**
 * Turns an explicit `--package`/`--mutate` selection into the same repository-root
 * paths a diff would have produced, so a manually dispatched run is filtered by
 * exactly the allowlist, scope and character rules a pull-request run is. An
 * operator-supplied file that would never be mutated from a diff is not mutated
 * from a dispatch either.
 */
export function explicitChangedFiles(packageName, mutateList) {
  if (typeof packageName !== 'string' || packageName === '') return []
  return String(mutateList ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
    .map((entry) => `packages/${packageName}/${entry}`)
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const changedFiles =
    args.package === null && args.mutate === null
      ? readChangedFiles(args.base)
      : explicitChangedFiles(args.package, args.mutate)
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
