import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const SCRIPT = path.join(ROOT, 'scripts', 'check-resolutions.mjs')

function runChecker(root, extraArgs = []) {
  return spawnSync(process.execPath, [SCRIPT, '--root', root, ...extraArgs], { encoding: 'utf8' })
}

function makeFixture({ resolutions, entries, omitLockfile = false }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-resolutions-'))
  const manifest = { name: 'fixture', private: true }
  if (resolutions) manifest.resolutions = resolutions
  fs.writeFileSync(path.join(dir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  if (!omitLockfile) {
    const lines = ['__metadata:', '  version: 10', '  cacheKey: 10', '']
    for (const [entryKey, entry] of Object.entries(entries ?? {})) {
      lines.push(`"${entryKey}":`)
      lines.push(`  version: ${entry.version ?? '1.0.0'}`)
      lines.push(`  resolution: "${entry.resolution ?? entryKey}"`)
      for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
        const requested = entry[field]
        if (!requested) continue
        lines.push(`  ${field}:`)
        for (const [identifier, range] of Object.entries(requested)) {
          lines.push(`    "${identifier}": "${range}"`)
        }
      }
      lines.push('  languageName: node')
      lines.push('  linkType: hard')
      lines.push('')
    }
    fs.writeFileSync(path.join(dir, 'yarn.lock'), lines.join('\n'))
  }
  return dir
}

function withFixture(options, assertions) {
  const fixture = makeFixture(options)
  try {
    assertions(fixture)
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true })
  }
}

test('passes when every descriptor-keyed resolution matches a requested descriptor', () => {
  withFixture(
    {
      resolutions: { 'undici@npm:^7.12.0': '7.29.0' },
      entries: { 'cheerio@npm:^1.0.0': { dependencies: { undici: 'npm:^7.12.0' } } },
    },
    (fixture) => {
      const result = runChecker(fixture)
      assert.equal(result.status, 0, result.stderr)
      assert.match(result.stdout, /1 descriptor-keyed resolution matches a descriptor in yarn\.lock/)
    },
  )
})

test('fails on a key whose descriptor no package requests, listing the ranges in the tree', () => {
  withFixture(
    {
      resolutions: { 'undici@npm:^8.4.1': '8.9.0' },
      entries: { 'testcontainers@npm:^12.0.4': { dependencies: { undici: 'npm:^8.5.0' } } },
    },
    (fixture) => {
      const result = runChecker(fixture)
      assert.equal(result.status, 1)
      assert.match(result.stderr, /nothing in yarn\.lock requests undici@npm:\^8\.4\.1/)
      assert.match(result.stderr, /undici ranges actually requested: npm:\^8\.5\.0/)
    },
  )
})

test('reports a pinned package that nothing in the tree requests at all', () => {
  withFixture(
    {
      resolutions: { 'undici@npm:7.24.0': '7.29.0' },
      entries: { 'cheerio@npm:^1.0.0': { dependencies: { tslib: 'npm:^2.0.0' } } },
    },
    (fixture) => {
      const result = runChecker(fixture)
      assert.equal(result.status, 1)
      assert.match(result.stderr, /undici is not requested by anything — the pin can be dropped/)
    },
  )
})

test('ignores range-less keys, including scoped ones, because they match every descriptor', () => {
  withFixture(
    {
      resolutions: { tar: '7.5.21', '@xmldom/xmldom': '0.8.13' },
      entries: { 'anything@npm:^1.0.0': { dependencies: { tslib: 'npm:^2.0.0' } } },
    },
    (fixture) => {
      const result = runChecker(fixture)
      assert.equal(result.status, 0, result.stderr)
      assert.match(result.stdout, /2 range-less keys apply to every descriptor and cannot rot/)
    },
  )
})

test('matches a scoped descriptor-keyed resolution against the requested range', () => {
  withFixture(
    {
      resolutions: { '@opentelemetry/core@npm:2.5.0': '2.8.0', '@opentelemetry/core@npm:2.6.0': '2.8.0' },
      entries: {
        '@opentelemetry/resources@npm:2.5.0': { dependencies: { '@opentelemetry/core': 'npm:2.5.0' } },
      },
    },
    (fixture) => {
      const result = runChecker(fixture)
      assert.equal(result.status, 1)
      assert.match(result.stderr, /nothing in yarn\.lock requests @opentelemetry\/core@npm:2\.6\.0/)
      assert.doesNotMatch(result.stderr, /@opentelemetry\/core@npm:2\.5\.0"/)
    },
  )
})

test('treats a key written without the npm protocol as the npm protocol', () => {
  withFixture(
    {
      resolutions: { 'undici@^7.12.0': '7.29.0' },
      entries: { 'cheerio@npm:^1.0.0': { dependencies: { undici: 'npm:^7.12.0' } } },
    },
    (fixture) => {
      const result = runChecker(fixture)
      assert.equal(result.status, 0, result.stderr)
    },
  )
})

test('validates the trailing descriptor of an ancestor-scoped key', () => {
  withFixture(
    {
      resolutions: { 'cheerio/undici@npm:^7.99.0': '7.29.0' },
      entries: { 'cheerio@npm:^1.0.0': { dependencies: { undici: 'npm:^7.12.0' } } },
    },
    (fixture) => {
      const result = runChecker(fixture)
      assert.equal(result.status, 1)
      assert.match(result.stderr, /nothing in yarn\.lock requests undici@npm:\^7\.99\.0/)
    },
  )
})

test('does not count a peer dependency range as a descriptor in the tree', () => {
  withFixture(
    {
      resolutions: { 'ajv@npm:^8.8.2': '8.18.0' },
      entries: { 'ajv-keywords@npm:^5.1.0': { peerDependencies: { ajv: 'npm:^8.8.2' } } },
    },
    (fixture) => {
      const result = runChecker(fixture)
      assert.equal(result.status, 1)
      assert.match(result.stderr, /nothing in yarn\.lock requests ajv@npm:\^8\.8\.2/)
    },
  )
})

test('does not count a lockfile entry key, so a key pointing at its own target still fails', () => {
  withFixture(
    {
      resolutions: { 'undici@npm:7.29.0': '7.29.0' },
      entries: {
        'undici@npm:7.29.0, undici@npm:^7.28.0': { resolution: 'undici@npm:7.29.0' },
        'cheerio@npm:^1.0.0': { dependencies: { undici: 'npm:^7.28.0' } },
      },
    },
    (fixture) => {
      const result = runChecker(fixture)
      assert.equal(result.status, 1)
      assert.match(result.stderr, /nothing in yarn\.lock requests undici@npm:7\.29\.0/)
    },
  )
})

test('passes when the manifest declares no resolutions at all', () => {
  withFixture({ entries: { 'anything@npm:^1.0.0': {} } }, (fixture) => {
    const result = runChecker(fixture)
    assert.equal(result.status, 0, result.stderr)
  })
})

test('fails with a clear message when the lockfile is missing', () => {
  withFixture({ resolutions: { 'undici@npm:^7.12.0': '7.29.0' }, omitLockfile: true }, (fixture) => {
    const result = runChecker(fixture)
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Missing yarn\.lock/)
  })
})

test('--json reports the dead keys machine-readably and still exits non-zero', () => {
  withFixture(
    {
      resolutions: { 'undici@npm:^8.4.1': '8.9.0', 'undici@npm:^8.5.0': '8.9.0' },
      entries: { 'testcontainers@npm:^12.0.4': { dependencies: { undici: 'npm:^8.5.0' } } },
    },
    (fixture) => {
      const result = runChecker(fixture, ['--json'])
      assert.equal(result.status, 1)
      const report = JSON.parse(result.stdout)
      assert.deepEqual(
        report.dead.map((entry) => entry.key),
        ['undici@npm:^8.4.1'],
      )
      assert.deepEqual(report.dead[0].requestedRanges, ['npm:^8.5.0'])
      assert.deepEqual(
        report.live.map((entry) => entry.key),
        ['undici@npm:^8.5.0'],
      )
      assert.deepEqual(report.live[0].requestedBy, ['testcontainers@npm:^12.0.4'])
    },
  )
})

test('rejects an unknown argument instead of silently checking the default root', () => {
  const result = spawnSync(process.execPath, [SCRIPT, '--nope'], { encoding: 'utf8' })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /Unknown argument: --nope/)
})

test('the committed root manifest carries no dead resolution key', () => {
  const result = runChecker(ROOT)
  assert.equal(result.status, 0, result.stderr)
})
