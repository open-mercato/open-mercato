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

function createFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'om-framework-context-'))
  write(join(root, 'package.json'), JSON.stringify({
    name: 'context-fixture',
    type: 'module',
    dependencies: { '@open-mercato/core': '0.6.6' },
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
    version: '0.6.6',
    type: 'module',
    exports: { '.': './dist/index.js' },
  }))
  write(join(packageRoot, 'dist', 'index.js'), 'export {}\n')
  write(join(packageRoot, 'AGENTS.md'), '# Core\n')
  write(join(packageRoot, 'src', 'modules', 'customers', 'AGENTS.md'), '# Customers\n')
  write(join(packageRoot, 'src', 'modules', 'customers', 'data', 'entities.ts'), 'export class Person {}\n')
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
