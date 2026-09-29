import fs from 'node:fs'
import path from 'node:path'

import { ABANDONED_JOB_REASONS } from '../strategies/async'

/**
 * `onJobAbandoned` classifies a failure by matching the reason BullMQ records when it destroys a job
 * without calling the processor. That is a string comparison against another package's internals, so
 * an upgrade could rename one and silently switch the hook off — the queue would go back to failing
 * jobs nobody hears about, with every test still green.
 *
 * This asserts the strings are still there. If it fails after a BullMQ bump, read the new source and
 * update `ABANDONED_JOB_REASONS` — do not delete the assertion.
 */
function readBullmqSource(): string {
  const entry = require.resolve('bullmq')
  const root = path.join(entry.slice(0, entry.lastIndexOf(`${path.sep}dist${path.sep}`)), 'dist')
  const chunks: string[] = []

  const walk = (dir: string) => {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, item.name)
      if (item.isDirectory()) walk(full)
      else if (item.name.endsWith('.js') || item.name.endsWith('.lua')) chunks.push(fs.readFileSync(full, 'utf8'))
    }
  }

  walk(root)
  return chunks.join('\n')
}

describe('BullMQ abandonment reasons', () => {
  const source = readBullmqSource()

  it('reads a non-empty BullMQ source tree', () => {
    expect(source.length).toBeGreaterThan(0)
  })

  it.each(ABANDONED_JOB_REASONS)('still emits %p', (reason) => {
    expect(source).toContain(reason)
  })
})
