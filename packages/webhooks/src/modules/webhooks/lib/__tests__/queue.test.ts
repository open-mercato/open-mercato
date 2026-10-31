jest.mock('@open-mercato/queue', () => ({
  createQueue: jest.fn(),
  createModuleQueue: jest.fn(),
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
    delete (globalThis as typeof globalThis & {
      __openMercatoWebhookLocalInboundWorkerPromise__?: Promise<void>
    }).__openMercatoWebhookLocalInboundWorkerPromise__
  })

  function mockInboundQueue() {
    const enqueue = jest.fn(async () => 'inbound-job-1')
    const processQueue = jest.fn(async () => ({ processed: -1, failed: -1, lastJobId: undefined }))
    const createModuleQueue = jest.requireMock('@open-mercato/queue').createModuleQueue as jest.Mock
    createModuleQueue.mockReturnValue({
      enqueue,
      process: processQueue,
      clear: jest.fn(),
      close: jest.fn(),
      getJobCounts: jest.fn(),
    })
    return { enqueue, processQueue, createModuleQueue }
  }

  const inboundJob = {
    ingestionId: 'ingestion-1',
    sourceKey: 'source-1',
    eventType: 'payment.received',
    tenantId: 'tenant-1',
    organizationId: 'org-1',
  }

  it('starts the local delivery worker when enqueueing in local mode', async () => {
    process.env.QUEUE_STRATEGY = 'local'

    const enqueue = jest.fn(async () => 'job-1')
    const processQueue = jest.fn(async () => ({ processed: -1, failed: -1, lastJobId: undefined }))
    const createModuleQueue = jest.requireMock('@open-mercato/queue').createModuleQueue as jest.Mock
    createModuleQueue.mockReturnValue({
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
    const createModuleQueue = jest.requireMock('@open-mercato/queue').createModuleQueue as jest.Mock
    createModuleQueue.mockReturnValue({
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

  it('starts the local inbound worker by default and shares it across enqueues', async () => {
    process.env.QUEUE_STRATEGY = 'local'
    const { enqueue, processQueue } = mockInboundQueue()
    const { enqueueInboundDispatch } = await import('../queue')

    await expect(enqueueInboundDispatch(inboundJob)).resolves.toBe('inbound-job-1')
    await enqueueInboundDispatch({ ...inboundJob, ingestionId: 'ingestion-2' })

    expect(enqueue).toHaveBeenCalledTimes(2)
    expect(enqueue).toHaveBeenCalledWith(inboundJob)
    expect(processQueue).toHaveBeenCalledTimes(1)
  })

  it('can enqueue inbound work without starting the local worker', async () => {
    process.env.QUEUE_STRATEGY = 'local'
    const { enqueue, processQueue } = mockInboundQueue()
    const { enqueueInboundDispatch } = await import('../queue')

    await expect(enqueueInboundDispatch(inboundJob, { startLocalWorker: false })).resolves.toBe('inbound-job-1')

    expect(enqueue).toHaveBeenCalledWith(inboundJob)
    expect(processQueue).not.toHaveBeenCalled()
  })

  it('starts a deferred local inbound worker once when explicitly requested afterward', async () => {
    process.env.QUEUE_STRATEGY = 'local'
    const { enqueue, processQueue } = mockInboundQueue()
    const { enqueueInboundDispatch, ensureLocalInboundQueueWorkerStarted } = await import('../queue')
    await enqueueInboundDispatch(inboundJob, { startLocalWorker: false })

    expect(processQueue).not.toHaveBeenCalled()
    await Promise.all([
      ensureLocalInboundQueueWorkerStarted(),
      ensureLocalInboundQueueWorkerStarted(),
    ])

    expect(enqueue).toHaveBeenCalledTimes(1)
    expect(processQueue).toHaveBeenCalledTimes(1)
  })

  it('does not start an inbound worker in async mode, including explicit startup', async () => {
    process.env.QUEUE_STRATEGY = 'async'
    const { enqueue, processQueue, createModuleQueue } = mockInboundQueue()
    const { enqueueInboundDispatch, ensureLocalInboundQueueWorkerStarted } = await import('../queue')

    await ensureLocalInboundQueueWorkerStarted()
    expect(createModuleQueue).not.toHaveBeenCalled()
    await enqueueInboundDispatch(inboundJob)
    await ensureLocalInboundQueueWorkerStarted()

    expect(enqueue).toHaveBeenCalledWith(inboundJob)
    expect(processQueue).not.toHaveBeenCalled()
  })
})
