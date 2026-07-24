import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const sourceScript = fileURLToPath(
  new URL('../../agentic/shared/scripts/framework-context.mjs', import.meta.url),
)

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

type FixtureOptions = {
  packageVersion?: string
  sourceKind?: 'src' | 'dist'
  moduleFact?: Record<string, unknown>
}

function createFixture(options: FixtureOptions = {}): string {
  const packageVersion = options.packageVersion ?? '0.6.6'
  const sourceKind = options.sourceKind ?? 'src'
  const root = mkdtempSync(join(tmpdir(), 'om-framework-context-'))
  write(join(root, 'package.json'), JSON.stringify({
    name: 'context-fixture',
    type: 'module',
    dependencies: { '@open-mercato/core': packageVersion },
  }))
  write(
    join(root, 'src', 'modules.ts'),
    `export const enabledModules = [{ id: 'customers', from: '@open-mercato/core' }]\n`,
  )
  write(join(root, 'AGENTS.md'), '# Standalone\n')
  write(join(root, '.ai', 'guides', 'upstream', 'AGENTS.md'), '# Upstream\n')
  write(join(root, '.ai', 'guides', 'upstream', 'BACKWARD_COMPATIBILITY.md'), '# BC\n')
  write(join(root, 'scripts', 'framework-context.mjs'), readFileSync(sourceScript, 'utf8'))

  const packageRoot = join(root, 'node_modules', '@open-mercato', 'core')
  write(join(packageRoot, 'package.json'), JSON.stringify({
    name: '@open-mercato/core',
    version: packageVersion,
    type: 'module',
    exports: { '.': './dist/index.js' },
  }))
  write(join(packageRoot, 'dist', 'index.js'), 'export {}\n')
  write(join(packageRoot, 'AGENTS.md'), '# Core\n')
  const moduleRoot = join(packageRoot, sourceKind, 'modules', 'customers')
  write(join(moduleRoot, 'AGENTS.md'), '# Customers\n')
  write(
    join(moduleRoot, 'data', sourceKind === 'src' ? 'entities.ts' : 'entities.js'),
    'export class Person {}\n',
  )
  if (options.moduleFact) {
    write(
      join(root, '.ai', 'guides', 'module-facts.json'),
      JSON.stringify({ customers: options.moduleFact }),
    )
  }
  return root
}

test('resolves a declared installed module and materializes its exact source and instruction chain', () => {
  const root = createFixture()
  const result = spawnSync(
    process.execPath,
    ['scripts/framework-context.mjs', '--module', 'customers', '--json'],
    { cwd: root, encoding: 'utf8' },
  )
  assert.equal(result.status, 0, result.stderr)
  const parsed = JSON.parse(result.stdout) as {
    package: { name: string; version: string }
    sourceRoot: string
    instructions: Array<{ kind: string; path: string | null }>
    manifest: string
  }
  assert.equal(parsed.package.name, '@open-mercato/core')
  assert.equal(parsed.package.version, '0.6.6')
  assert.match(parsed.sourceRoot, /src\/modules\/customers$/)
  assert.deepEqual(
    parsed.instructions.filter((entry) => entry.path).map((entry) => entry.kind),
    ['standalone-root', 'upstream-bc', 'package', 'module-1', 'upstream-root'],
  )
  assert.equal(existsSync(join(root, parsed.manifest)), true)
  assert.equal(
    existsSync(join(root, '.ai', 'framework-context', 'open-mercato-core@0.6.6', 'source', 'customers', 'data', 'entities.ts')),
    true,
  )
})

test('rejects unsafe module and package tokens', () => {
  const root = createFixture()
  const moduleResult = spawnSync(
    process.execPath,
    ['scripts/framework-context.mjs', '--module', '../../secrets'],
    { cwd: root, encoding: 'utf8' },
  )
  assert.equal(moduleResult.status, 2)
  assert.match(moduleResult.stderr, /invalid module id/)

  const packageResult = spawnSync(
    process.execPath,
    ['scripts/framework-context.mjs', '--package', '@open-mercato/../../secrets'],
    { cwd: root, encoding: 'utf8' },
  )
  assert.equal(packageResult.status, 2)
  assert.match(packageResult.stderr, /invalid package name/)
})

test('recognizes a dist-only module root and reports degraded source context', () => {
  const root = createFixture({ sourceKind: 'dist' })
  const result = spawnSync(
    process.execPath,
    ['scripts/framework-context.mjs', '--module', 'customers', '--json', '--no-materialize'],
    { cwd: root, encoding: 'utf8' },
  )
  assert.equal(result.status, 0, result.stderr)
  const parsed = JSON.parse(result.stdout) as {
    sourceRoot: string
    sourceKind: string
    degraded: boolean
    warnings: string[]
  }
  assert.equal(parsed.sourceRoot.endsWith(join('dist', 'modules', 'customers')), true)
  assert.equal(parsed.sourceKind, 'dist')
  assert.equal(parsed.degraded, true)
  assert.ok(parsed.warnings.some((warning) => warning.includes('limited to dist/types')))
})

test('marks generated facts stale when their source package differs at the same version', () => {
  const root = createFixture({
    moduleFact: {
      coreVersion: '0.6.6',
      sourcePackage: '@open-mercato/not-core',
      sourceVersion: '0.6.6',
    },
  })
  const result = spawnSync(
    process.execPath,
    ['scripts/framework-context.mjs', '--module', 'customers', '--json', '--no-materialize'],
    { cwd: root, encoding: 'utf8' },
  )
  assert.equal(result.status, 0, result.stderr)
  const parsed = JSON.parse(result.stdout) as {
    generatedFacts: { current: boolean; sourcePackage: string; sourceVersion: string }
    warnings: string[]
  }
  assert.deepEqual(parsed.generatedFacts, {
    current: false,
    sourcePackage: '@open-mercato/not-core',
    sourceVersion: '0.6.6',
  })
  assert.ok(parsed.warnings.some((warning) => warning.includes('Generated facts for customers are stale')))
})

test('materializes deterministic search output with one global match cap', () => {
  const root = createFixture()
  const moduleRoot = join(root, 'node_modules', '@open-mercato', 'core', 'src', 'modules', 'customers')
  for (const [name, count] of [['a.ts', 120], ['b.ts', 120], ['c.ts', 120]] as const) {
    write(
      join(moduleRoot, name),
      Array.from({ length: count }, (_, index) => `export const needle_${name[0]}_${index} = 'needle'`).join('\n'),
    )
  }

  const result = spawnSync(
    process.execPath,
    ['scripts/framework-context.mjs', '--module', 'customers', '--query', 'needle', '--json'],
    { cwd: root, encoding: 'utf8' },
  )
  assert.equal(result.status, 0, result.stderr)
  const parsed = JSON.parse(result.stdout) as {
    searchResult: string
    boundedSearch: {
      query: string
      maxMatches: number
      matches: number
      truncated: boolean
      status: string
      result: string
    }
  }
  assert.deepEqual(parsed.boundedSearch, {
    query: 'needle',
    maxMatches: 200,
    matches: 200,
    truncated: true,
    status: 'matched',
    result: parsed.searchResult,
  })
  const lines = readFileSync(join(root, parsed.searchResult), 'utf8').trimEnd().split('\n')
  assert.equal(lines.length, 200)
  assert.equal(lines.some((line) => line.includes(`${join(moduleRoot, 'c.ts')}:`)), false)
})

test('surfaces bounded search query errors with a nonzero status', () => {
  const root = createFixture()
  const result = spawnSync(
    process.execPath,
    ['scripts/framework-context.mjs', '--module', 'customers', '--query', '[', '--json'],
    { cwd: root, encoding: 'utf8' },
  )
  assert.equal(result.status, 2)
  assert.match(result.stderr, /bounded search failed \(exit 2\)/)
})

test('rejects unsafe package versions before materialization without deleting app files', () => {
  const root = createFixture({ packageVersion: '../../../../src' })
  const sentinel = join(root, 'src', 'keep.txt')
  write(sentinel, 'keep me\n')

  const result = spawnSync(
    process.execPath,
    ['scripts/framework-context.mjs', '--module', 'customers', '--json'],
    { cwd: root, encoding: 'utf8' },
  )
  assert.equal(result.status, 2)
  assert.match(result.stderr, /invalid package version/)
  assert.equal(readFileSync(sentinel, 'utf8'), 'keep me\n')
})
