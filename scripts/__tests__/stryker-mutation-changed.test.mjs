import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  DIRTY_TREE_MESSAGE,
  isWorkingTreeClean,
  runMutationChanged,
} from '../stryker/mutation-changed.mjs'

function createHarness({ status = '', diff = '', strykerStatus = 0, uncoveredByFile = {} } = {}) {
  const strykerCalls = []
  const written = []

  const runGit = (args) => {
    if (args[0] === 'status') return status
    if (args[0] === 'diff') return diff
    throw new Error(`[internal] unexpected git call: ${args.join(' ')}`)
  }

  const runStryker = (entry) => {
    strykerCalls.push(entry)
    return strykerStatus
  }

  // Every file is covered unless the test opts a specific one out — keeps the
  // existing Stryker-call assertions below unaffected by the coverage filter.
  const partitionRelatedTests = (files) => {
    const uncovered = files.filter((file) => uncoveredByFile[file])
    const covered = files.filter((file) => !uncoveredByFile[file])
    return { covered, uncovered }
  }

  return {
    runGit,
    runStryker,
    partitionRelatedTests,
    write: (message) => written.push(message),
    strykerCalls,
    written,
  }
}

test('refuses to run on a dirty tree, exits non-zero, and never invokes Stryker', () => {
  const harness = createHarness({
    status: ' M packages/shared/src/lib/boolean.ts\n',
    diff: 'packages/shared/src/lib/boolean.ts\n',
  })

  const result = runMutationChanged(harness)

  assert.equal(result.exitCode, 1)
  assert.deepEqual(harness.strykerCalls, [])
  assert.deepEqual(result.ranPackages, [])
})

test('the refusal explains the in-place risk and prints the recovery command', () => {
  const harness = createHarness({ status: '?? untracked.ts\n' })

  runMutationChanged(harness)

  assert.equal(harness.written[0], DIRTY_TREE_MESSAGE)
  assert.match(harness.written[0], /git checkout -- \./)
  assert.match(harness.written[0], /uncommitted/)
})

test('treats untracked files as dirty — Stryker restore does not distinguish them', () => {
  assert.equal(isWorkingTreeClean('?? scratch.ts\n'), false)
  assert.equal(isWorkingTreeClean(' M src/a.ts\n'), false)
  assert.equal(isWorkingTreeClean(''), true)
  assert.equal(isWorkingTreeClean('   \n  \n'), true)
  assert.equal(isWorkingTreeClean(undefined), false)
})

test('runs Stryker once per in-scope package on a clean tree', () => {
  const harness = createHarness({
    status: '',
    diff: 'packages/shared/src/lib/boolean.ts\npackages/shared/src/lib/phone.ts\n',
  })

  const result = runMutationChanged(harness)

  assert.equal(result.exitCode, 0)
  assert.deepEqual(harness.strykerCalls, [
    { package: 'shared', mutate: 'src/lib/boolean.ts,src/lib/phone.ts' },
  ])
  assert.deepEqual(result.ranPackages, ['shared'])
})

test('skips cleanly when the diff contains nothing in scope', () => {
  const harness = createHarness({
    status: '',
    diff: 'apps/mercato/src/app/page.tsx\nREADME.md\n',
  })

  const result = runMutationChanged(harness)

  assert.equal(result.exitCode, 0)
  assert.deepEqual(harness.strykerCalls, [])
  assert.match(harness.written.join('\n'), /Nothing to mutate/)
})

test('propagates a non-zero Stryker exit code', () => {
  const harness = createHarness({
    status: '',
    diff: 'packages/shared/src/lib/boolean.ts\n',
    strykerStatus: 3,
  })

  assert.equal(runMutationChanged(harness).exitCode, 3)
})

test('reports capped files rather than silently truncating', () => {
  const diff = Array.from(
    { length: 28 },
    (_unused, index) => `packages/shared/src/lib/file-${String(index).padStart(3, '0')}.ts`,
  ).join('\n')

  const harness = createHarness({ status: '', diff })

  runMutationChanged(harness)

  assert.match(harness.written.join('\n'), /file cap reached; not mutated/)
})

test('drops a file with no related tests and mutates only the covered ones', () => {
  const harness = createHarness({
    status: '',
    diff: 'packages/shared/src/lib/boolean.ts\npackages/shared/src/lib/untested.ts\n',
    uncoveredByFile: { 'src/lib/untested.ts': true },
  })

  const result = runMutationChanged(harness)

  assert.equal(result.exitCode, 0)
  assert.deepEqual(harness.strykerCalls, [{ package: 'shared', mutate: 'src/lib/boolean.ts' }])
  assert.match(harness.written.join('\n'), /no related tests, not mutated: src\/lib\/untested\.ts/)
})

test('skips Stryker entirely for a package where every file has no related tests', () => {
  const harness = createHarness({
    status: '',
    diff: 'packages/shared/src/lib/untested.ts\n',
    uncoveredByFile: { 'src/lib/untested.ts': true },
  })

  const result = runMutationChanged(harness)

  assert.equal(result.exitCode, 0)
  assert.deepEqual(harness.strykerCalls, [])
  assert.deepEqual(result.ranPackages, [])
  assert.match(harness.written.join('\n'), /nothing left to mutate after filtering for related tests/)
})

test('Stryker output is gitignored, so a run never self-blocks the next one', () => {
  const gitignore = fs.readFileSync(
    fileURLToPath(new URL('../../.gitignore', import.meta.url)),
    'utf8',
  )

  assert.match(gitignore, /^\.stryker-tmp\/$/m)
  assert.match(gitignore, /^\*\*\/reports\/mutation\/$/m)
})
