const mockCategorize = jest.fn()
const mockFailJob = jest.fn().mockResolvedValue(undefined)

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({
    resolve: (name: string) => (name === 'progressService' ? { failJob: mockFailJob } : undefined),
  })),
}))

jest.mock('../../lib/aiCategorization/bulkCategorize', () => ({
  ...jest.requireActual('../../lib/aiCategorization/bulkCategorize'),
  categorizeProductsWithProgress: (...args: unknown[]) => mockCategorize(...args),
}))

import handle, { metadata } from '../catalog-product-ai-categorize'

const payload = {
  progressJobId: 'job-1',
  ids: ['p1'],
  scope: { tenantId: 't', organizationId: 'o', userId: 'u' },
}

describe('catalog:product-ai-categorize worker', () => {
  beforeEach(() => jest.clearAllMocks())

  it('declares the queue, id and default concurrency of 1', () => {
    expect(metadata).toMatchObject({
      queue: 'catalog-product-ai-categorize',
      id: 'catalog:product-ai-categorize',
      concurrency: 1,
    })
  })

  it('delegates to the processor with the job payload', async () => {
    mockCategorize.mockResolvedValue({})
    await handle({ id: 'q1', payload, createdAt: new Date().toISOString() }, {} as never)
    expect(mockCategorize).toHaveBeenCalledWith(expect.objectContaining({ progressJobId: 'job-1', ids: ['p1'] }))
    expect(mockFailJob).not.toHaveBeenCalled()
  })

  it('fails the progress job and rethrows when the processor throws', async () => {
    mockCategorize.mockRejectedValue(new Error('kaboom'))
    await expect(handle({ id: 'q1', payload, createdAt: new Date().toISOString() }, {} as never)).rejects.toThrow('kaboom')
    expect(mockFailJob).toHaveBeenCalledWith('job-1', { errorMessage: 'kaboom' }, expect.objectContaining({ tenantId: 't' }))
  })
})
