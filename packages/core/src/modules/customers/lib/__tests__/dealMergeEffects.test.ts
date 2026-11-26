/** @jest-environment node */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createQueue } from '@open-mercato/queue'
import handle, { metadata } from '../../workers/deal-merge-effects'
import { hasDealMergeEffectsConsumer, type DealMergeEffectsJob } from '../dealMergeEffects'

afterEach(() => jest.restoreAllMocks())

test.each([
  [undefined, false],
  ['', false],
  ['events,search-indexing', false],
  ['events,customers-deal-merge-effects', true],
])('checks whether the CLI manages the dedicated worker in %s', (workers, expected) => {
  jest.replaceProperty(process, 'env', { ...process.env, OM_MANAGED_QUEUE_WORKERS: workers })
  expect(hasDealMergeEffectsConsumer()).toBe(expected)
})

test('flushes moved-record effects from the persistent queue using the worker resolver', async () => {
  const baseDir = await mkdtemp(join(tmpdir(), 'deal-merge-effects-'))
  const queue = createQueue<DealMergeEffectsJob>(metadata.queue, 'local', { baseDir })
  const dataEngine = { markOrmEntityChange: jest.fn(), flushOrmEntityChanges: jest.fn(async () => {}) }
  const tenantId = 'tenant'
  const organizationId = 'organization'
  const id = 'comment'
  const dealId = 'survivor'
  const payload = { tenantId, organizationId, moved: {
    activities: [],
    comments: [{ id, payload: { dealId } }],
    interactions: [],
  } }
  const resolve = <T,>() => dataEngine as T
  let complete!: () => void
  const completed = new Promise<void>((resolveComplete) => { complete = resolveComplete })
  try {
    await queue.enqueue(payload)
    await queue.process(async (job, context) => {
      await handle(job, { ...context, resolve })
      complete()
    })
    await completed

    expect(dataEngine.markOrmEntityChange).toHaveBeenCalledWith({
      action: 'updated',
      entity: { id, dealId },
      identifiers: { id, tenantId, organizationId },
      indexer: { entityType: 'customers:customer_comment' },
      events: expect.objectContaining({ module: 'customers', entity: 'comment', persistent: true }),
    })
    expect(dataEngine.flushOrmEntityChanges).toHaveBeenCalledTimes(1)
  } finally {
    await queue.close()
    await rm(baseDir, { recursive: true, force: true })
  }
})
