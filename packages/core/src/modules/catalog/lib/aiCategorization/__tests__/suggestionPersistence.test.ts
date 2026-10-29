import { UniqueConstraintViolationException } from '@mikro-orm/core'
import { persistCategorySuggestion } from '../suggestionPersistence'

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const PRODUCT = '33333333-3333-4333-8333-333333333333'

type FakeSuggestion = { id: string; status: string; [key: string]: unknown }

function buildTrx(opts: {
  product?: { id: string } | null
  pending?: FakeSuggestion[]
  flushError?: unknown
}) {
  const persisted: FakeSuggestion[] = []
  const trx = {
    findOne: jest.fn().mockResolvedValue('product' in opts ? opts.product : { id: PRODUCT }),
    find: jest.fn().mockResolvedValue(opts.pending ?? []),
    create: jest.fn().mockImplementation((_entity: unknown, payload: Record<string, unknown>) => {
      const row = { id: 'new-id', ...payload } as FakeSuggestion
      return row
    }),
    persist: jest.fn((row: FakeSuggestion) => persisted.push(row)),
    flush: jest.fn().mockImplementation(async () => {
      if (opts.flushError) throw opts.flushError
    }),
  }
  return { trx, persisted }
}

function buildEm(trx: ReturnType<typeof buildTrx>['trx']) {
  return {
    transactional: jest.fn(async (fn: (trx: unknown) => Promise<unknown>) => fn(trx)),
  } as unknown as Parameters<typeof persistCategorySuggestion>[0]
}

describe('persistCategorySuggestion', () => {
  it('inserts a pending suggestion when there is no prior pending row', async () => {
    const { trx } = buildTrx({ pending: [] })
    const em = buildEm(trx)
    const suggestion = await persistCategorySuggestion(em, {
      productId: PRODUCT,
      tenantId: TENANT,
      organizationId: ORG,
      outcome: 'suggested',
      categoryId: 'cat-1',
      categoryPathIds: ['cat-1'],
      confidence: 0.81,
      trigger: 'manual',
    })
    expect(trx.persist).toHaveBeenCalledTimes(1)
    expect(suggestion.status).toBe('pending')
    expect(suggestion.confidence).toBe('0.8100')
  })

  it('supersedes an existing pending suggestion for the same product', async () => {
    const existingPending: FakeSuggestion = { id: 'old-id', status: 'pending' }
    const { trx } = buildTrx({ pending: [existingPending] })
    const em = buildEm(trx)
    await persistCategorySuggestion(em, {
      productId: PRODUCT,
      tenantId: TENANT,
      organizationId: ORG,
      outcome: 'no_match',
      trigger: 'manual',
    })
    expect(existingPending.status).toBe('superseded')
  })

  it('throws 404 when the product cannot be found', async () => {
    const { trx } = buildTrx({ product: null })
    const em = buildEm(trx)
    await expect(persistCategorySuggestion(em, {
      productId: PRODUCT,
      tenantId: TENANT,
      organizationId: ORG,
      outcome: 'no_match',
      trigger: 'manual',
    })).rejects.toMatchObject({ status: 404 })
  })

  it('maps a unique-constraint violation to 409 suggestion_in_progress', async () => {
    const violation = Object.create(UniqueConstraintViolationException.prototype)
    const { trx } = buildTrx({ flushError: violation })
    const em = buildEm(trx)
    await expect(persistCategorySuggestion(em, {
      productId: PRODUCT,
      tenantId: TENANT,
      organizationId: ORG,
      outcome: 'suggested',
      categoryId: 'cat-1',
      trigger: 'manual',
    })).rejects.toMatchObject({ status: 409, body: { code: 'suggestion_in_progress' } })
  })

  it('rethrows a non-unique-constraint flush error unchanged', async () => {
    const otherError = new Error('db down')
    const { trx } = buildTrx({ flushError: otherError })
    const em = buildEm(trx)
    await expect(persistCategorySuggestion(em, {
      productId: PRODUCT,
      tenantId: TENANT,
      organizationId: ORG,
      outcome: 'suggested',
      trigger: 'manual',
    })).rejects.toBe(otherError)
  })

  it('stores no_match rows with a null category and empty path', async () => {
    const { trx } = buildTrx({ pending: [] })
    const em = buildEm(trx)
    const suggestion = await persistCategorySuggestion(em, {
      productId: PRODUCT,
      tenantId: TENANT,
      organizationId: ORG,
      outcome: 'no_match',
      trigger: 'manual',
    })
    expect(suggestion.categoryId).toBeNull()
    expect(suggestion.categoryPathIds).toEqual([])
    expect(suggestion.confidence).toBeNull()
  })
})
