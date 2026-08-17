/**
 * Local entry point: mutate only what this working tree changed.
 *
 * The run is `inPlace` (forced — see createConfig.mjs), so Stryker rewrites real
 * source files and restores them from `.stryker-tmp/backup-*` when it finishes.
 * Two consequences shape this wrapper:
 *
 *   1. It refuses to start on a dirty working tree. If Stryker's restore is ever
 *      skipped — a killed process, a full disk — the recovery is `git checkout -- .`,
 *      which is only safe when there was nothing uncommitted to lose.
 *   2. Recovery is not hypothetical. Stryker's `disableTypeChecks` default prepends
 *      `// @ts-nocheck` to every file it may mutate, so an interrupted run can leave
 *      thousands of modified files behind. That is why the guard is a hard stop and
 *      not a warning, and why CI — ephemeral by construction — is the supported
 *      environment.
 *
 * Usage:
 *   yarn mutation:changed [--base <ref>]
 *
 * @see .ai/specs/2026-07-31-stryker-mutation-testing-ci-gate.md
 */

import { execFileSync, spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_BASE_REF, computeScope, parseArgs, readChangedFiles } from './scope.mjs'
import { partitionByRelatedTests } from './relatedTests.mjs'

const REPOSITORY_ROOT = fileURLToPath(new URL('../..', import.meta.url))

export const DIRTY_TREE_MESSAGE = [
  'Refusing to run: your working tree has uncommitted changes.',
  '',
  'Mutation testing rewrites real source files in place and restores them afterwards.',
  'If a run is interrupted, the only reliable recovery is:',
  '',
  '    git checkout -- .',
  '',
  'That would discard your uncommitted work, so commit or stash it first.',
].join('\n')

export function isWorkingTreeClean(porcelainOutput) {
  if (typeof porcelainOutput !== 'string') return false
  return porcelainOutput
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .length === 0
}

/**
 * @returns {{ exitCode: number, ranPackages: string[] }}
 */
export function runMutationChanged(dependencies = {}) {
  const {
    runGit = defaultRunGit,
    runStryker = defaultRunStryker,
    partitionRelatedTests = defaultPartitionRelatedTests,
    write = (message) => process.stderr.write(`${message}\n`),
    baseRef = DEFAULT_BASE_REF,
  } = dependencies

  if (!isWorkingTreeClean(runGit(['status', '--porcelain']))) {
    write(DIRTY_TREE_MESSAGE)
    return { exitCode: 1, ranPackages: [] }
  }

  const changedFiles = readChangedFiles(baseRef, runGit)
  const { matrix, dropped } = computeScope(changedFiles)

  for (const entry of dropped) {
    write(
      `[stryker] ${entry.package}: file cap reached; not mutated: ${entry.files.join(', ')}`,
    )
  }

  if (matrix.include.length === 0) {
    write(`[stryker] No in-scope changes against ${baseRef}. Nothing to mutate.`)
    return { exitCode: 0, ranPackages: [] }
  }

  const ranPackages = []
  let exitCode = 0

  for (const entry of matrix.include) {
    const { covered, uncovered } = partitionRelatedTests(entry.mutate.split(','), entry.package)

    if (uncovered.length > 0) {
      write(`[stryker] ${entry.package}: no related tests, not mutated: ${uncovered.join(', ')}`)
    }

    if (covered.length === 0) {
      write(`[stryker] ${entry.package}: nothing left to mutate after filtering for related tests.`)
      continue
    }

    write(`[stryker] Mutating ${entry.package}: ${covered.join(',')}`)
    const status = runStryker({ package: entry.package, mutate: covered.join(',') })
    ranPackages.push(entry.package)
    if (status !== 0) exitCode = status
  }

  return { exitCode, ranPackages }
}

function defaultRunGit(args) {
  return execFileSync('git', args, { cwd: REPOSITORY_ROOT, encoding: 'utf8' })
}

function defaultPartitionRelatedTests(files, packageName) {
  return partitionByRelatedTests(files, {
    packageDir: path.join(REPOSITORY_ROOT, 'packages', packageName),
  })
}

function defaultRunStryker(entry) {
  const result = spawnSync(
    process.execPath,
    [
      path.join(REPOSITORY_ROOT, 'node_modules', '.bin', 'stryker'),
      'run',
      '--mutate',
      entry.mutate,
    ],
    { cwd: path.join(REPOSITORY_ROOT, 'packages', entry.package), stdio: 'inherit' },
  )

  return result.status ?? 1
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const { exitCode } = runMutationChanged({ baseRef: args.base })
  process.exit(exitCode)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
}
