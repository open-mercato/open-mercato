import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import zlib from 'node:zlib'

import {
  ALLOWLIST_FILE,
  MAX_WAIVER_DAYS,
  applyWaivers,
  collectFlaggedAdvisories,
  decodeAdvisoryResponse,
  fetchAdvisories,
  parseArgs,
  readLockPackages,
  readWaivers,
} from '../audit-ci.mjs'

const imageSizeAdvisory = {
  name: 'image-size',
  severity: 'high',
  range: '<=2.0.2',
  title: 'infinite loop',
  url: 'https://github.com/advisories/GHSA-w3rx-r6r6-pgpr',
}

const imageSizeWaiver = {
  advisory: 'GHSA-w3rx-r6r6-pgpr',
  package: 'image-size',
  vulnerableVersions: '<= 2.0.2',
  reason: 'no published fix',
  expires: '2026-11-08',
}

function withAllowlist(contents, assertions) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-ci-allowlist-'))
  const allowlistPath = path.join(directory, ALLOWLIST_FILE)
  try {
    fs.writeFileSync(allowlistPath, typeof contents === 'string' ? contents : JSON.stringify(contents))
    assertions(allowlistPath)
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
}

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

test('an absent allowlist waives nothing', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-ci-allowlist-'))
  try {
    assert.deepEqual(readWaivers(path.join(directory, ALLOWLIST_FILE)), [])
  } finally {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

test('a malformed waiver fails the run closed instead of silently waiving', () => {
  withAllowlist('{', (allowlistPath) => assert.throws(() => readWaivers(allowlistPath), /not valid JSON/))
  withAllowlist({ entries: [] }, (allowlistPath) => assert.throws(() => readWaivers(allowlistPath), /"waivers" array/))
  withAllowlist({ waivers: [{ ...imageSizeWaiver, reason: '  ' }] }, (allowlistPath) => {
    assert.throws(() => readWaivers(allowlistPath), /missing a non-empty "reason"/)
  })
  withAllowlist({ waivers: [{ ...imageSizeWaiver, advisory: 'CVE-2026-1' }] }, (allowlistPath) => {
    assert.throws(() => readWaivers(allowlistPath), /not a GHSA id/)
  })
  withAllowlist({ waivers: [{ ...imageSizeWaiver, expires: '08-11-2026' }] }, (allowlistPath) => {
    assert.throws(() => readWaivers(allowlistPath), /not a YYYY-MM-DD date/)
  })
})

test('waivers may not be granted for longer than the review window', () => {
  withAllowlist({ waivers: [{ ...imageSizeWaiver, expires: '2026-11-08' }] }, (allowlistPath) => {
    assert.equal(readWaivers(allowlistPath, '2026-08-10').length, 1)
    assert.throws(() => readWaivers(allowlistPath, '2026-08-09'), new RegExp(`more than ${MAX_WAIVER_DAYS} days out`))
  })
})

test('a waiver suppresses only its own advisory, package and reported range', () => {
  const other = { ...imageSizeAdvisory, name: 'nanoid', range: '<3.3.17', url: 'https://github.com/advisories/GHSA-2v37-7h3g-55p8' }
  const rescoped = { ...imageSizeAdvisory, range: '<=2.0.3' }

  const matched = applyWaivers([imageSizeAdvisory], [imageSizeWaiver], '2026-08-10')
  assert.deepEqual(matched.reported, [])
  assert.deepEqual(matched.suppressed.map(({ advisory }) => advisory.name), ['image-size'])
  assert.deepEqual(matched.unused, [])

  assert.deepEqual(applyWaivers([other], [imageSizeWaiver], '2026-08-10').reported, [other])
  assert.deepEqual(applyWaivers([rescoped], [imageSizeWaiver], '2026-08-10').reported, [rescoped])
  assert.deepEqual(applyWaivers([], [imageSizeWaiver], '2026-08-10').unused, [imageSizeWaiver])
})

test('an expired waiver stops suppressing and is reported as expired', () => {
  const result = applyWaivers([imageSizeAdvisory], [imageSizeWaiver], '2026-11-09')
  assert.deepEqual(result.reported, [imageSizeAdvisory])
  assert.deepEqual(result.suppressed, [])
  assert.deepEqual(result.expired.map(({ waiver }) => waiver.advisory), ['GHSA-w3rx-r6r6-pgpr'])
  assert.deepEqual(result.unused, [])
})

test('the allowlist checked into this repository is well formed', () => {
  const repoRoot = path.resolve(import.meta.dirname, '..', '..')
  const allowlistPath = path.join(repoRoot, ALLOWLIST_FILE)
  if (!fs.existsSync(allowlistPath)) return
  for (const waiver of readWaivers(allowlistPath)) {
    assert.match(waiver.reason, /\S/)
  }
})

test('the change-triggered audit job has a hard workflow timeout', () => {
  const repoRoot = path.resolve(import.meta.dirname, '..', '..')
  const workflow = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8')
  assert.match(
    workflow,
    /^\s{2}audit:\n(?:^(?!\s{2}\S)[^\n]*\n)*?\s{4}timeout-minutes:\s+15$/m,
  )
})
