import assert from 'node:assert/strict'
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
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

function installPackage(
  root: string,
  packageName: string,
  version: string,
  options: { under?: string; modules?: string[] } = {},
): string {
  const packageRoot = join(
    root,
    'node_modules',
    ...(options.under ? [options.under, 'node_modules'] : []),
    ...packageName.split('/'),
  )
  write(join(packageRoot, 'package.json'), JSON.stringify({
    name: packageName,
    version,
    type: 'module',
    exports: { '.': './dist/index.js' },
  }))
  write(join(packageRoot, 'dist', 'index.js'), 'export {}\n')
  write(join(packageRoot, 'AGENTS.md'), `# ${packageName}\n`)
  for (const moduleId of options.modules ?? []) {
    write(join(packageRoot, 'src', 'modules', moduleId, 'AGENTS.md'), `# ${moduleId}\n`)
    write(join(packageRoot, 'src', 'modules', moduleId, 'index.ts'), `export const id = '${moduleId}'\n`)
  }
  return packageRoot
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
  assert.match(parsed.sourceRoot.replace(/\\/g, '/'), /src\/modules\/customers$/)
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

test('materializes only regular UTF-8 source text and omits credentials, keys, binaries, and symlinks', { skip: process.platform === 'win32' }, () => {
  const root = createFixture()
  const outside = realpathSync(mkdtempSync(join(tmpdir(), 'om-framework-context-secret-')))
  const moduleRoot = join(root, 'node_modules', '@open-mercato', 'core', 'src', 'modules', 'customers')
  const materializedRoot = join(root, '.ai', 'framework-context', 'open-mercato-core@0.6.6', 'source', 'customers')
  write(join(moduleRoot, 'safe.ts'), 'export const safe = true\n')
  write(join(moduleRoot, '.env.local'), 'API_KEY=must-not-be-materialized\n')
  write(join(moduleRoot, 'credentials.json'), JSON.stringify({ token: 'must-not-be-materialized' }))
  write(join(moduleRoot, 'private.pem'), '-----BEGIN PRIVATE KEY-----\nmust-not-be-materialized\n')
  write(join(moduleRoot, 'private-key.ts'), "export const key = '-----BEGIN RSA PRIVATE KEY-----'\n")
  write(join(moduleRoot, '.ssh', 'id_rsa'), 'must-not-be-materialized\n')
  writeFileSync(join(moduleRoot, 'binary.ts'), Buffer.from([0x65, 0x78, 0x00, 0x70]))
  const outsideSource = join(outside, 'outside.ts')
  write(outsideSource, 'export const outside = true\n')
  symlinkSync(outsideSource, join(moduleRoot, 'linked.ts'), 'file')

  try {
    const result = spawnSync(
      process.execPath,
      ['scripts/framework-context.mjs', '--module', 'customers', '--json'],
      { cwd: root, encoding: 'utf8' },
    )
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    const parsed = JSON.parse(result.stdout) as { warnings: string[] }
    assert.equal(readFileSync(join(materializedRoot, 'safe.ts'), 'utf8'), 'export const safe = true\n')
    for (const denied of [
      '.env.local',
      'credentials.json',
      'private.pem',
      'private-key.ts',
      join('.ssh', 'id_rsa'),
      'binary.ts',
      'linked.ts',
    ]) assert.equal(existsSync(join(materializedRoot, denied)), false, denied)
    assert.ok(parsed.warnings.some((warning) => /Materialized source omitted \d+ credential, key, symbolic, binary, or unsupported/.test(warning)))
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  }
})

for (const withoutRipgrep of [false, true]) {
  test(`bounded search excludes filtered credentials and keys${withoutRipgrep ? ' without ripgrep' : ''}`, () => {
    const root = createFixture()
    const moduleRoot = join(root, 'node_modules', '@open-mercato', 'core', 'src', 'modules', 'customers')
    write(join(moduleRoot, 'safe.ts'), "export const safe = 'search-secret-probe-safe'\n")
    write(join(moduleRoot, '.env.local'), 'API_KEY=search-secret-probe-env\n')
    write(join(moduleRoot, 'credentials.json'), JSON.stringify({ token: 'search-secret-probe-credentials' }))
    write(join(moduleRoot, 'private.pem'), '-----BEGIN PRIVATE KEY-----\nsearch-secret-probe-key\n')

    try {
      const result = spawnSync(
        process.execPath,
        ['scripts/framework-context.mjs', '--module', 'customers', '--query', 'search-secret-probe', '--json'],
        {
          cwd: root,
          encoding: 'utf8',
          env: withoutRipgrep ? { ...process.env, PATH: '', Path: '' } : process.env,
        },
      )
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
      const parsed = JSON.parse(result.stdout) as { searchResult: string; boundedSearch: { matches: number } }
      const search = readFileSync(join(root, parsed.searchResult), 'utf8')
      assert.equal(parsed.boundedSearch.matches, 1)
      assert.match(search, /safe\.ts:1:export const safe = 'search-secret-probe-safe'/)
      assert.doesNotMatch(search, /search-secret-probe-(?:env|credentials|key)/)
      assert.doesNotMatch(search, /(?:\.env\.local|credentials\.json|private\.pem)/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
}

test('fails closed when one regular text source file exceeds the materialization byte ceiling', () => {
  const root = createFixture()
  const moduleRoot = join(root, 'node_modules', '@open-mercato', 'core', 'src', 'modules', 'customers')
  writeFileSync(join(moduleRoot, 'oversized.ts'), Buffer.alloc((8 * 1024 * 1024) + 1, 0x61))
  try {
    const result = spawnSync(
      process.execPath,
      ['scripts/framework-context.mjs', '--module', 'customers', '--json'],
      { cwd: root, encoding: 'utf8' },
    )
    assert.equal(result.status, 2, `${result.stdout}\n${result.stderr}`)
    assert.match(result.stderr, /context source file exceeds 8388608 byte limit: .*oversized\.ts/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('fails closed when a source tree exceeds the materialization entry ceiling', { skip: process.platform === 'win32' }, () => {
  const root = createFixture()
  const moduleRoot = join(root, 'node_modules', '@open-mercato', 'core', 'src', 'modules', 'customers')
  for (let index = 0; index < 10_001; index += 1) {
    symlinkSync('missing.ts', join(moduleRoot, `linked-${String(index).padStart(5, '0')}.ts`), 'file')
  }
  try {
    const result = spawnSync(
      process.execPath,
      ['scripts/framework-context.mjs', '--module', 'customers', '--json'],
      { cwd: root, encoding: 'utf8' },
    )
    assert.equal(result.status, 2, `${result.stdout}\n${result.stderr}`)
    assert.match(result.stderr, /context source exceeded 10000 filesystem entries/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('reports a deterministic mixed-version cohort without combining package context', () => {
  const root = createFixture()
  write(join(root, 'package.json'), JSON.stringify({
    name: 'context-fixture',
    type: 'module',
    dependencies: {
      '@open-mercato/core': '0.6.6',
      '@open-mercato/shared': '0.6.5',
    },
  }))
  write(
    join(root, 'src', 'modules.ts'),
    `export const enabledModules = [
  { id: 'customers', from: '@open-mercato/core' },
  { id: 'shared_fixture', from: '@open-mercato/shared' },
]\n`,
  )
  installPackage(root, '@open-mercato/shared', '0.6.5', { modules: ['shared_fixture'] })

  const result = spawnSync(
    process.execPath,
    ['scripts/framework-context.mjs', '--module', 'customers', '--json', '--no-materialize'],
    { cwd: root, encoding: 'utf8' },
  )
  assert.equal(result.status, 0, result.stderr)
  const parsed = JSON.parse(result.stdout) as {
    package: { name: string; version: string }
    installedPackages: { cohort: Array<{ name: string; version: string }>; duplicates: unknown[] }
    warnings: string[]
  }
  assert.deepEqual(
    parsed.installedPackages.cohort.map(({ name, version }) => ({ name, version })),
    [
      { name: '@open-mercato/core', version: '0.6.6' },
      { name: '@open-mercato/shared', version: '0.6.5' },
    ],
  )
  assert.deepEqual(parsed.installedPackages.duplicates, [])
  assert.equal(parsed.package.version, '0.6.6')
  assert.ok(parsed.warnings.some((warning) => warning.includes(
    'Installed Open Mercato package cohort uses mixed versions: @open-mercato/core@0.6.6',
  )))
  assert.ok(parsed.warnings.some((warning) => warning.includes('Context remains package-specific')))
})

test('reports nested duplicate package installs while keeping app-root resolution exact and read-only', () => {
  const root = createFixture()
  const nestedRoot = installPackage(root, '@open-mercato/core', '0.6.5', {
    under: 'nested-dependency',
    modules: ['customers'],
  })
  const sentinel = join(nestedRoot, 'src', 'modules', 'customers', 'sentinel.ts')
  write(sentinel, 'export const untouched = true\n')

  const result = spawnSync(
    process.execPath,
    ['scripts/framework-context.mjs', '--module', 'customers', '--json', '--no-materialize'],
    { cwd: root, encoding: 'utf8' },
  )
  assert.equal(result.status, 0, result.stderr)
  const parsed = JSON.parse(result.stdout) as {
    package: { version: string; root: string }
    sourceRoot: string
    installedPackages: {
      duplicates: Array<{ name: string; installations: Array<{ version: string; root: string }> }>
    }
    warnings: string[]
  }
  assert.equal(parsed.package.version, '0.6.6')
  assert.equal(parsed.package.root, realpathSync(join(root, 'node_modules', '@open-mercato', 'core')))
  assert.equal(parsed.sourceRoot.startsWith(parsed.package.root), true)
  assert.deepEqual(
    parsed.installedPackages.duplicates.map((duplicate) => ({
      name: duplicate.name,
      versions: duplicate.installations.map((entry) => entry.version),
    })),
    [{ name: '@open-mercato/core', versions: ['0.6.5', '0.6.6'] }],
  )
  assert.ok(parsed.warnings.some((warning) => warning.includes('Multiple installed copies of @open-mercato/core were found')))
  assert.ok(parsed.warnings.some((warning) => warning.includes('App resolution selected @open-mercato/core@0.6.6')))
  assert.equal(readFileSync(sentinel, 'utf8'), 'export const untouched = true\n')
  assert.equal(existsSync(join(root, '.ai', 'framework-context')), false)
})

test('installed package scans do not split newline-bearing manifest paths into outside operands', { skip: process.platform === 'win32' }, () => {
  const originalRoot = createFixture()
  const maliciousParent = realpathSync(mkdtempSync(join(tmpdir(), 'om-framework-context-manifest-path-')))
  const outside = realpathSync(mkdtempSync(join(tmpdir(), 'om-framework-context-manifest-outside-')))
  const root = join(maliciousParent, `app\n${outside}`)
  mkdirSync(dirname(root), { recursive: true })
  renameSync(originalRoot, root)
  write(
    join(outside, 'node_modules', '@open-mercato', 'core', 'package.json'),
    JSON.stringify({
      name: '@open-mercato/core',
      version: '9.9.9-outside',
      type: 'module',
    }),
  )

  try {
    const result = spawnSync(
      process.execPath,
      ['scripts/framework-context.mjs', '--module', 'customers', '--json', '--no-materialize'],
      { cwd: root, encoding: 'utf8' },
    )
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    const parsed = JSON.parse(result.stdout) as {
      installedPackages: {
        cohort: Array<{ name: string; version: string }>
        duplicates: Array<{ name: string; installations: Array<{ version: string }> }>
      }
    }
    assert.deepEqual(
      parsed.installedPackages.cohort.map(({ name, version }) => ({ name, version })),
      [{ name: '@open-mercato/core', version: '0.6.6' }],
    )
    assert.deepEqual(parsed.installedPackages.duplicates, [])
    assert.doesNotMatch(result.stdout, /9\.9\.9-outside/)
  } finally {
    rmSync(maliciousParent, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  }
})

test('fails closed for duplicate or ambiguous module declarations', () => {
  const duplicateRoot = createFixture()
  write(
    join(duplicateRoot, 'src', 'modules.ts'),
    `export const enabledModules = [
  { id: 'customers', from: '@open-mercato/core' },
  { id: 'customers', from: '@open-mercato/core' },
]\n`,
  )
  const duplicate = spawnSync(
    process.execPath,
    ['scripts/framework-context.mjs', '--module', 'customers', '--json', '--no-materialize'],
    { cwd: duplicateRoot, encoding: 'utf8' },
  )
  assert.equal(duplicate.status, 2)
  assert.match(duplicate.stderr, /module customers is declared 2 times for @open-mercato\/core/)

  const ambiguousRoot = createFixture()
  write(
    join(ambiguousRoot, 'src', 'modules.ts'),
    `export const enabledModules = [
  { id: 'customers', from: '@open-mercato/core' },
  { id: 'customers', from: '@open-mercato/shared' },
]\n`,
  )
  const ambiguous = spawnSync(
    process.execPath,
    ['scripts/framework-context.mjs', '--module', 'customers', '--json', '--no-materialize'],
    { cwd: ambiguousRoot, encoding: 'utf8' },
  )
  assert.equal(ambiguous.status, 2)
  assert.match(
    ambiguous.stderr,
    /module customers is ambiguous; pass --package \(@open-mercato\/core, @open-mercato\/shared\)/,
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
  const staleWarning = parsed.warnings.find((warning) => warning.includes('Generated facts for customers are stale'))
  assert.match(staleWarning ?? '', /yarn generate, then yarn mercato agentic:init --update-harness/)
  assert.doesNotMatch(staleWarning ?? '', /until yarn generate(?:\W|$)/)
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

test('never treats newline-bearing source paths as additional search operands', { skip: process.platform === 'win32' }, () => {
  const root = createFixture()
  const outside = realpathSync(mkdtempSync(join(tmpdir(), 'om-framework-context-newline-')))
  const outsideFile = join(outside, 'outside.ts')
  const moduleRoot = join(root, 'node_modules', '@open-mercato', 'core', 'src', 'modules', 'customers')
  const prefix = join(moduleRoot, 'newline-prefix')
  write(prefix, 'export const harmlessPrefix = true\n')
  write(outsideFile, "export const outsideLeak = 'newline-boundary-probe'\n")
  write(
    `${prefix}\n${outsideFile}`,
    "export const insideMatch = 'newline-boundary-probe'\n",
  )

  try {
    const result = spawnSync(
      process.execPath,
      ['scripts/framework-context.mjs', '--module', 'customers', '--query', 'newline-boundary-probe', '--json'],
      { cwd: root, encoding: 'utf8' },
    )
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    const parsed = JSON.parse(result.stdout) as {
      searchResult: string
      boundedSearch: { matches: number }
    }
    const search = readFileSync(join(root, parsed.searchResult), 'utf8')
    assert.ok(parsed.boundedSearch.matches >= 1)
    assert.match(search, /insideMatch/)
    assert.doesNotMatch(search, /outsideLeak/)
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  }
})

test('accepts contained package files through a symlinked node_modules root', { skip: process.platform === 'win32' }, () => {
  const root = createFixture()
  const controller = realpathSync(mkdtempSync(join(tmpdir(), 'om-framework-context-controller-')))
  const controllerNodeModules = join(controller, 'node_modules')
  renameSync(join(root, 'node_modules'), controllerNodeModules)
  symlinkSync(controllerNodeModules, join(root, 'node_modules'), 'dir')

  try {
    const result = spawnSync(
      process.execPath,
      ['scripts/framework-context.mjs', '--module', 'customers', '--query', 'Person', '--json'],
      { cwd: root, encoding: 'utf8' },
    )
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    const parsed = JSON.parse(result.stdout) as {
      searchResult: string
      boundedSearch: { matches: number }
    }
    assert.ok(parsed.boundedSearch.matches >= 1)
    assert.match(readFileSync(join(root, parsed.searchResult), 'utf8'), /export class Person/)
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(controller, { recursive: true, force: true })
  }
})

test('accepts contained package files through a symlinked node_modules root without ripgrep', { skip: process.platform === 'win32' }, () => {
  const root = createFixture()
  const controller = realpathSync(mkdtempSync(join(tmpdir(), 'om-framework-context-controller-')))
  const controllerNodeModules = join(controller, 'node_modules')
  renameSync(join(root, 'node_modules'), controllerNodeModules)
  symlinkSync(controllerNodeModules, join(root, 'node_modules'), 'dir')

  try {
    const result = spawnSync(
      process.execPath,
      ['scripts/framework-context.mjs', '--module', 'customers', '--query', 'Person', '--json'],
      {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, PATH: '', Path: '' },
      },
    )
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
    const parsed = JSON.parse(result.stdout) as {
      searchResult: string
      boundedSearch: { matches: number }
    }
    assert.ok(parsed.boundedSearch.matches >= 1)
    assert.match(readFileSync(join(root, parsed.searchResult), 'utf8'), /export class Person/)
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(controller, { recursive: true, force: true })
  }
})

test('uses bounded filesystem fallbacks when ripgrep is not installed', () => {
  const root = createFixture()
  installPackage(root, '@open-mercato/core', '0.6.5', {
    under: 'nested-dependency',
    modules: ['customers'],
  })
  const result = spawnSync(
    process.execPath,
    ['scripts/framework-context.mjs', '--module', 'customers', '--query', 'Person', '--json'],
    {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, PATH: '', Path: '' },
    },
  )
  assert.equal(result.status, 0, result.stderr)
  const parsed = JSON.parse(result.stdout) as {
    searchResult: string
    installedPackages: {
      cohort: Array<{ name: string; version: string }>
      duplicates: Array<{ name: string; installations: Array<{ version: string }> }>
    }
    boundedSearch: { status: string; matches: number; truncated: boolean }
  }
  assert.deepEqual(parsed.installedPackages.cohort.map(({ name, version }) => ({ name, version })), [
    { name: '@open-mercato/core', version: '0.6.6' },
  ])
  assert.deepEqual(parsed.installedPackages.duplicates.map((duplicate) => ({
    name: duplicate.name,
    versions: duplicate.installations.map(({ version }) => version),
  })), [{ name: '@open-mercato/core', versions: ['0.6.5', '0.6.6'] }])
  assert.deepEqual(parsed.boundedSearch, {
    query: 'Person',
    maxMatches: 200,
    matches: 1,
    truncated: false,
    status: 'matched',
    result: parsed.searchResult,
  })
  assert.match(readFileSync(join(root, parsed.searchResult), 'utf8'), /entities\.ts:1:export class Person/)
})

for (const withoutRipgrep of [false, true]) {
  test(`treats search queries as literal text${withoutRipgrep ? ' without ripgrep' : ''}`, () => {
    const root = createFixture()
    const moduleRoot = join(root, 'node_modules', '@open-mercato', 'core', 'src', 'modules', 'customers')
    write(join(moduleRoot, 'literal.ts'), "export const literal = '[literal-query]'\n")

    try {
      const result = spawnSync(
        process.execPath,
        ['scripts/framework-context.mjs', '--module', 'customers', '--query', '[literal-query]', '--json'],
        {
          cwd: root,
          encoding: 'utf8',
          env: withoutRipgrep ? { ...process.env, PATH: '', Path: '' } : process.env,
        },
      )
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
      const parsed = JSON.parse(result.stdout) as { searchResult: string; boundedSearch: { matches: number } }
      assert.equal(parsed.boundedSearch.matches, 1)
      assert.match(readFileSync(join(root, parsed.searchResult), 'utf8'), /literal\.ts:1:export const literal/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
}

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

test('rejects symlinked framework-context ancestors without mutating their targets', () => {
  const linkType = process.platform === 'win32' ? 'junction' : 'dir'
  for (const linkedRelative of ['.ai', '.ai/framework-context']) {
    const root = createFixture()
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'om-framework-context-outside-')))
    const sentinel = join(outside, 'sentinel.txt')
    write(sentinel, 'untouched\n')
    try {
      const linkedPath = join(root, linkedRelative)
      rmSync(linkedPath, { recursive: true, force: true })
      mkdirSync(dirname(linkedPath), { recursive: true })
      symlinkSync(outside, linkedPath, linkType)

      const result = spawnSync(
        process.execPath,
        ['scripts/framework-context.mjs', '--module', 'customers', '--json'],
        { cwd: root, encoding: 'utf8' },
      )
      assert.equal(result.status, 2, `${result.stdout}\n${result.stderr}`)
      assert.match(result.stderr, /must not be a symbolic link/)
      assert.equal(readFileSync(sentinel, 'utf8'), 'untouched\n')
      assert.equal(existsSync(join(outside, 'open-mercato-core@0.6.6')), false)
    } finally {
      rmSync(root, { recursive: true, force: true })
      rmSync(outside, { recursive: true, force: true })
    }
  }
})

test('rejects a symlinked package output before recursive cleanup and preserves outside data', () => {
  const root = createFixture()
  const outside = realpathSync(mkdtempSync(join(tmpdir(), 'om-framework-context-outside-')))
  const sentinel = join(outside, 'sentinel.txt')
  const contextRoot = join(root, '.ai', 'framework-context')
  const outputRoot = join(contextRoot, 'open-mercato-core@0.6.6')
  write(sentinel, 'untouched\n')
  mkdirSync(contextRoot, { recursive: true })
  symlinkSync(outside, outputRoot, process.platform === 'win32' ? 'junction' : 'dir')
  try {
    const result = spawnSync(
      process.execPath,
      ['scripts/framework-context.mjs', '--module', 'customers', '--json'],
      { cwd: root, encoding: 'utf8' },
    )
    assert.equal(result.status, 2, `${result.stdout}\n${result.stderr}`)
    assert.match(result.stderr, /context output must not be a symbolic link/)
    assert.equal(readFileSync(sentinel, 'utf8'), 'untouched\n')
    assert.equal(existsSync(join(outside, 'manifest.json')), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(outside, { recursive: true, force: true })
  }
})
