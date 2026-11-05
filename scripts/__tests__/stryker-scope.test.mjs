import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ALLOWLISTED_PACKAGES,
  DEFAULT_BASE_REF,
  DEFAULT_MAX_FILES,
  computeScope,
  explicitChangedFiles,
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
  assert.deepEqual(parseArgs([]), { base: DEFAULT_BASE_REF, package: null, mutate: null })
  assert.deepEqual(parseArgs(['--base', 'origin/main']), {
    base: 'origin/main',
    package: null,
    mutate: null,
  })
})

test('exposes no flag it does not act on', () => {
  assert.deepEqual(Object.keys(parseArgs([])), ['base', 'package', 'mutate'])
})

test('the shipped allowlist is explicit about which packages are measured', () => {
  assert.ok(Array.isArray(ALLOWLISTED_PACKAGES))
  assert.ok(ALLOWLISTED_PACKAGES.includes('shared'))
})

test('drops a changed path carrying shell metacharacters before it can reach the matrix', () => {
  const { matrix } = computeScope([
    'packages/shared/src/lib/pwn$(id > /tmp/om-pwn.txt).ts',
    'packages/shared/src/lib/boolean.ts',
  ])

  assert.deepEqual(matrix.include, [{ package: 'shared', mutate: 'src/lib/boolean.ts' }])
})

test('rejects every shell metacharacter class in a source path', () => {
  const hostileNames = [
    'pwn$(id).ts',
    'pwn`id`.ts',
    'pwn;id.ts',
    'pwn|id.ts',
    'pwn&id.ts',
    'pwn>out.ts',
    'pwn<in.ts',
    "pwn'quote.ts",
    'pwn"quote.ts',
    'pwn id.ts',
    'pwn\tid.ts',
    'pwn\nid.ts',
    'pwn*glob.ts',
    'pwn?glob.ts',
    'pwn{brace}.ts',
    'pwn\\escape.ts',
    'pwn!bang.ts',
    'pwn#hash.ts',
    'pwn~tilde.ts',
  ]

  for (const name of hostileNames) {
    assert.equal(
      isInScopePath(`src/lib/${name}`),
      false,
      `expected src/lib/${name} to be rejected as an unsafe path`,
    )
    assert.deepEqual(
      computeScope([`packages/shared/src/lib/${name}`]).matrix.include,
      [],
      `expected packages/shared/src/lib/${name} to produce an empty matrix`,
    )
  }
})

test('still accepts the square brackets of Next.js dynamic route segments', () => {
  assert.equal(isInScopePath('src/modules/auth/backend/roles/[id]/edit/page.meta.ts'), true)
})

test('a manual dispatch selection is filtered by the same scope rules as a diff', () => {
  const changed = explicitChangedFiles('shared', 'src/lib/boolean.ts, src/lib/number.ts')

  assert.deepEqual(changed, [
    'packages/shared/src/lib/boolean.ts',
    'packages/shared/src/lib/number.ts',
  ])
  assert.deepEqual(computeScope(changed).matrix.include, [
    { package: 'shared', mutate: 'src/lib/boolean.ts,src/lib/number.ts' },
  ])
})

test('a manual dispatch cannot mutate a non-allowlisted package or an out-of-scope file', () => {
  assert.deepEqual(
    computeScope(explicitChangedFiles('core', 'src/lib/thing.ts')).matrix.include,
    [],
  )
  assert.deepEqual(
    computeScope(explicitChangedFiles('shared', 'src/lib/thing.test.ts')).matrix.include,
    [],
  )
  assert.deepEqual(
    computeScope(explicitChangedFiles('shared', 'src/lib/pwn$(id).ts')).matrix.include,
    [],
  )
})

test('an empty dispatch selection yields no work rather than mutating everything', () => {
  assert.deepEqual(explicitChangedFiles('shared', ''), [])
  assert.deepEqual(explicitChangedFiles('', 'src/lib/boolean.ts'), [])
})

test('parseArgs reads the dispatch package and mutate selection', () => {
  const args = parseArgs(['--package', 'shared', '--mutate', 'src/lib/boolean.ts'])

  assert.equal(args.package, 'shared')
  assert.equal(args.mutate, 'src/lib/boolean.ts')
})

test('parseArgs leaves the dispatch selection null for a plain diff run', () => {
  const args = parseArgs(['--base', 'origin/main'])

  assert.equal(args.base, 'origin/main')
  assert.equal(args.package, null)
  assert.equal(args.mutate, null)
})
