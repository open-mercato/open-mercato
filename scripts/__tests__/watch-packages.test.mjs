import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  discoverAppGeneratedDirs,
  discoverWorkspacePackages,
  isWatchedSourceFile,
  runConsolidatedWatch,
  touchGeneratedBarrels,
} from '../watch-packages.mjs'

const REPO_ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)))

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
    const watchers = []
    const watch = (dir, options, onChange) => {
      watchers.push({ dir, options, onChange, closed: false })
      return {
        close() {
          watchers.find((watcher) => watcher.dir === dir).closed = true
        },
      }
    }

    const controller = new AbortController()
    const { packages } = await runConsolidatedWatch({
      root,
      log,
      build,
      watch,
      signal: controller.signal,
    })

    assert.equal(packages.length, 2)
    assert.equal(watchers.length, 2)
    assert.ok(
      logs.some((line) =>
        line.includes('consolidated watcher: tracking 2 packages'),
      ),
      `expected tracking summary, got: ${logs.join('\n')}`,
    )

    fs.writeFileSync(path.join(root, 'packages/alpha/src/change.ts'), '')
    fs.writeFileSync(path.join(root, 'packages/bravo/src/change.ts'), '')
    watchers.find((watcher) => watcher.dir.includes('/alpha/src')).onChange('change', 'change.ts')
    watchers.find((watcher) => watcher.dir.includes('/bravo/src')).onChange('change', 'change.ts')
    await Promise.race([
      secondBuildSeen,
      new Promise((resolve) => setTimeout(resolve, 600)),
    ])

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
    const watchers = []
    const watch = (dir, options, onChange) => {
      watchers.push({ dir, options, onChange })
      return { close() {} }
    }

    const controller = new AbortController()
    await runConsolidatedWatch({
      root,
      log: () => {},
      build: async () => {},
      watch,
      signal: controller.signal,
    })

    fs.writeFileSync(path.join(root, 'packages/alpha/src/change.json'), '{}\n')
    watchers[0].onChange('change', 'change.json')
    await new Promise((resolve) => setTimeout(resolve, 150))

    controller.abort()
    assert.ok(fs.statSync(generatedFile).mtimeMs > oldTime.getTime())
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('runConsolidatedWatch reports watcher startup failures', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'watch-packages-watch-fail-'))
  try {
    makePackage(root, 'packages', 'alpha', { entryFile: 'index.ts' })
    const logs = []
    const result = await runConsolidatedWatch({
      root,
      log: (line) => logs.push(String(line)),
      build: async () => {},
      watch: () => {
        throw new Error('ENOSPC: System limit for number of file watchers reached')
      },
      signal: new AbortController().signal,
    })

    assert.equal(result.failed, true)
    assert.ok(
      logs.some((line) => line.includes('failed to start 1 of 1 package watchers')),
      `expected failed watcher summary, got: ${logs.join('\n')}`,
    )
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

test('standalone watcher CLI stays alive without unsettled top-level await warnings', async () => {
  const child = spawn(process.execPath, ['scripts/watch-packages.mjs'], {
    cwd: REPO_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let stdout = ''
  let stderr = ''
  let closed = false
  let closeResult = null

  const closePromise = new Promise((resolve) => {
    child.on('close', (code, signal) => {
      closed = true
      closeResult = { code, signal }
      resolve(closeResult)
    })
  })

  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')

  const started = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`watcher did not start. stdout:\n${stdout}\nstderr:\n${stderr}`))
    }, 3000)

    child.stdout.on('data', (chunk) => {
      stdout += chunk
      if (stdout.includes('consolidated watcher: tracking')) {
        clearTimeout(timeout)
        resolve()
      }
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.on('close', (code, signal) => {
      clearTimeout(timeout)
      if (!stdout.includes('consolidated watcher: tracking')) {
        reject(new Error(`watcher exited before startup: ${JSON.stringify({ code, signal })}\nstderr:\n${stderr}`))
      }
    })
  })

  try {
    await started
    await new Promise((resolve) => setTimeout(resolve, 250))

    assert.equal(closed, false, `watcher exited unexpectedly: ${JSON.stringify(closeResult)}\nstderr:\n${stderr}`)
    assert.doesNotMatch(stderr, /unsettled top-level await/i)
  } finally {
    if (!closed) {
      child.kill('SIGTERM')
      await closePromise
    }
  }
})
