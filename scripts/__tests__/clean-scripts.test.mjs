import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve, sep } from 'node:path'
import { after, describe, it } from 'node:test'
import { cleanGenerated } from '../clean-generated.mjs'
import { cleanPackages } from '../clean-packages.mjs'
import { collectCleanTargets } from '../lib/clean-utils.mjs'

const tempRoots = []

function makeTree(paths) {
  const rootDir = mkdtempSync(join(tmpdir(), 'om-clean-'))
  tempRoots.push(rootDir)
  for (const [path, kind] of Object.entries(paths)) {
    const absolute = join(rootDir, ...path.split('/'))
    if (kind === 'dir') mkdirSync(absolute, { recursive: true })
    else {
      mkdirSync(join(absolute, '..'), { recursive: true })
      writeFileSync(absolute, '')
    }
  }
  return rootDir
}

after(() => {
  for (const rootDir of tempRoots) rmSync(rootDir, { recursive: true, force: true })
})

describe('collectCleanTargets', () => {
  it('matches directories by name without descending into matches or skipped dirs', () => {
    const rootDir = makeTree({
      'packages/core/dist/nested/dist': 'dir',
      'packages/core/node_modules/dep/dist': 'dir',
      '.git/dist': 'dir',
      'apps/mercato/.next': 'dir',
    })
    const { directories } = collectCleanTargets(rootDir, {
      dirNames: ['dist', '.next'],
      skipDirNames: ['node_modules', '.git'],
    })
    const relativePaths = directories.map((path) => relative(rootDir, path).split(sep).join('/'))
    assert.equal(directories.length, 2)
    assert.ok(directories.some((path) => path.endsWith(join('packages', 'core', 'dist'))), 'outer dist matched')
    assert.ok(directories.some((path) => path.endsWith('.next')), '.next matched')
    assert.ok(!directories.some((path) => path.includes('node_modules')), 'node_modules content skipped')
    assert.ok(relativePaths.every((path) => !path.startsWith('.git')), '.git content skipped')
  })

  it('does not follow or match symbolic links', () => {
    const rootDir = makeTree({ 'real/dist/file.txt': 'file', outside: 'dir' })
    const linkType = process.platform === 'win32' ? 'junction' : 'dir'
    symlinkSync(resolve(rootDir, 'real'), join(rootDir, 'outside', 'linked'), linkType)
    const { directories } = collectCleanTargets(rootDir, { dirNames: ['dist'] })
    assert.equal(directories.length, 1)
    assert.ok(directories[0].startsWith(join(rootDir, 'real')), 'only the real dist is matched')
  })
})

describe('clean-generated', () => {
  it('removes generated artifacts but preserves node_modules and sources', () => {
    const rootDir = makeTree({
      'apps/mercato/.mercato/generated/entities.json': 'file',
      'apps/mercato/.next/cache/x': 'file',
      'packages/core/generated/index.ts': 'file',
      'packages/core/dist/index.js': 'file',
      'packages/core/.turbo/turbo.log': 'file',
      'packages/core/src/index.ts': 'file',
      'node_modules/next/dist/index.js': 'file',
      'apps/mercato/src/modules/example/example.generated.ts': 'file',
    })
    cleanGenerated(rootDir, () => {})

    assert.ok(!existsSync(join(rootDir, 'apps', 'mercato', '.mercato')))
    assert.ok(!existsSync(join(rootDir, 'apps', 'mercato', '.next')))
    assert.ok(!existsSync(join(rootDir, 'packages', 'core', 'generated')))
    assert.ok(!existsSync(join(rootDir, 'packages', 'core', 'dist')))
    assert.ok(!existsSync(join(rootDir, 'packages', 'core', '.turbo')))
    assert.ok(existsSync(join(rootDir, 'packages', 'core', 'src', 'index.ts')), 'sources preserved')
    assert.ok(existsSync(join(rootDir, 'node_modules', 'next', 'dist', 'index.js')), 'node_modules preserved')
    assert.ok(
      existsSync(join(rootDir, 'apps', 'mercato', 'src', 'modules', 'example', 'example.generated.ts')),
      'committed *.generated.ts registries preserved',
    )
  })
})

describe('clean-packages', () => {
  it('removes node_modules, dist, tsbuildinfo, and yarn caches', () => {
    const rootDir = makeTree({
      'node_modules/next/index.js': 'file',
      'packages/core/node_modules/dep/index.js': 'file',
      'packages/core/dist/index.js': 'file',
      'packages/core/tsconfig.tsbuildinfo': 'file',
      'packages/core/src/index.ts': 'file',
      '.yarn/cache/dep.zip': 'file',
      '.yarn/install-state.gz': 'file',
      '.yarn/releases/keep.cjs': 'file',
    })
    cleanPackages(rootDir, () => {})

    assert.ok(!existsSync(join(rootDir, 'node_modules')))
    assert.ok(!existsSync(join(rootDir, 'packages', 'core', 'node_modules')))
    assert.ok(!existsSync(join(rootDir, 'packages', 'core', 'dist')))
    assert.ok(!existsSync(join(rootDir, 'packages', 'core', 'tsconfig.tsbuildinfo')))
    assert.ok(!existsSync(join(rootDir, '.yarn', 'cache')))
    assert.ok(!existsSync(join(rootDir, '.yarn', 'install-state.gz')))
    assert.ok(existsSync(join(rootDir, 'packages', 'core', 'src', 'index.ts')), 'sources preserved')
    assert.ok(existsSync(join(rootDir, '.yarn', 'releases', 'keep.cjs')), 'yarn releases preserved')
  })
})
