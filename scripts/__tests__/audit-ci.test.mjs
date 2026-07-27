import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'

import { fetchAdvisories } from '../audit-ci.mjs'

const repoRoot = path.resolve(import.meta.dirname, '..', '..')

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
    fetchAdvisories({ example: ['1.0.0'] }, { fetchImpl: stalledFetch, timeoutMs: 10 }),
    (error) => error?.name === 'TimeoutError',
  )
  assert.equal(attempts, 3)
})

test('the change-triggered audit job has a hard workflow timeout', () => {
  const workflow = fs.readFileSync(path.join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8')
  assert.match(
    workflow,
    /^\s{2}audit:\n(?:^(?!\s{2}\S)[^\n]*\n)*?\s{4}timeout-minutes:\s+15$/m,
  )
})
