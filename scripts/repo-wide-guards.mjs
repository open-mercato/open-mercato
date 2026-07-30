#!/usr/bin/env node
/**
 * Repo-wide guard runner.
 *
 * Most package tests are package-scoped: they only read files inside their own workspace, so
 * CI's dependency-graph filter (`yarn turbo run test --filter=[origin/<base>]...`) correctly
 * skips them when the package is untouched. A handful of tests are the opposite — repo-wide
 * audits that deliberately scan OTHER packages, `apps/`, or `scripts/`. The turbo filter
 * selects packages, not paths, so a PR touching only `scripts/` (or only `apps/`) selects no
 * owning package and those audits never run; the violation then surfaces on the post-merge
 * unfiltered `yarn test` and turns the base branch red for everyone (#4527, #4534 — the same
 * shape as the create-app parity guards in #3779 and the zero-match filter in #4472).
 *
 * This module is the single enumeration of those audits. CI runs it unconditionally so a
 * `scripts/`-only violation fails its own PR, and `scripts/__tests__/repo-wide-guards.test.mjs`
 * keeps the enumeration honest: every listed path must exist, and every test that reaches
 * outside its own package must be classified here — either as a guard to run, or as a
 * documented exception.
 *
 * Adding a test that reads files outside its own package? Add it to `REPO_WIDE_GUARDS` (or to
 * `CROSS_PACKAGE_EXCEPTIONS` with a reason if it must not run on every PR).
 *
 * Usage:
 *   node scripts/repo-wide-guards.mjs          # run every enumerated guard (exit 1 on failure)
 *   node scripts/repo-wide-guards.mjs --list   # print the enumeration without running it
 *
 * Yarn shortcut: `yarn test:repo-wide-guards`
 */

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { resolveProjectBinary, resolveSpawnCommand } from './dev-spawn-utils.mjs'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = path.resolve(SCRIPT_DIR, '..')

/**
 * The repo-wide audits, grouped by the workspace that hosts them. One jest run per workspace
 * keeps the whole set in the seconds range (~10 s in total), so it can stay on the common PR path.
 */
export const REPO_WIDE_GUARDS = [
  {
    workspace: '@open-mercato/core',
    workspaceDir: 'packages/core',
    jestConfig: 'jest.config.cjs',
    tests: [
      {
        path: 'src/__tests__/explicit-sort-comparators.test.ts',
        scans: 'every packages/*/src root plus scripts/ — sort calls without an explicit comparator (#3620)',
      },
      {
        path: 'src/__tests__/alert-duplicate-icon-coverage.test.ts',
        scans: 'every packages/*/src root — duplicated alert icons',
      },
      {
        path: 'src/__tests__/auth-onboarding-feedback-ds-tokens.test.ts',
        scans: 'packages/core and packages/onboarding frontends — hardcoded status colors (#3165)',
      },
      {
        path: 'src/__tests__/license-metadata-consistency.test.ts',
        scans: 'git-tracked files repo-wide — enterprise license headers',
      },
      {
        path: 'src/__tests__/types-dependency-classification.test.ts',
        scans: 'git-tracked files repo-wide — @types placement across workspace manifests',
      },
      {
        path: 'src/__tests__/optimistic-lock-ui-coverage-workspace.test.ts',
        scans: 'every packages/*/src/modules tree — optimistic-lock UI coverage',
      },
      {
        path: 'src/__tests__/optimistic-lock-command-coverage.test.ts',
        scans: 'every packages/*/src/modules tree — optimistic-lock command coverage',
      },
      {
        path: 'src/modules/__tests__/crud-indexer-config.test.ts',
        scans: 'packages/ and apps/ — CRUD indexer configuration',
      },
    ],
  },
  {
    workspace: '@open-mercato/cli',
    workspaceDir: 'packages/cli',
    jestConfig: 'jest.config.cjs',
    tests: [
      {
        path: 'src/lib/generators/__tests__/module-facts.bc-guard.test.ts',
        scans: 'every package module source — generator BC resolve guard',
      },
      {
        path: 'src/lib/generators/__tests__/example-public-route-safety.test.ts',
        scans: 'apps/mercato and packages/create-app/template — example route safety (#3864)',
      },
      {
        path: 'src/lib/generators/__tests__/disabled-example-module.test.ts',
        scans: 'apps/mercato — generated registries with the example module disabled',
      },
      {
        path: 'src/lib/__tests__/release-notes-retired.test.ts',
        scans: 'repo-root docs — RELEASE_NOTES.md retirement (#4024)',
      },
    ],
  },
  {
    workspace: '@open-mercato/shared',
    workspaceDir: 'packages/shared',
    jestConfig: 'jest.config.cjs',
    tests: [
      {
        path: 'src/lib/db/__tests__/escapeLikePattern.test.ts',
        scans: 'packages/ and apps/ — unescaped LIKE patterns in query builders',
      },
    ],
  },
  {
    workspace: '@open-mercato/ui',
    workspaceDir: 'packages/ui',
    jestConfig: 'jest.config.cjs',
    tests: [
      {
        path: 'src/primitives/__tests__/zindex-overlay.test.tsx',
        scans: 'apps/mercato and packages/create-app/template globals.css — z-index scale',
      },
    ],
  },
  {
    workspace: '@open-mercato/app',
    workspaceDir: 'apps/mercato',
    jestConfig: 'jest.config.cjs',
    tests: [
      {
        path: 'src/components/__tests__/starter-chrome-ds.test.ts',
        scans: 'apps/mercato and packages/create-app/template components — DS status tokens in starter chrome',
      },
      {
        path: 'src/components/__tests__/StartPageContent.test.tsx',
        scans: 'apps/mercato and packages/create-app/template StartPageContent — hydration-safety guard',
      },
    ],
  },
]

/**
 * Tests that reach outside their own package but are deliberately NOT part of this run.
 * Each entry needs a reason, so the next person can tell "already covered" from "forgotten".
 */
export const CROSS_PACKAGE_EXCEPTIONS = [
  {
    path: 'packages/create-app/src/lib/template-dependency-drift.test.ts',
    reason: 'Already unfiltered — the "Check create-app template parity" CI step runs the whole create-mercato-app suite (#3779).',
  },
  {
    path: 'packages/create-app/src/lib/standalone-cache-strategy-guard.test.ts',
    reason: 'Already unfiltered — covered by the same create-app parity step (#3779).',
  },
  {
    path: 'packages/ui/src/backend/__tests__/FieldDefinitionsEditor.test.tsx',
    reason: 'Package-local despite the repo-root anchor — it only reads packages/ui sources, so the turbo filter selects it correctly.',
  },
  {
    path: 'packages/ui/src/backend/__tests__/lazy-heavy-libraries.test.ts',
    reason: 'Package-local despite the repo-root anchor — it only reads packages/ui sources.',
  },
  {
    path: 'packages/ui/src/primitives/__tests__/no-deprecated-notice.test.ts',
    reason: 'Package-local despite the repo-root anchor — it only reads packages/ui sources.',
  },
]

const CROSS_PACKAGE_ANCHOR = /findRepoRoot|process\.cwd\(\)/
const DIRNAME_ASCENT = /(?:path\.)?(?:resolve|join)\(\s*__dirname\s*,([^)]*)\)/g
const OUTSIDE_REFERENCE = /(['"`])(?:packages|apps|scripts|external)\/|(['"`])(?:packages|apps|scripts|external)\2|git ls-files/
const TEST_FILE = /\.test\.tsx?$/
const IGNORED_DIRECTORIES = new Set(['node_modules', 'dist', 'generated', '.turbo'])

function collectTestFiles(directory, collected) {
  let entries
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true })
  } catch {
    return collected
  }

  for (const entry of entries) {
    if (IGNORED_DIRECTORIES.has(entry.name)) continue
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) collectTestFiles(full, collected)
    else if (TEST_FILE.test(entry.name)) collected.push(full)
  }

  return collected
}

/**
 * True when the test anchors on a path above its own workspace directory. `relativePath` is
 * `<root>/<workspace>/<dirs…>/<file>`, so the directory depth below the workspace root is the
 * segment count minus the two leading segments and the file name; an ascent larger than that
 * leaves the workspace.
 */
function escapesPackageRoot(source, relativePath) {
  if (CROSS_PACKAGE_ANCHOR.test(source)) return true

  const depthBelowPackageRoot = relativePath.split('/').length - 3
  DIRNAME_ASCENT.lastIndex = 0
  let match = DIRNAME_ASCENT.exec(source)
  while (match) {
    const ascent = (match[1].match(/\.\./g) ?? []).length
    if (ascent > depthBelowPackageRoot) return true
    match = DIRNAME_ASCENT.exec(source)
  }

  return false
}

/**
 * Heuristic discovery of tests that audit files outside their own workspace: they anchor on a
 * repo root (a `__dirname` ascent past the workspace root, a `findRepoRoot()` helper, or
 * `process.cwd()`) AND reference another tree (`packages/`, `apps/`, `scripts/`, `external/`,
 * or `git ls-files`). Scans the `src` tree of every workspace under `packages` and `apps`; the optional
 * `external/official-modules` submodule is out of scope because it is absent in CI. Returns
 * repo-relative paths, so the manifest test can compare them against the enumeration above.
 */
export function findCrossPackageTestCandidates(repoRoot = REPO_ROOT) {
  const candidates = []

  for (const workspaceRoot of ['packages', 'apps']) {
    let workspaces
    try {
      workspaces = fs.readdirSync(path.join(repoRoot, workspaceRoot), { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of workspaces) {
      if (!entry.isDirectory()) continue
      const sourceRoot = path.join(repoRoot, workspaceRoot, entry.name, 'src')
      for (const file of collectTestFiles(sourceRoot, [])) {
        const relativePath = path.relative(repoRoot, file).split(path.sep).join('/')
        const source = fs.readFileSync(file, 'utf8')
        if (!OUTSIDE_REFERENCE.test(source)) continue
        if (!escapesPackageRoot(source, relativePath)) continue
        candidates.push(relativePath)
      }
    }
  }

  return candidates.sort((left, right) => left.localeCompare(right))
}

/** Every guard path from the manifest, repo-relative. */
export function listGuardPaths() {
  return REPO_WIDE_GUARDS.flatMap((group) => group.tests.map((test) => `${group.workspaceDir}/${test.path}`))
}

/**
 * Jest arguments for one workspace group. `--passWithNoTests=false` is load-bearing: every
 * workspace jest config sets `passWithNoTests: true`, so a guard that stops matching its
 * config's `testMatch` (moved out of `__tests__/`, renamed to `.spec.ts`) would otherwise exit 0
 * having run nothing — the silent zero-match this runner exists to prevent.
 */
export function buildJestArgs(group) {
  return [
    '--config',
    group.jestConfig,
    '--passWithNoTests=false',
    '--runTestsByPath',
    ...group.tests.map((test) => test.path),
  ]
}

function runGuardGroup(group) {
  const workspaceDir = path.join(REPO_ROOT, group.workspaceDir)
  const jestBinary = resolveProjectBinary('jest', { cwd: REPO_ROOT })
  const resolvedSpawn = resolveSpawnCommand(jestBinary, buildJestArgs(group))

  console.log(`\n▶ ${group.workspace} — ${group.tests.length} repo-wide guard(s)`)
  const result = spawnSync(resolvedSpawn.command, resolvedSpawn.args, {
    cwd: workspaceDir,
    stdio: 'inherit',
    ...resolvedSpawn.spawnOptions,
  })

  if (result.error) {
    console.error(`Failed to run jest for ${group.workspace}: ${result.error.message}`)
    return false
  }

  return result.status === 0
}

function printManifest() {
  for (const group of REPO_WIDE_GUARDS) {
    console.log(`${group.workspace} (${group.workspaceDir})`)
    for (const test of group.tests) {
      console.log(`  - ${test.path} — ${test.scans}`)
    }
  }
  console.log('\nDeliberately excluded:')
  for (const exception of CROSS_PACKAGE_EXCEPTIONS) {
    console.log(`  - ${exception.path} — ${exception.reason}`)
  }
}

function main() {
  if (process.argv.slice(2).includes('--list')) {
    printManifest()
    return
  }

  const failedWorkspaces = []
  for (const group of REPO_WIDE_GUARDS) {
    if (!runGuardGroup(group)) failedWorkspaces.push(group.workspace)
  }

  if (failedWorkspaces.length > 0) {
    console.error(`\nRepo-wide guards failed in: ${failedWorkspaces.join(', ')}`)
    process.exit(1)
  }

  console.log(`\nAll repo-wide guards passed (${listGuardPaths().length} test files).`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
