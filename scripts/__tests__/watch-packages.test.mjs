import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  discoverAppGeneratedDirs,
  discoverWorkspacePackages,
  isWatchedSourceFile,
  runConsolidatedWatch,
  touchGeneratedBarrels,
} from '../watch-packages.mjs'

function makePackage(rootDir, parentSubdir, pkgName, options = {}) {
  const pkgDir = path.join(rootDir, parentSubdir, pkgName)
  fs.mkdirSync(path.join(pkgDir, 'src'), { recursive: true })
  fs.writeFileSync(
    path.join(pkgDir, 'package.json'),
    JSON.stringify({
      name: `@workspace/${pkgName}`,
      version: '0.0.0',
      ...(options.skipWatchScript ? {} : { scripts: { watch: 'node watch.mjs' } }),
      ...options.pkgExtra,
    }),
  )
  if (options.entryFile) {
    fs.writeFileSync(path.join(pkgDir, 'src', options.entryFile), '')
  }
  return pkgDir
}

test('isWatchedSourceFile accepts source files that affect runtime output but rejects tests and unrelated files', () => {
  assert.equal(isWatchedSourceFile('index.ts'), true)
  assert.equal(isWatchedSourceFile('lib/foo.tsx'), true)
  assert.equal(isWatchedSourceFile('modules/customers/i18n/en.json'), true)
  assert.equal(isWatchedSourceFile('lib/__tests__/foo.ts'), false)
  assert.equal(isWatchedSourceFile('lib/foo.test.ts'), false)
  assert.equal(isWatchedSourceFile('lib/foo.test.tsx'), false)
  assert.equal(isWatchedSourceFile('lib/foo.js'), false)
  assert.equal(isWatchedSourceFile('README.md'), false)
  assert.equal(isWatchedSourceFile(''), false)
  assert.equal(isWatchedSourceFile(null), false)
})

test('discoverAppGeneratedDirs finds app generated directories and touchGeneratedBarrels bumps generated files', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'watch-packages-generated-'))
  try {
    const generatedDir = path.join(root, 'apps/mercato/.mercato/generated')
    fs.mkdirSync(generatedDir, { recursive: true })
    const generatedFile = path.join(generatedDir, 'backend-routes.generated.ts')
    const checksumFile = path.join(generatedDir, 'backend-routes.generated.checksum')
    const ignoredFile = path.join(generatedDir, 'plain.txt')
    fs.writeFileSync(generatedFile, 'export const routes = []\n')
    fs.writeFileSync(checksumFile, 'abc\n')
    fs.writeFileSync(ignoredFile, 'ignore\n')

    const oldTime = new Date('2020-01-01T00:00:00Z')
    fs.utimesSync(generatedFile, oldTime, oldTime)
    fs.utimesSync(checksumFile, oldTime, oldTime)
    fs.utimesSync(ignoredFile, oldTime, oldTime)

    const dirs = discoverAppGeneratedDirs(root)
    assert.deepEqual(dirs, [generatedDir])

    const touched = touchGeneratedBarrels(dirs, { log: () => {} })
    assert.equal(touched, 2)
    assert.ok(fs.statSync(generatedFile).mtimeMs > oldTime.getTime())
    assert.ok(fs.statSync(checksumFile).mtimeMs > oldTime.getTime())
    assert.equal(fs.statSync(ignoredFile).mtimeMs, oldTime.getTime())
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('discoverWorkspacePackages finds packages/* and external/official-modules/packages/*', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'watch-packages-discover-'))
  try {
    makePackage(root, 'packages', 'alpha')
    makePackage(root, 'packages', 'bravo')
    makePackage(root, 'external/official-modules/packages', 'charlie')

    const result = discoverWorkspacePackages(root)
    const labels = result.map((p) => p.shortLabel)
    assert.deepEqual(labels, ['alpha', 'bravo', 'charlie'])
    assert.equal(result[0].name, '@workspace/alpha')
    assert.equal(result[2].packageDir, path.join(root, 'external/official-modules/packages', 'charlie'))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('discoverWorkspacePackages skips packages without a watch script', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'watch-packages-no-watch-'))
  try {
    makePackage(root, 'packages', 'alpha')
    makePackage(root, 'packages', 'no-watch', { skipWatchScript: true })

    const labels = discoverWorkspacePackages(root).map((p) => p.shortLabel)
    assert.deepEqual(labels, ['alpha'])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('discoverWorkspacePackages skips packages without a src/ directory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'watch-packages-no-src-'))
  try {
    makePackage(root, 'packages', 'alpha')
    const noSrcDir = path.join(root, 'packages', 'tools-only')
    fs.mkdirSync(noSrcDir, { recursive: true })
    fs.writeFileSync(
      path.join(noSrcDir, 'package.json'),
      JSON.stringify({ name: '@workspace/tools-only', scripts: { watch: 'node watch.mjs' } }),
    )

    const labels = discoverWorkspacePackages(root).map((p) => p.shortLabel)
    assert.deepEqual(labels, ['alpha'])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('discoverWorkspacePackages tolerates a missing external/official-modules/packages tree', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'watch-packages-no-external-'))
  try {
    makePackage(root, 'packages', 'alpha')
    const result = discoverWorkspacePackages(root)
    assert.equal(result.length, 1)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('runConsolidatedWatch wires one fs.watch per discovered package and triggers a build on change', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'watch-packages-run-'))
  try {
    makePackage(root, 'packages', 'alpha', { entryFile: 'index.ts' })
    makePackage(root, 'packages', 'bravo', { entryFile: 'index.ts' })

    const logs = []
    const log = (line) => logs.push(String(line))

    const buildCalls = []
    let resolveSecondBuild
    const secondBuildSeen = new Promise((resolve) => {
      resolveSecondBuild = resolve
    })
    const build = async (options) => {
      buildCalls.push({
        cwd: options.absWorkingDir,
        entryCount: options.entryPoints.length,
      })
      if (buildCalls.length === 2) resolveSecondBuild()
    }

    const controller = new AbortController()
    const { packages } = await runConsolidatedWatch({
      root,
      log,
      build,
      signal: controller.signal,
    })

    assert.equal(packages.length, 2)
    assert.ok(
      logs.some((line) =>
        line.includes('consolidated watcher: tracking 2 packages'),
      ),
      `expected tracking summary, got: ${logs.join('\n')}`,
    )

    // Trigger a rebuild on each package by writing a new entry file.
    // fs.watch with recursive: true is best-effort on some kernels — give
    // each watcher one retry if the first write does not surface within the
    // debounce window.
    for (let attempt = 0; attempt < 5 && buildCalls.length < 2; attempt += 1) {
      fs.writeFileSync(path.join(root, 'packages/alpha/src', `change-${attempt}.ts`), '')
      fs.writeFileSync(path.join(root, 'packages/bravo/src', `change-${attempt}.ts`), '')
      await Promise.race([
        secondBuildSeen,
        new Promise((resolve) => setTimeout(resolve, 600)),
      ])
    }

    controller.abort()

    assert.ok(
      buildCalls.length >= 2,
      `expected at least 2 builds; saw ${buildCalls.length}: ${JSON.stringify(buildCalls)}`,
    )
    const builtPackages = new Set(buildCalls.map((c) => path.basename(c.cwd)))
    assert.ok(builtPackages.has('alpha'))
    assert.ok(builtPackages.has('bravo'))
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('runConsolidatedWatch touches app generated barrels after package rebuild', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'watch-packages-touch-'))
  try {
    makePackage(root, 'packages', 'alpha', { entryFile: 'index.ts' })
    const generatedDir = path.join(root, 'apps/mercato/.mercato/generated')
    fs.mkdirSync(generatedDir, { recursive: true })
    const generatedFile = path.join(generatedDir, 'backend-routes.generated.ts')
    fs.writeFileSync(generatedFile, 'export const routes = []\n')
    const oldTime = new Date('2020-01-01T00:00:00Z')
    fs.utimesSync(generatedFile, oldTime, oldTime)

    const controller = new AbortController()
    await runConsolidatedWatch({
      root,
      log: () => {},
      build: async () => {},
      signal: controller.signal,
    })

    for (let attempt = 0; attempt < 5 && fs.statSync(generatedFile).mtimeMs === oldTime.getTime(); attempt += 1) {
      fs.writeFileSync(path.join(root, 'packages/alpha/src', `change-${attempt}.json`), '{}\n')
      await new Promise((resolve) => setTimeout(resolve, 600))
    }

    controller.abort()
    assert.ok(fs.statSync(generatedFile).mtimeMs > oldTime.getTime())
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('runConsolidatedWatch honors OM_WATCH_SCOPE=env and tracks only the listed packages', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'watch-packages-scope-env-'))
  try {
    makePackage(root, 'packages', 'alpha', { entryFile: 'index.ts' })
    makePackage(root, 'packages', 'bravo', { entryFile: 'index.ts' })
    makePackage(root, 'packages', 'charlie', { entryFile: 'index.ts' })

    const logs = []
    const controller = new AbortController()
    const { packages } = await runConsolidatedWatch({
      root,
      log: (line) => logs.push(String(line)),
      build: async () => {},
      signal: controller.signal,
      env: { OM_WATCH_SCOPE: 'env', OM_WATCH_PACKAGES: 'alpha,charlie' },
      argv: [],
    })
    controller.abort()

    assert.deepEqual(packages.map((p) => p.shortLabel).sort(), ['alpha', 'charlie'])
    assert.ok(
      logs.some((line) => line.includes('watch scope: env')),
      `expected watch scope log, got: ${logs.join('\n')}`,
    )
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('runConsolidatedWatch auto-optimized tracks only git-touched packages at startup', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'watch-packages-scope-auto-'))
  try {
    makePackage(root, 'packages', 'alpha', { entryFile: 'index.ts' })
    makePackage(root, 'packages', 'bravo', { entryFile: 'index.ts' })

    const runGit = (_root, args) => {
      if (args[0] === 'status') return ' M packages/bravo/src/index.ts\n'
      return ''
    }
    const controller = new AbortController()
    const { packages } = await runConsolidatedWatch({
      root,
      log: () => {},
      build: async () => {},
      signal: controller.signal,
      env: { OM_WATCH_SCOPE: 'auto-optimized' },
      argv: [],
      runGit,
    })
    controller.abort()

    assert.deepEqual(packages.map((p) => p.shortLabel), ['bravo'])
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('runConsolidatedWatch returns a no-op result when no packages match', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'watch-packages-empty-'))
  try {
    const logs = []
    const controller = new AbortController()
    const result = await runConsolidatedWatch({
      root,
      log: (line) => logs.push(String(line)),
      build: async () => {},
      signal: controller.signal,
    })
    assert.deepEqual(result.packages, [])
    assert.ok(
      logs.some((line) => line.includes('no workspace packages')),
      `expected warning, got: ${logs.join('\n')}`,
    )
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
