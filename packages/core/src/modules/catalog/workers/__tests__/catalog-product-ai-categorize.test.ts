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

jest.mock('@open-mercato/shared/lib/i18n/server', () => ({
  resolveTranslations: jest.fn(async () => ({
    translate: (_key: string, fallback?: string) => fallback ?? _key,
  })),
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

  it('fails the progress job with a generic translated message, never the raw error text, so UI does not leak internals', async () => {
    mockCategorize.mockRejectedValue(new Error('kaboom: pg connection string postgres://user:pass@host/db'))
    await expect(handle({ id: 'q1', payload, createdAt: new Date().toISOString() }, {} as never)).resolves.toBeUndefined()
    expect(mockFailJob).toHaveBeenCalledWith(
      'job-1',
      { errorMessage: 'Bulk AI categorization failed' },
      expect.objectContaining({ tenantId: 't' }),
    )
  })

  it('still does not rethrow when marking the progress job failed also throws', async () => {
    mockCategorize.mockRejectedValue(new Error('kaboom'))
    mockFailJob.mockRejectedValueOnce(new Error('db down'))
    await expect(handle({ id: 'q1', payload, createdAt: new Date().toISOString() }, {} as never)).resolves.toBeUndefined()
  })
})
