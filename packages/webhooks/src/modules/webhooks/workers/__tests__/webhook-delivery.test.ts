import type { EntityManager } from '@mikro-orm/postgresql'
import handler from '../webhook-delivery'

const mockProcessWebhookDeliveryJob = jest.fn()

jest.mock('../../lib/delivery', () => ({
  processWebhookDeliveryJob: (...args: unknown[]) => mockProcessWebhookDeliveryJob(...args),
}))

function makeCtx(em: EntityManager) {
  return {
    resolve: <T,>(name: string): T => {
      if (name === 'em') return em as T
      throw new Error(`Unexpected dependency: ${name}`)
    },
  }
}

describe('webhooks delivery worker', () => {
  const jobData = { deliveryId: 'delivery-1', tenantId: 'tenant-1', organizationId: 'org-1' }

  afterEach(() => {
    jest.clearAllMocks()
  })

  it('calls processWebhookDeliveryJob with the forked em and job data', async () => {
    const em = { fork: jest.fn().mockReturnThis() } as unknown as EntityManager
    mockProcessWebhookDeliveryJob.mockResolvedValue(null)

    await handler({ data: jobData }, makeCtx(em))

    expect(mockProcessWebhookDeliveryJob).toHaveBeenCalledWith(em, jobData)
  })

  it('re-throws on job failure so the queue can retry', async () => {
    const em = { fork: jest.fn().mockReturnThis() } as unknown as EntityManager
    const cause = new Error('DB connection lost')
    mockProcessWebhookDeliveryJob.mockRejectedValue(cause)

    await expect(handler({ data: jobData }, makeCtx(em))).rejects.toThrow('DB connection lost')
  })
})
