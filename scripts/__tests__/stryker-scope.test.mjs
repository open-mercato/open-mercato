import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ALLOWLISTED_PACKAGES,
  DEFAULT_BASE_REF,
  DEFAULT_MAX_FILES,
  computeScope,
  isInScopePath,
  parseArgs,
  readChangedFiles,
} from '../stryker/scope.mjs'

test('includes an in-scope business-logic file from an allowlisted package', () => {
  const { matrix } = computeScope(['packages/shared/src/lib/boolean.ts'])

  assert.deepEqual(matrix.include, [{ package: 'shared', mutate: 'src/lib/boolean.ts' }])
})

test('excludes .tsx files — rendering is covered by UI tests, not mutation scoring', () => {
  const { matrix } = computeScope([
    'packages/shared/src/modules/widgets/Panel.tsx',
    'packages/shared/src/lib/boolean.ts',
  ])

  assert.deepEqual(matrix.include, [{ package: 'shared', mutate: 'src/lib/boolean.ts' }])
})

test('excludes api/ route handlers', () => {
  const { matrix } = computeScope(['packages/shared/src/modules/things/api/list.ts'])

  assert.deepEqual(matrix.include, [])
})

test('excludes tests, mocks, type declarations, migrations, generated and testing helpers', () => {
  const { matrix } = computeScope([
    'packages/shared/src/lib/__tests__/boolean.test.ts',
    'packages/shared/src/lib/__mocks__/clock.ts',
    'packages/shared/src/lib/boolean.test.ts',
    'packages/shared/src/lib/boolean.spec.ts',
    'packages/shared/src/lib/types.d.ts',
    'packages/shared/src/modules/things/migrations/0001-init.ts',
    'packages/shared/src/modules/things/generated/ids.ts',
    'packages/shared/src/lib/testing/fixtures.ts',
  ])

  assert.deepEqual(matrix.include, [])
})

test('excludes files outside the allowlisted packages', () => {
  const { matrix } = computeScope([
    'packages/core/src/lib/thing.ts',
    'apps/mercato/src/lib/thing.ts',
    'scripts/stryker/scope.mjs',
    'packages/shared/src/lib/boolean.ts',
  ])

  assert.deepEqual(matrix.include, [{ package: 'shared', mutate: 'src/lib/boolean.ts' }])
})

test('excludes paths outside src/lib, src/modules and src/security', () => {
  const { matrix } = computeScope([
    'packages/shared/src/index.ts',
    'packages/shared/jest.config.cjs',
    'packages/shared/src/types/foo.ts',
  ])

  assert.deepEqual(matrix.include, [])
})

test('an empty diff yields an empty matrix rather than a synthetic entry', () => {
  assert.deepEqual(computeScope([]).matrix, { include: [] })
  assert.deepEqual(computeScope([]).dropped, [])
})

test('caps the mutate list and reports exactly what was dropped', () => {
  const changed = Array.from(
    { length: DEFAULT_MAX_FILES + 3 },
    (_unused, index) => `packages/shared/src/lib/file-${String(index).padStart(3, '0')}.ts`,
  )

  const { matrix, dropped } = computeScope(changed)
  const kept = matrix.include[0].mutate.split(',')

  assert.equal(kept.length, DEFAULT_MAX_FILES)
  assert.equal(dropped.length, 1)
  assert.equal(dropped[0].package, 'shared')
  assert.deepEqual(dropped[0].files, [
    'src/lib/file-025.ts',
    'src/lib/file-026.ts',
    'src/lib/file-027.ts',
  ])
  assert.equal(kept.length + dropped[0].files.length, changed.length)
})

test('sorts deterministically and de-duplicates repeated paths', () => {
  const { matrix } = computeScope([
    'packages/shared/src/lib/zebra.ts',
    'packages/shared/src/lib/alpha.ts',
    'packages/shared/src/lib/zebra.ts',
  ])

  assert.deepEqual(matrix.include, [
    { package: 'shared', mutate: 'src/lib/alpha.ts,src/lib/zebra.ts' },
  ])
})

test('groups by package and orders packages deterministically', () => {
  const { matrix } = computeScope(
    ['packages/ui/src/lib/b.ts', 'packages/shared/src/lib/a.ts'],
    { allowlist: ['shared', 'ui'] },
  )

  assert.deepEqual(matrix.include, [
    { package: 'shared', mutate: 'src/lib/a.ts' },
    { package: 'ui', mutate: 'src/lib/b.ts' },
  ])
})

test('asks git to exclude deleted files, which Stryker cannot mutate', () => {
  const calls = []
  const runGit = (args) => {
    calls.push(args)
    return 'packages/shared/src/lib/boolean.ts\n\n'
  }

  const files = readChangedFiles('origin/develop', runGit)

  assert.deepEqual(files, ['packages/shared/src/lib/boolean.ts'])
  assert.deepEqual(calls, [['diff', '--name-only', '--diff-filter=d', 'origin/develop...HEAD']])
})

test('isInScopePath rejects non-string and empty input instead of throwing', () => {
  assert.equal(isInScopePath(undefined), false)
  assert.equal(isInScopePath(''), false)
  assert.equal(isInScopePath('src/lib/boolean.ts'), true)
})

test('parses the base ref and defaults it', () => {
  assert.deepEqual(parseArgs([]), { base: DEFAULT_BASE_REF })
  assert.deepEqual(parseArgs(['--base', 'origin/main']), { base: 'origin/main' })
})

test('exposes no flag it does not act on', () => {
  assert.deepEqual(Object.keys(parseArgs([])), ['base'])
})

test('the shipped allowlist is explicit about which packages are measured', () => {
  assert.ok(Array.isArray(ALLOWLISTED_PACKAGES))
  assert.ok(ALLOWLISTED_PACKAGES.includes('shared'))
})
