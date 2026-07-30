import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import {
  CROSS_PACKAGE_EXCEPTIONS,
  REPO_WIDE_GUARDS,
  buildJestArgs,
  findCrossPackageTestCandidates,
  listGuardPaths,
} from '../repo-wide-guards.mjs'

const repoRoot = path.resolve(import.meta.dirname, '..', '..')
const workflowPath = path.join(repoRoot, '.github', 'workflows', 'ci.yml')
const STEP_NAME = 'Run repo-wide audit guards (always, unfiltered)'

function readWorkflowStep(name) {
  const lines = fs.readFileSync(workflowPath, 'utf8').split('\n')
  const startIndex = lines.findIndex((line) => line.trim() === `- name: ${name}`)
  if (startIndex === -1) return null

  const indent = lines[startIndex].indexOf('-')
  const step = [lines[startIndex]]
  for (const line of lines.slice(startIndex + 1)) {
    if (line.trim().startsWith('- ') && line.indexOf('-') === indent) break
    if (line.trim() !== '' && line.search(/\S/) <= indent) break
    step.push(line)
  }

  return step
}

test('every enumerated repo-wide guard file exists', () => {
  for (const guardPath of listGuardPaths()) {
    assert.ok(
      fs.existsSync(path.join(repoRoot, guardPath)),
      `${guardPath} is listed in scripts/repo-wide-guards.mjs but does not exist — a renamed guard would silently match zero tests, which is exactly the failure this runner exists to prevent (#4472).`,
    )
  }
})

test('every guard workspace has the jest config the runner invokes', () => {
  for (const group of REPO_WIDE_GUARDS) {
    const configPath = path.join(repoRoot, group.workspaceDir, group.jestConfig)
    assert.ok(fs.existsSync(configPath), `${group.workspace}: ${group.workspaceDir}/${group.jestConfig} does not exist.`)
  }
})

test('the runner refuses to pass when a guard matches no test', () => {
  for (const group of REPO_WIDE_GUARDS) {
    const args = buildJestArgs(group)
    assert.ok(
      args.includes('--passWithNoTests=false'),
      `${group.workspace}: the jest invocation must override the workspace config's passWithNoTests, or a guard that stops matching testMatch would exit 0 having run nothing.`,
    )
    assert.ok(args.includes('--runTestsByPath'), `${group.workspace}: guard paths must be passed as exact paths, not regexes.`)
    for (const guard of group.tests) {
      assert.ok(args.includes(guard.path), `${group.workspace}: ${guard.path} is missing from the jest invocation.`)
    }
  }
})

test('every documented exception still exists', () => {
  for (const exception of CROSS_PACKAGE_EXCEPTIONS) {
    assert.ok(
      fs.existsSync(path.join(repoRoot, exception.path)),
      `${exception.path} is listed as a repo-wide-guard exception but does not exist — drop the stale entry.`,
    )
    assert.ok(exception.reason.length > 0, `${exception.path} needs a reason for being excluded.`)
  }
})

test('no test that audits other packages is left unclassified', () => {
  const classified = new Set([...listGuardPaths(), ...CROSS_PACKAGE_EXCEPTIONS.map((entry) => entry.path)])
  const unclassified = findCrossPackageTestCandidates(repoRoot).filter((candidate) => !classified.has(candidate))

  assert.deepEqual(
    unclassified,
    [],
    `These tests read files outside their own package, so CI's turbo filter can skip them on a PR that changes those files. Add each to REPO_WIDE_GUARDS in scripts/repo-wide-guards.mjs so it runs unfiltered, or to CROSS_PACKAGE_EXCEPTIONS with a reason:\n${unclassified.join('\n')}`,
  )
})

test('no exception is stale — every excluded test still reaches outside its package', () => {
  const candidates = new Set(findCrossPackageTestCandidates(repoRoot))
  const stale = CROSS_PACKAGE_EXCEPTIONS.map((entry) => entry.path).filter((entry) => !candidates.has(entry))

  assert.deepEqual(stale, [], `These exceptions no longer audit other packages — drop them from CROSS_PACKAGE_EXCEPTIONS:\n${stale.join('\n')}`)
})

test('ci.yml runs the repo-wide guards unconditionally', () => {
  const step = readWorkflowStep(STEP_NAME)
  assert.ok(step, `ci.yml has no "${STEP_NAME}" step — the repo-wide guards would only run after merge.`)

  const body = step.join('\n')
  assert.match(body, /run: yarn test:repo-wide-guards/, 'The step must run `yarn test:repo-wide-guards`.')
  assert.ok(
    !step.some((line) => /^\s+if:/.test(line)),
    'The step must stay unconditional — a conditional step reintroduces the silent skip it exists to prevent.',
  )
})

test('the yarn shortcut used by ci.yml exists', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
  assert.equal(manifest.scripts['test:repo-wide-guards'], 'node scripts/repo-wide-guards.mjs')
})

test('the detector recognizes a cross-package audit and ignores a package-local test', () => {
  const candidates = findCrossPackageTestCandidates(repoRoot)
  assert.ok(
    candidates.includes('packages/core/src/__tests__/explicit-sort-comparators.test.ts'),
    'The explicit-sort-comparator guard scans every package plus scripts/ and must be detected as cross-package.',
  )
  assert.ok(
    !candidates.includes('packages/core/src/__tests__/module-decoupling.test.ts'),
    'module-decoupling builds an in-memory registry and reads no other package — it must not be flagged.',
  )
})
