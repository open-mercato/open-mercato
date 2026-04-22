jest.mock('@open-mercato/queue', () => ({
  createQueue: jest.fn(),
}))

describe('webhooks queue', () => {
  const originalQueueStrategy = process.env.QUEUE_STRATEGY

  afterEach(() => {
    process.env.QUEUE_STRATEGY = originalQueueStrategy
    jest.clearAllMocks()
    jest.resetModules()
    delete (globalThis as typeof globalThis & {
      __openMercatoWebhookLocalWorkerPromise__?: Promise<void>
    }).__openMercatoWebhookLocalWorkerPromise__
  })

  it('starts the local delivery worker when enqueueing in local mode', async () => {
    process.env.QUEUE_STRATEGY = 'local'

    const enqueue = jest.fn(async () => 'job-1')
    const processQueue = jest.fn(async () => ({ processed: -1, failed: -1, lastJobId: undefined }))
    const createQueue = jest.requireMock('@open-mercato/queue').createQueue as jest.Mock
    createQueue.mockReturnValue({
      enqueue,
      process: processQueue,
      clear: jest.fn(),
      close: jest.fn(),
      getJobCounts: jest.fn(),
    })

    const { enqueueWebhookDelivery } = await import('../queue')

    await enqueueWebhookDelivery({
      deliveryId: 'delivery-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })

    await enqueueWebhookDelivery({
      deliveryId: 'delivery-2',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })

    expect(enqueue).toHaveBeenCalledTimes(2)
    expect(processQueue).toHaveBeenCalledTimes(1)
  })

  it('does not start the local worker when async queue mode is enabled', async () => {
    process.env.QUEUE_STRATEGY = 'async'

    const enqueue = jest.fn(async () => 'job-1')
    const processQueue = jest.fn(async () => ({ processed: -1, failed: -1, lastJobId: undefined }))
    const createQueue = jest.requireMock('@open-mercato/queue').createQueue as jest.Mock
    createQueue.mockReturnValue({
      enqueue,
      process: processQueue,
      clear: jest.fn(),
      close: jest.fn(),
      getJobCounts: jest.fn(),
    })

    const { enqueueWebhookDelivery } = await import('../queue')

    await enqueueWebhookDelivery({
      deliveryId: 'delivery-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })

    expect(enqueue).toHaveBeenCalledTimes(1)
    expect(processQueue).not.toHaveBeenCalled()
  })
})
