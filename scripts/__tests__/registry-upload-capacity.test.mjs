import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { resolveNodeBundledCli } from '../lib/spawn-cli.mjs'
import { assertUploadFits, measurePublishBody, readUploadCapacity } from '../registry/check-upload-capacity.mjs'

const capacityBytes = readUploadCapacity(readFileSync(new URL('../../config/verdaccio/config.yaml', import.meta.url), 'utf8'))

test('bounded local capacity accommodates the reported core payload after base64 plus metadata', () => {
  assert.ok(capacityBytes <= 256 * 1024 * 1024, 'Keep the local development request limit bounded')
  const metadataReserve = 1024 * 1024
  for (const tarballBytes of [40_300_000, Math.ceil(40.3 * 1024 * 1024)]) {
    const requestBytes = 4 * Math.ceil(tarballBytes / 3) + metadataReserve
    assert.throws(() => assertUploadFits(requestBytes, 50 * 1024 * 1024), /exceeds/)
    assert.doesNotThrow(() => assertUploadFits(requestBytes, capacityBytes))
  }
})

test('capacity parsing rejects absent, duplicate, zero and unbounded settings', () => {
  for (const config of ['', 'max_body_size: unlimited', 'max_body_size: 0mb',
    'max_body_size: 1mb\nmax_body_size: 2mb', 'max_body_size: -1mb']) {
    assert.throws(() => readUploadCapacity(config))
  }
  assert.equal(readUploadCapacity('max_body_size: 1kb\n'), 1024)
  assert.equal(readUploadCapacity('max_body_size: 1.5mb\n'), 1.5 * 1024 * 1024)
})

test('capacity comparison accepts the boundary and rejects an oversized or missing body', () => {
  assert.doesNotThrow(() => assertUploadFits(1024, 1024))
  assert.throws(() => assertUploadFits(1025, 1024), /exceeds/)
  assert.throws(() => assertUploadFits(0, 1024), /Missing/)
})

test('probe measures a real npm encoded publish request without registry storage', { timeout: 90_000 }, async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'om-upload-test-'))
  try {
    writeFileSync(join(tempDir, 'package.json'), JSON.stringify({
      name: '@open-mercato/capacity-fixture',
      version: '1.0.0',
      publishConfig: { registry: 'http://127.0.0.1:1' },
      scripts: { prepublishOnly: 'node -e "require(\'node:fs\').writeFileSync(\'lifecycle-ran\', \'bad\')"' },
    }))
    const npm = resolveNodeBundledCli('npm')
    assert.ok(npm)
    const packed = spawnSync(npm.command, [...npm.prefixArgs, 'pack', '--ignore-scripts', '--json'], {
      cwd: tempDir,
      env: { ...process.env, NPM_CONFIG_CACHE: join(tempDir, 'cache') },
      encoding: 'utf8',
      timeout: 30_000,
    })
    assert.equal(packed.status, 0, packed.stderr)
    const tarballPath = join(tempDir, JSON.parse(packed.stdout)[0].filename)
    const requestBytes = await measurePublishBody(tarballPath)
    assert.ok(requestBytes > 4 * Math.ceil(statSync(tarballPath).size / 3), 'Includes JSON package metadata in addition to base64')
    assert.equal(existsSync(join(tempDir, 'lifecycle-ran')), false)
    assert.doesNotThrow(() => assertUploadFits(requestBytes, capacityBytes))
    assert.throws(() => assertUploadFits(requestBytes, requestBytes - 1), /exceeds/)
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
})
