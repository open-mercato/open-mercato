import fs from 'node:fs'
import path from 'node:path'

/**
 * `EnqueueOptions.deduplication` is handed to BullMQ verbatim, so `keepLastIfActive` is a field name
 * borrowed from another package's public type. BullMQ has already renamed things in this area — the
 * old `debounce` option became `deduplication` — and a further rename would be silent here: unknown
 * job options are ignored, so every enqueue would keep succeeding while deduplication quietly stopped
 * happening, taking the "one more run after the last trigger" guarantee with it.
 *
 * This asserts the field is still there. If it fails after a BullMQ bump, read the new source and
 * migrate `DeduplicationOptions` — do not delete the assertion.
 */
function readInstalledBullmqFile(relativePath: string): string {
  const entry = require.resolve('bullmq')
  const dist = entry.slice(0, entry.indexOf(`${path.sep}dist${path.sep}`) + `${path.sep}dist`.length)
  return fs.readFileSync(path.join(dist, relativePath), 'utf8')
}

describe('BullMQ deduplication options', () => {
  // `keepLastIfActive` landed in bullmq 5.72.0. Below that the option is simply an unknown field,
  // which BullMQ ignores, so `deduplication: { id }` reverts to drop-the-duplicate: an enqueue
  // arriving mid-run is discarded and the recomputed state stays stale — the one behaviour
  // BACKWARD_COMPATIBILITY.md forbids this package from having. Nothing logs, and every test still
  // passes, so the peer range is the only thing standing between a consumer and a silently broken
  // guarantee.
  it('is not promised to bullmq versions that predate keepLastIfActive', () => {
    const peerRange = require('../../package.json').peerDependencies.bullmq

    expect(peerRange).toBe('^5.72.0 || ^6.0.0')
  })

  it('still declares keepLastIfActive on its public deduplication type', () => {
    const declaration = readInstalledBullmqFile(path.join('esm', 'types', 'deduplication-options.d.ts'))

    expect(declaration).toContain('id: string')
    expect(declaration).toContain('keepLastIfActive?: boolean')
  })

  it('still requeues a deduplicated job once the active one finishes', () => {
    const script = readInstalledBullmqFile(path.join('esm', 'commands', 'includes', 'storeDeduplicatedNextJob.lua'))

    // The behaviour, not just the name: the stored follow-up is only kept while the current job is
    // in the active list, which is exactly the semantics the local strategy mirrors.
    expect(script).toContain("deduplicationOpts['keepLastIfActive']")
    expect(script).toContain('checkItemInList(activeItems, currentDeduplicatedJobId)')
  })
})
