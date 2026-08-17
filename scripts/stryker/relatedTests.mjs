/**
 * Partitions a package's diff-scoped mutate files into files Jest has at least one
 * related test for, and files it does not.
 *
 * `createConfig.mjs` sets `jest.enableFindRelatedTests: true`, so Stryker's dry run
 * only executes tests related to each mutated file. When a file has none, the dry
 * run executes zero tests and Stryker throws `ConfigError: No tests were executed`,
 * aborting the whole job instead of scoring (issue #5281). Filtering the mutate list
 * down to files Jest can find a related test for — before Stryker ever runs — avoids
 * that abort; the dropped files are reported as needing tests instead.
 *
 * `jest --listTests --findRelatedTests <file>` resolves the module dependency graph
 * statically (via the haste map) without running anything, so this costs one Jest
 * startup per file, not a full test run. Verified manually against this repository's
 * `packages/shared` config: exit 0 with empty stdout for a file nothing imports,
 * non-empty stdout for a file with covering tests.
 *
 * @see .ai/specs/2026-07-31-stryker-mutation-testing-ci-gate.md
 */

import { execFileSync } from 'node:child_process'
import path from 'node:path'

/**
 * @param {string[]} files package-relative paths (e.g. 'src/lib/boolean.ts')
 * @param {{ packageDir: string, runJest?: (file: string, packageDir: string) => string }} options
 * @returns {{ covered: string[], uncovered: string[] }}
 */
export function partitionByRelatedTests(files, options = {}) {
  const { packageDir, runJest = defaultRunJest } = options
  const covered = []
  const uncovered = []

  for (const file of files) {
    const output = runJest(file, packageDir)
    if (output.trim() === '') uncovered.push(file)
    else covered.push(file)
  }

  return { covered, uncovered }
}

function defaultRunJest(file, packageDir) {
  return execFileSync(
    process.execPath,
    [
      path.join(packageDir, '..', '..', 'node_modules', '.bin', 'jest'),
      '--config',
      'jest.config.cjs',
      '--listTests',
      '--findRelatedTests',
      file,
    ],
    { cwd: packageDir, encoding: 'utf8' },
  )
}

export function parsePartitionArgs(argv) {
  const args = { mutate: null }

  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--mutate' && index + 1 < argv.length) {
      args.mutate = argv[index + 1]
      index += 1
    }
  }

  return args
}

export function splitMutateList(mutate) {
  return String(mutate ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
}

function main() {
  const args = parsePartitionArgs(process.argv.slice(2))
  const files = splitMutateList(args.mutate)
  const { covered, uncovered } = partitionByRelatedTests(files, { packageDir: process.cwd() })

  if (uncovered.length > 0) {
    process.stderr.write(
      `[stryker:related-tests] no related tests, not mutated: ${uncovered.join(', ')}\n`,
    )
  }

  process.stdout.write(`covered=${covered.join(',')}\n`)
  process.stdout.write(`uncovered=${uncovered.join(',')}\n`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
