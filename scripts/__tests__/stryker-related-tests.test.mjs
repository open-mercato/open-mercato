import assert from 'node:assert/strict'
import test from 'node:test'
import {
  parsePartitionArgs,
  partitionByRelatedTests,
  splitMutateList,
} from '../stryker/relatedTests.mjs'

test('partitions files into covered and uncovered by whether Jest found a related test', () => {
  const runJest = (file) => (file === 'src/lib/tested.ts' ? '/repo/src/lib/__tests__/tested.test.ts\n' : '')

  const { covered, uncovered } = partitionByRelatedTests(
    ['src/lib/tested.ts', 'src/lib/untested.ts'],
    { packageDir: '/repo/packages/shared', runJest },
  )

  assert.deepEqual(covered, ['src/lib/tested.ts'])
  assert.deepEqual(uncovered, ['src/lib/untested.ts'])
})

test('treats whitespace-only Jest output as uncovered', () => {
  const { covered, uncovered } = partitionByRelatedTests(['src/lib/untested.ts'], {
    packageDir: '/repo/packages/shared',
    runJest: () => '   \n',
  })

  assert.deepEqual(covered, [])
  assert.deepEqual(uncovered, ['src/lib/untested.ts'])
})

test('returns an empty partition for an empty file list', () => {
  const calls = []
  const { covered, uncovered } = partitionByRelatedTests([], {
    packageDir: '/repo/packages/shared',
    runJest: (file) => {
      calls.push(file)
      return ''
    },
  })

  assert.deepEqual(covered, [])
  assert.deepEqual(uncovered, [])
  assert.deepEqual(calls, [])
})

test('parses the --mutate flag', () => {
  assert.deepEqual(parsePartitionArgs(['--mutate', 'src/lib/a.ts,src/lib/b.ts']), {
    mutate: 'src/lib/a.ts,src/lib/b.ts',
  })
  assert.deepEqual(parsePartitionArgs([]), { mutate: null })
})

test('splits a comma-separated mutate list, dropping blanks and surrounding whitespace', () => {
  assert.deepEqual(splitMutateList('src/lib/a.ts, src/lib/b.ts,'), ['src/lib/a.ts', 'src/lib/b.ts'])
  assert.deepEqual(splitMutateList(''), [])
  assert.deepEqual(splitMutateList(null), [])
})
