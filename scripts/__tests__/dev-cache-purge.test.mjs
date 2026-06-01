import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  GREENFIELD_PURGE_TARGETS,
  purgeAppBuildCaches,
} from '../dev-cache-purge.mjs'

function makeLogger() {
  const messages = []
  return {
    messages,
    log: (line) => messages.push(line),
  }
}

function createTempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'dev-cache-purge-'))
}

test('purgeAppBuildCaches: targets route manifests/lock and the legacy .next', () => {
  const segmentsList = GREENFIELD_PURGE_TARGETS.map((segments) => segments.join('/'))
  assert.deepEqual(segmentsList, [
    'apps/mercato/.mercato/next/dev/lock',
    'apps/mercato/.mercato/next/dev/build-manifest.json',
    'apps/mercato/.mercato/next/dev/fallback-build-manifest.json',
    'apps/mercato/.mercato/next/dev/prerender-manifest.json',
    'apps/mercato/.mercato/next/dev/routes-manifest.json',
    'apps/mercato/.mercato/next/dev/server/app-paths-manifest.json',
    'apps/mercato/.mercato/next/dev/server/middleware-build-manifest.js',
    'apps/mercato/.mercato/next/dev/server/middleware-manifest.json',
    'apps/mercato/.mercato/next/dev/server/pages-manifest.json',
    'apps/mercato/.next',
  ])
})

test('purgeAppBuildCaches: removes stale route manifests while preserving Turbopack cache', () => {
  const rootDir = createTempRoot()
  const turbopackCache = path.join(rootDir, 'apps', 'mercato', '.mercato', 'next', 'dev', 'cache', 'turbopack')
  const stalePathsManifest = path.join(rootDir, 'apps', 'mercato', '.mercato', 'next', 'dev', 'server', 'app-paths-manifest.json')
  fs.mkdirSync(turbopackCache, { recursive: true })
  fs.writeFileSync(path.join(turbopackCache, 'index.bin'), 'stale')
  fs.mkdirSync(path.dirname(stalePathsManifest), { recursive: true })
  fs.writeFileSync(stalePathsManifest, '{"/_not-found/page":"app/_not-found/page.js"}')

  const logger = makeLogger()
  const result = purgeAppBuildCaches({ rootDir, logger })

  assert.equal(fs.existsSync(turbopackCache), true)
  assert.equal(fs.existsSync(path.join(turbopackCache, 'index.bin')), true)
  assert.equal(fs.existsSync(stalePathsManifest), false)
  assert.equal(fs.existsSync(path.join(rootDir, 'apps', 'mercato', '.mercato', 'next')), true)
  assert.deepEqual(result.removed, ['apps/mercato/.mercato/next/dev/server/app-paths-manifest.json'])
  assert.ok(logger.messages.some((line) => line.includes('removed apps/mercato/.mercato/next/dev/server/app-paths-manifest.json')))

  fs.rmSync(rootDir, { recursive: true, force: true })
})

test('purgeAppBuildCaches: removes legacy apps/mercato/.next as well', () => {
  const rootDir = createTempRoot()
  const legacyCache = path.join(rootDir, 'apps', 'mercato', '.next', 'cache', 'turbopack')
  fs.mkdirSync(legacyCache, { recursive: true })
  fs.writeFileSync(path.join(legacyCache, 'index.bin'), 'legacy')

  const logger = makeLogger()
  const result = purgeAppBuildCaches({ rootDir, logger })

  assert.equal(fs.existsSync(legacyCache), false)
  assert.equal(fs.existsSync(path.join(rootDir, 'apps', 'mercato', '.next')), false)
  assert.deepEqual(result.removed, ['apps/mercato/.next'])

  fs.rmSync(rootDir, { recursive: true, force: true })
})

test('purgeAppBuildCaches: logs a single "no stale manifest files" line when nothing exists', () => {
  const rootDir = createTempRoot()
  const logger = makeLogger()
  const result = purgeAppBuildCaches({ rootDir, logger })

  assert.deepEqual(result.removed, [])
  assert.equal(logger.messages.length, 1)
  assert.match(logger.messages[0], /no stale Next\/Turbopack manifest files to purge/)

  fs.rmSync(rootDir, { recursive: true, force: true })
})

test('purgeAppBuildCaches: removes configured manifests and legacy directory in one call when both exist', () => {
  const rootDir = createTempRoot()
  const turbopackCache = path.join(rootDir, 'apps', 'mercato', '.mercato', 'next', 'dev', 'cache', 'turbopack')
  const buildManifest = path.join(rootDir, 'apps', 'mercato', '.mercato', 'next', 'dev', 'build-manifest.json')
  const routesManifest = path.join(rootDir, 'apps', 'mercato', '.mercato', 'next', 'dev', 'routes-manifest.json')
  fs.mkdirSync(turbopackCache, { recursive: true })
  fs.writeFileSync(path.join(turbopackCache, 'index.bin'), 'keep')
  fs.writeFileSync(buildManifest, '{}')
  fs.writeFileSync(routesManifest, '{}')
  fs.mkdirSync(path.join(rootDir, 'apps', 'mercato', '.next', 'cache'), { recursive: true })

  const logger = makeLogger()
  const result = purgeAppBuildCaches({ rootDir, logger })

  assert.deepEqual(result.removed, [
    'apps/mercato/.mercato/next/dev/build-manifest.json',
    'apps/mercato/.mercato/next/dev/routes-manifest.json',
    'apps/mercato/.next',
  ])
  assert.equal(fs.existsSync(path.join(turbopackCache, 'index.bin')), true)
  assert.equal(fs.existsSync(buildManifest), false)
  assert.equal(fs.existsSync(routesManifest), false)
  assert.equal(fs.existsSync(path.join(rootDir, 'apps', 'mercato', '.next')), false)

  fs.rmSync(rootDir, { recursive: true, force: true })
})

test('runGreenfieldDev and runClassicGreenfieldDev: source invokes purgeAppBuildCaches before any build:packages stage', async () => {
  const here = path.dirname(new URL(import.meta.url).pathname)
  const devMjs = fs.readFileSync(path.resolve(here, '..', 'dev.mjs'), 'utf8')

  for (const fnName of ['runGreenfieldDev', 'runClassicGreenfieldDev']) {
    const fnMatch = devMjs.match(new RegExp(`async function ${fnName}\\([^)]*\\) \\{([\\s\\S]*?)\\n\\}`))
    assert.ok(fnMatch, `expected to find ${fnName}() in scripts/dev.mjs`)
    const body = fnMatch[1]
    const purgeIdx = body.indexOf('purgeAppBuildCaches(')
    const buildIdx = body.indexOf("'build:packages'")
    assert.notEqual(purgeIdx, -1, `${fnName} must call purgeAppBuildCaches()`)
    assert.notEqual(buildIdx, -1, `${fnName} must run build:packages`)
    assert.ok(purgeIdx < buildIdx, `${fnName} must purge caches before build:packages`)
  }

  assert.match(devMjs, /from '\.\/dev-cache-purge\.mjs'/)
})

test('greenfield dev scripts never purge app build caches after launching runtime warmup', async () => {
  const here = path.dirname(new URL(import.meta.url).pathname)
  const rootDevMjs = fs.readFileSync(path.resolve(here, '..', 'dev.mjs'), 'utf8')
  const templateDevMjs = fs.readFileSync(
    path.resolve(here, '..', '..', 'packages', 'create-app', 'template', 'scripts', 'dev.mjs'),
    'utf8',
  )

  for (const [label, source] of [
    ['root dev.mjs', rootDevMjs],
    ['template dev.mjs', templateDevMjs],
  ]) {
    const purgeCalls = Array.from(source.matchAll(/purgeAppBuildCaches\(\)/g)).map((match) => match.index ?? -1)
    assert.equal(purgeCalls.length, 2, `${label} should purge only for modern and classic greenfield startup`)

    for (const fnName of ['runGreenfieldDev', 'runClassicGreenfieldDev']) {
      const fnMatch = source.match(new RegExp(`async function ${fnName}\\([^)]*\\) \\{([\\s\\S]*?)\\n\\}`))
      assert.ok(fnMatch, `expected to find ${fnName}() in ${label}`)
      const body = fnMatch[1]
      const purgeIdx = body.indexOf('purgeAppBuildCaches(')
      const watchIdx = body.indexOf('startPackageWatch(')
      const appDevIdx = body.indexOf('launchMonorepoAppDev(')
      assert.notEqual(purgeIdx, -1, `${fnName} in ${label} must call purgeAppBuildCaches()`)
      assert.notEqual(watchIdx, -1, `${fnName} in ${label} must start package watch`)
      assert.notEqual(appDevIdx, -1, `${fnName} in ${label} must launch app runtime`)
      assert.ok(purgeIdx < watchIdx, `${fnName} in ${label} must purge before package watch`)
      assert.ok(purgeIdx < appDevIdx, `${fnName} in ${label} must purge before runtime warmup can start`)
    }
  }
})

test('runtime warmup scripts do not remove Next or Turbopack caches between warmup requests', async () => {
  const here = path.dirname(new URL(import.meta.url).pathname)
  const runtimeSources = [
    path.resolve(here, '..', '..', 'apps', 'mercato', 'scripts', 'dev.mjs'),
    path.resolve(here, '..', '..', 'packages', 'create-app', 'template', 'scripts', 'dev-runtime.mjs'),
  ]

  for (const runtimePath of runtimeSources) {
    const source = fs.readFileSync(runtimePath, 'utf8')
    assert.doesNotMatch(source, /purgeAppBuildCaches/, `${runtimePath} must not invoke greenfield cache purge`)
    assert.doesNotMatch(source, /rmSync\([^)]*(?:\.mercato|next|turbopack)/s, `${runtimePath} must not remove Next caches during warmup`)
    assert.doesNotMatch(source, /cache clean --all/, `${runtimePath} must not clean caches during warmup`)
  }
})

test('dev wrappers own shutdown notice and suppress duplicate runtime notices', async () => {
  const here = path.dirname(new URL(import.meta.url).pathname)
  const wrapperSources = [
    path.resolve(here, '..', 'dev.mjs'),
    path.resolve(here, '..', '..', 'packages', 'create-app', 'template', 'scripts', 'dev.mjs'),
  ]
  const runtimeSources = [
    path.resolve(here, '..', '..', 'apps', 'mercato', 'scripts', 'dev.mjs'),
    path.resolve(here, '..', '..', 'packages', 'create-app', 'template', 'scripts', 'dev-runtime.mjs'),
  ]

  for (const wrapperPath of wrapperSources) {
    const source = fs.readFileSync(wrapperPath, 'utf8')
    assert.match(source, /function announceShutdown\(\)/, `${wrapperPath} must announce shutdown`)
    assert.match(source, /Shutting down services\.\.\./, `${wrapperPath} must print shutdown notice`)
    assert.match(source, /OM_DEV_SHUTDOWN_NOTICE_OWNER: 'parent'/, `${wrapperPath} must suppress child duplicate notices`)
  }

  for (const runtimePath of runtimeSources) {
    const source = fs.readFileSync(runtimePath, 'utf8')
    assert.match(source, /shutdownNoticeOwnedByParent/, `${runtimePath} must honor parent shutdown notice ownership`)
    assert.match(source, /if \(!shutdownNoticeOwnedByParent\)/, `${runtimePath} must only print direct-runtime shutdown notices`)
    assert.match(source, /Shutting down services\.\.\./, `${runtimePath} must print direct-runtime shutdown notice`)
  }
})

test('ephemeral dev owns warmup marker and shutdown notice', async () => {
  const here = path.dirname(new URL(import.meta.url).pathname)
  const source = fs.readFileSync(path.resolve(here, '..', 'dev-ephemeral.ts'), 'utf8')

  assert.match(source, /OM_DEV_WARMUP_READY_FILE: warmupReadyFilePath/)
  assert.match(source, /function announceShutdown\(\): void/)
  assert.match(source, /Shutting down services\.\.\./)
  assert.match(source, /process\.on\('SIGINT', \(\) => forwardSignal\('SIGINT'\)\)/)
  assert.match(source, /announceShutdown\(\)\n\s+if \(!devCommand\.killed\)/)
})
