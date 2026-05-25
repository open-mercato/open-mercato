import {
  clearOptimisticLockReadersForTests,
  getAllOptimisticLockReaders,
  registerOptimisticLockReaders,
} from '../optimistic-lock-store'
import { createOptimisticLockGuardService } from '../optimistic-lock'
import {
  OPTIMISTIC_LOCK_CONFLICT_CODE,
  OPTIMISTIC_LOCK_HEADER_NAME,
} from '../optimistic-lock-headers'
import type { CrudMutationGuardValidateInput } from '../mutation-guard'

describe('optimistic-lock-store', () => {
  beforeEach(() => {
    clearOptimisticLockReadersForTests()
  })

  afterAll(() => {
    clearOptimisticLockReadersForTests()
  })

  it('starts empty', () => {
    expect(getAllOptimisticLockReaders()).toEqual({})
  })

  it('registers a single reader', () => {
    const reader = async () => '2026-01-01T00:00:00.000Z'
    registerOptimisticLockReaders({ 'customers.company': reader })
    expect(Object.keys(getAllOptimisticLockReaders())).toEqual(['customers.company'])
    expect(getAllOptimisticLockReaders()['customers.company']).toBe(reader)
  })

  it('merges multiple registrations across modules', () => {
    const a = async () => '2026-01-01T00:00:00.000Z'
    const b = async () => '2026-02-02T00:00:00.000Z'
    registerOptimisticLockReaders({ 'customers.company': a })
    registerOptimisticLockReaders({ 'sales.order': b })
    const all = getAllOptimisticLockReaders()
    expect(Object.keys(all).sort()).toEqual(['customers.company', 'sales.order'])
    expect(all['customers.company']).toBe(a)
    expect(all['sales.order']).toBe(b)
  })

  it('later registration overrides earlier for the same key', () => {
    const v1 = async () => 'v1'
    const v2 = async () => 'v2'
    registerOptimisticLockReaders({ 'customers.company': v1 })
    registerOptimisticLockReaders({ 'customers.company': v2 })
    expect(getAllOptimisticLockReaders()['customers.company']).toBe(v2)
  })
})

describe('createOptimisticLockGuardService — store-backed fallback', () => {
  beforeEach(() => {
    clearOptimisticLockReadersForTests()
  })

  afterAll(() => {
    clearOptimisticLockReadersForTests()
  })

  function makeInput(overrides: Partial<CrudMutationGuardValidateInput> = {}): CrudMutationGuardValidateInput {
    const headers = overrides.requestHeaders ?? new Headers()
    return {
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      userId: 'user-1',
      resourceKind: 'customers.company',
      resourceId: 'company-1',
      operation: 'update',
      requestMethod: 'PUT',
      requestHeaders: headers,
      mutationPayload: null,
      ...overrides,
      requestHeaders: headers,
    }
  }

  it('pulls readers from the store when opts.readers is omitted', async () => {
    registerOptimisticLockReaders({
      'customers.company': async () => '2026-05-25T08:00:00.000Z',
    })
    const headers = new Headers()
    headers.set(OPTIMISTIC_LOCK_HEADER_NAME, '2026-05-25T08:00:00.000Z')
    const service = createOptimisticLockGuardService({
      getEm: () => ({} as never),
      envValue: 'all',
    })
    const result = await service.validateMutation(makeInput({ requestHeaders: headers }))
    expect(result).toEqual({ ok: true, shouldRunAfterSuccess: false })
  })

  it('returns 409 when the store-backed reader reports a different current value', async () => {
    registerOptimisticLockReaders({
      'customers.company': async () => '2026-05-25T08:00:05.000Z',
    })
    const headers = new Headers()
    headers.set(OPTIMISTIC_LOCK_HEADER_NAME, '2026-05-25T08:00:00.000Z')
    const service = createOptimisticLockGuardService({
      getEm: () => ({} as never),
      envValue: 'all',
    })
    const result = await service.validateMutation(makeInput({ requestHeaders: headers }))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.status).toBe(409)
    expect(result.body).toMatchObject({
      code: OPTIMISTIC_LOCK_CONFLICT_CODE,
      currentUpdatedAt: '2026-05-25T08:00:05.000Z',
      expectedUpdatedAt: '2026-05-25T08:00:00.000Z',
    })
  })

  it('explicit opts.readers wins over the store for the same key', async () => {
    registerOptimisticLockReaders({
      'customers.company': async () => 'from-store',
    })
    const headers = new Headers()
    headers.set(OPTIMISTIC_LOCK_HEADER_NAME, '2026-05-25T08:00:00.000Z')
    const service = createOptimisticLockGuardService({
      getEm: () => ({} as never),
      envValue: 'all',
      readers: {
        'customers.company': async () => '2026-05-25T08:00:00.000Z', // matches client header
      },
    })
    const result = await service.validateMutation(makeInput({ requestHeaders: headers }))
    expect(result).toEqual({ ok: true, shouldRunAfterSuccess: false })
  })
})
