const mockCreateModuleQueue = jest.fn()

jest.mock('@open-mercato/queue', () => ({
  createModuleQueue: (...args: unknown[]) => mockCreateModuleQueue(...args),
}))

import { getSyncQueue } from '../queue'

describe('data sync queue configuration', () => {
  beforeEach(() => {
    mockCreateModuleQueue.mockReset()
    mockCreateModuleQueue.mockReturnValue({})
  })

  it('allows import and export jobs to survive repeated BullMQ stalled-job recovery', () => {
    getSyncQueue('data-sync-import')
    getSyncQueue('data-sync-export')

    expect(mockCreateModuleQueue).toHaveBeenCalledWith('data-sync-import', {
      concurrency: 5,
      attempts: 3,
      maxStalledCount: 10,
    })
    expect(mockCreateModuleQueue).toHaveBeenCalledWith('data-sync-export', {
      concurrency: 5,
      attempts: 3,
      maxStalledCount: 10,
    })
  })
})
