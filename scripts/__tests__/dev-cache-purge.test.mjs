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

test('purgeAppBuildCaches: targets cover both .mercato/next and the legacy .next', () => {
  const segmentsList = GREENFIELD_PURGE_TARGETS.map((segments) => segments.join('/'))
  assert.deepEqual(segmentsList, [
    'apps/mercato/.mercato/next',
    'apps/mercato/.next',
  ])
})

test('purgeAppBuildCaches: removes stale Turbopack cache and dev/server manifests under .mercato/next', () => {
  const rootDir = createTempRoot()
  const turbopackCache = path.join(rootDir, 'apps', 'mercato', '.mercato', 'next', 'dev', 'cache', 'turbopack')
  const stalePathsManifest = path.join(rootDir, 'apps', 'mercato', '.mercato', 'next', 'dev', 'server', 'app-paths-manifest.json')
  fs.mkdirSync(turbopackCache, { recursive: true })
  fs.writeFileSync(path.join(turbopackCache, 'index.bin'), 'stale')
  fs.mkdirSync(path.dirname(stalePathsManifest), { recursive: true })
  fs.writeFileSync(stalePathsManifest, '{"/_not-found/page":"app/_not-found/page.js"}')

  const logger = makeLogger()
  const result = purgeAppBuildCaches({ rootDir, logger })

  assert.equal(fs.existsSync(turbopackCache), false)
  assert.equal(fs.existsSync(stalePathsManifest), false)
  assert.equal(fs.existsSync(path.join(rootDir, 'apps', 'mercato', '.mercato', 'next')), false)
  assert.deepEqual(result.removed, ['apps/mercato/.mercato/next'])
  assert.ok(logger.messages.some((line) => line.includes('removed apps/mercato/.mercato/next')))

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

test('purgeAppBuildCaches: logs a single "no stale build directories" line when nothing exists', () => {
  const rootDir = createTempRoot()
  const logger = makeLogger()
  const result = purgeAppBuildCaches({ rootDir, logger })

  assert.deepEqual(result.removed, [])
  assert.equal(logger.messages.length, 1)
  assert.match(logger.messages[0], /no stale Next\/Turbopack build directories to purge/)

  fs.rmSync(rootDir, { recursive: true, force: true })
})

test('purgeAppBuildCaches: removes both configured and legacy directories in one call when both exist', () => {
  const rootDir = createTempRoot()
  fs.mkdirSync(path.join(rootDir, 'apps', 'mercato', '.mercato', 'next', 'dev'), { recursive: true })
  fs.mkdirSync(path.join(rootDir, 'apps', 'mercato', '.next', 'cache'), { recursive: true })

  const logger = makeLogger()
  const result = purgeAppBuildCaches({ rootDir, logger })

  assert.deepEqual(result.removed, [
    'apps/mercato/.mercato/next',
    'apps/mercato/.next',
  ])
  assert.equal(fs.existsSync(path.join(rootDir, 'apps', 'mercato', '.mercato', 'next')), false)
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
