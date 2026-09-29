import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import zlib from 'node:zlib'

import {
  ALLOWLIST_PATH,
  collectFlaggedAdvisories,
  decodeAdvisoryResponse,
  extractGhsaId,
  fetchAdvisories,
  loadAllowlist,
  parseArgs,
  partitionAllowlisted,
  readLockPackages,
} from '../audit-ci.mjs'

test('parses npm and patched packages from a Yarn lockfile', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-ci-'))
  const lockPath = path.join(directory, 'yarn.lock')
  try {
    fs.writeFileSync(lockPath, [
      '__metadata:',
      '  version: 8',
      '',
      '"@scope/pkg@npm:^1.0.0":',
      '  version: 1.2.3',
      '  resolution: "@scope/pkg@npm:1.2.3"',
      '',
      '"plain@patch:plain@npm%3A2.0.0#optional!builtin<compat/plain>":',
      '  version: 2.0.0',
      '  resolution: "plain@patch:plain@npm%3A2.0.0#optional!builtin<compat/plain>::version=2.0.0&hash=abc"',
      '',
      '"local@workspace:packages/local":',
      '  version: 0.0.0-use.local',
      '  resolution: "local@workspace:packages/local"',
      '',
    ].join('\n'))

    const packages = readLockPackages(lockPath)
    assert.deepEqual([...packages.get('@scope/pkg')], ['1.2.3'])
    assert.deepEqual([...packages.get('plain')], ['2.0.0'])
    assert.equal(packages.has('local'), false)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('accepts both severity argument forms and rejects unknown values', () => {
  assert.equal(parseArgs(['--severity=critical']).threshold, 'critical')
  assert.equal(parseArgs(['--severity', 'moderate']).threshold, 'moderate')
  assert.throws(() => parseArgs(['--severity=urgent']), /unknown --severity/)
})

test('decodes gzip advisory responses and fails closed on malformed shapes', () => {
  const payload = {
    lodash: [{ severity: 'high', title: 'prototype pollution', vulnerable_versions: '<4.17.21', url: 'https://example.test/advisory' }],
  }
  const decoded = decodeAdvisoryResponse(zlib.gzipSync(Buffer.from(JSON.stringify(payload))))
  assert.deepEqual(decoded, payload)
  assert.throws(() => decodeAdvisoryResponse(Buffer.from('[]')), /must be an object/)
  assert.throws(() => decodeAdvisoryResponse(Buffer.from('{"lodash":{"severity":"high"}}')), /must be an array/)
  assert.throws(() => decodeAdvisoryResponse(Buffer.from('{"lodash":[{"severity":"urgent"}]}')), /invalid severity/)
})

test('retries transient failures and sends a bounded request signal', async () => {
  let attempts = 0
  const result = await fetchAdvisories({ lodash: ['4.17.20'] }, {
    retryDelayMs: 0,
    timeoutMs: 50,
    fetchImpl: async (_url, init) => {
      attempts += 1
      assert.ok(init.signal instanceof AbortSignal)
      if (attempts < 3) throw new Error('temporary registry failure')
      const body = Buffer.from('{"lodash":[]}')
      return { ok: true, status: 200, arrayBuffer: async () => body }
    },
  })
  assert.equal(attempts, 3)
  assert.deepEqual(result, { lodash: [] })
})

test('flags only advisories at or above the configured threshold', () => {
  const advisories = {
    alpha: [{ severity: 'moderate', title: 'A' }],
    beta: [{ severity: 'critical', title: 'B' }],
    gamma: [{ severity: 'high', title: 'C' }],
  }
  assert.deepEqual(
    collectFlaggedAdvisories(advisories, 'high').map(({ name, severity }) => [name, severity]),
    [['beta', 'critical'], ['gamma', 'high']],
  )
})

test('audit advisory retries abort stalled registry responses before failing closed', async () => {
  let attempts = 0
  const stalledFetch = (_url, options) => {
    attempts += 1
    return new Promise((_resolve, reject) => {
      const fallback = setTimeout(() => reject(new Error('audit request did not abort')), 1_000)
      options.signal.addEventListener('abort', () => {
        clearTimeout(fallback)
        reject(options.signal.reason)
      }, { once: true })
    })
  }

  await assert.rejects(
    fetchAdvisories(
      { example: ['1.0.0'] },
      { fetchImpl: stalledFetch, retryDelayMs: 0, timeoutMs: 10 },
    ),
    (error) => error?.name === 'TimeoutError',
  )
  assert.equal(attempts, 3)
})

test('extracts a GHSA id from an advisory url regardless of case', () => {
  assert.equal(extractGhsaId('https://github.com/advisories/GHSA-w3rx-r6r6-pgpr'), 'GHSA-W3RX-R6R6-PGPR')
  assert.equal(extractGhsaId('https://github.com/advisories/ghsa-5p2g-fcmc-qvqq'), 'GHSA-5P2G-FCMC-QVQQ')
  assert.equal(extractGhsaId('https://example.test/not-a-ghsa-link'), null)
  assert.equal(extractGhsaId(undefined), null)
})

test('the shipped allowlist parses and covers the documented image-size exceptions', () => {
  const allowlist = loadAllowlist(ALLOWLIST_PATH)
  assert.equal(allowlist.get('GHSA-W3RX-R6R6-PGPR')?.package, 'image-size')
  assert.equal(allowlist.get('GHSA-5P2G-FCMC-QVQQ')?.package, 'image-size')
})

test('loadAllowlist returns an empty map when the file is missing', () => {
  const missingPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'audit-ci-')), 'missing.json')
  assert.deepEqual(loadAllowlist(missingPath), new Map())
})

test('loadAllowlist fails closed on a malformed allowlist file', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-ci-'))
  const allowlistPath = path.join(directory, 'audit-ci-allowlist.json')
  try {
    fs.writeFileSync(allowlistPath, JSON.stringify({ version: 1 }))
    assert.throws(() => loadAllowlist(allowlistPath), /must contain an "advisories" object/)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('partitionAllowlisted suppresses only advisories matched by GHSA id', () => {
  const flagged = [
    { name: 'image-size', severity: 'high', range: '<=2.0.2', title: 'ICNS DoS', url: 'https://github.com/advisories/GHSA-w3rx-r6r6-pgpr' },
    { name: 'lodash', severity: 'high', range: '<4.17.21', title: 'prototype pollution', url: 'https://github.com/advisories/GHSA-unrelated-0000-0000' },
  ]
  const allowlist = new Map([['GHSA-W3RX-R6R6-PGPR', { package: 'image-size', reason: 'archived, unpatched, build-time only' }]])
  const { blocking, suppressed } = partitionAllowlisted(flagged, allowlist)
  assert.deepEqual(blocking.map((advisory) => advisory.name), ['lodash'])
  assert.deepEqual(suppressed.map((advisory) => advisory.name), ['image-size'])
  assert.equal(suppressed[0].reason, 'archived, unpatched, build-time only')
})

test('the change-triggered audit job has a hard workflow timeout', () => {
  const repoRoot = path.resolve(import.meta.dirname, '..', '..')
  const workflow = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8')
  assert.match(
    workflow,
    /^\s{2}audit:\n(?:^(?!\s{2}\S)[^\n]*\n)*?\s{4}timeout-minutes:\s+15$/m,
  )
})
