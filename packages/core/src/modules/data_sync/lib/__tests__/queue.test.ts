const mockCreateModuleQueue = jest.fn()

jest.mock('@open-mercato/queue', () => ({
  createModuleQueue: (...args: unknown[]) => mockCreateModuleQueue(...args),
}))

import { getSyncQueue } from '../queue'
import {
  DATA_SYNC_EXPORT_QUEUE,
  DATA_SYNC_IMPORT_QUEUE,
  DATA_SYNC_LOCK_DURATION_MS,
  DATA_SYNC_RESUMABLE_QUEUES,
} from '../queue-policy'
import { failAbandonedRun } from '../abandoned-run'
import { metadata as importWorkerMetadata } from '../../workers/sync-import'
import { metadata as exportWorkerMetadata } from '../../workers/sync-export'

describe('data sync queue configuration', () => {
  beforeEach(() => {
    mockCreateModuleQueue.mockReset()
    mockCreateModuleQueue.mockReturnValue({})
  })

  it('holds the job lock past a slow batch and survives repeated BullMQ stalled-job recovery', () => {
    getSyncQueue(DATA_SYNC_IMPORT_QUEUE)
    getSyncQueue(DATA_SYNC_EXPORT_QUEUE)

    expect(mockCreateModuleQueue).toHaveBeenCalledWith('data-sync-import', {
      concurrency: 5,
      attempts: 3,
      lockDuration: DATA_SYNC_LOCK_DURATION_MS,
      maxStalledCount: 10,
    })
    expect(mockCreateModuleQueue).toHaveBeenCalledWith('data-sync-export', {
      concurrency: 5,
      attempts: 3,
      lockDuration: DATA_SYNC_LOCK_DURATION_MS,
      maxStalledCount: 10,
    })
  })

  it('leaves queues outside the resumable set on their defaults', () => {
    getSyncQueue('data-sync-something-else')

    expect(mockCreateModuleQueue).toHaveBeenCalledWith('data-sync-something-else', { concurrency: 5 })
  })

  it('declares the abandoned-job hook on the workers, where the queue that runs jobs is built', () => {
    // Not on `getSyncQueue`: that instance only ever enqueues. `runWorker` builds its own queue from
    // worker metadata, so a hook attached to the producer is never installed on the consumer.
    expect(importWorkerMetadata.onJobAbandoned).toBe(failAbandonedRun)
    expect(exportWorkerMetadata.onJobAbandoned).toBe(failAbandonedRun)
    expect(mockCreateModuleQueue).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ onJobAbandoned: expect.anything() }),
    )
  })

  it('keeps the worker queue names and the retry policy on the same constants', () => {
    expect([importWorkerMetadata.queue, exportWorkerMetadata.queue].sort()).toEqual(
      [...DATA_SYNC_RESUMABLE_QUEUES].sort(),
    )
    expect(importWorkerMetadata.lockDuration).toBe(DATA_SYNC_LOCK_DURATION_MS)
    expect(exportWorkerMetadata.lockDuration).toBe(DATA_SYNC_LOCK_DURATION_MS)
  })
})
