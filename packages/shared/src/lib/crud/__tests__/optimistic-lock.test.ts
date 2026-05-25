import {
  createOptimisticLockGuardService,
  parseOptimisticLockEnv,
  type OptimisticLockCurrentReader,
} from '../optimistic-lock'
import {
  OPTIMISTIC_LOCK_CONFLICT_CODE,
  OPTIMISTIC_LOCK_CONFLICT_ERROR,
  OPTIMISTIC_LOCK_HEADER_NAME,
} from '../optimistic-lock-headers'
import type { CrudMutationGuardValidateInput } from '../mutation-guard'

describe('parseOptimisticLockEnv', () => {
  it('returns mode=off when unset', () => {
    expect(parseOptimisticLockEnv(undefined)).toEqual({ mode: 'off' })
    expect(parseOptimisticLockEnv(null)).toEqual({ mode: 'off' })
  })

  it('returns mode=off for empty / whitespace strings', () => {
    expect(parseOptimisticLockEnv('')).toEqual({ mode: 'off' })
    expect(parseOptimisticLockEnv('   ')).toEqual({ mode: 'off' })
  })

  it('returns mode=all for the "all" keyword (case-insensitive, trimmed)', () => {
    expect(parseOptimisticLockEnv('all')).toEqual({ mode: 'all' })
    expect(parseOptimisticLockEnv('ALL')).toEqual({ mode: 'all' })
    expect(parseOptimisticLockEnv('  All  ')).toEqual({ mode: 'all' })
  })

  it('builds an allow-list set from a comma-separated list', () => {
    const config = parseOptimisticLockEnv('customers.company,sales.order')
    expect(config.mode).toBe('allowlist')
    if (config.mode !== 'allowlist') throw new Error('expected allowlist')
    expect(Array.from(config.entities).sort()).toEqual(['customers.company', 'sales.order'])
  })

  it('trims, lowercases, and deduplicates allow-list entries', () => {
    const config = parseOptimisticLockEnv('  Customers.Company , customers.company ,SALES.ORDER , ')
    expect(config.mode).toBe('allowlist')
    if (config.mode !== 'allowlist') throw new Error('expected allowlist')
    expect(Array.from(config.entities).sort()).toEqual(['customers.company', 'sales.order'])
  })

  it('promotes the result to mode=all when "all" appears alongside other entities', () => {
    expect(parseOptimisticLockEnv('customers.company,all,sales.order')).toEqual({ mode: 'all' })
  })
})

type MockEm = Record<string, unknown>

function makeService(opts: {
  envValue?: string | null
  readers?: Record<string, OptimisticLockCurrentReader>
  em?: MockEm
}) {
  return createOptimisticLockGuardService({
    getEm: () => (opts.em ?? {}) as never,
    readers: opts.readers ?? {},
    envValue: opts.envValue ?? null,
  })
}

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

describe('createOptimisticLockGuardService — short-circuits', () => {
  it('passes when mode is off (env unset)', async () => {
    const service = makeService({ envValue: undefined })
    const result = await service.validateMutation(makeInput())
    expect(result).toEqual({ ok: true, shouldRunAfterSuccess: false })
  })

  it('passes when operation is "create" (we never lock on create)', async () => {
    const service = makeService({ envValue: 'all', readers: {} })
    const result = await service.validateMutation(makeInput({ operation: 'create' }))
    expect(result).toEqual({ ok: true, shouldRunAfterSuccess: false })
  })

  it('passes when entity is not on the allow-list', async () => {
    const service = makeService({ envValue: 'sales.order' })
    const result = await service.validateMutation(makeInput({ resourceKind: 'customers.company' }))
    expect(result).toEqual({ ok: true, shouldRunAfterSuccess: false })
  })

  it('passes when no reader is registered for the entity (env is on but module did not opt in)', async () => {
    const service = makeService({ envValue: 'all', readers: {} })
    const result = await service.validateMutation(makeInput())
    expect(result).toEqual({ ok: true, shouldRunAfterSuccess: false })
  })

  it('passes when the client did not send the extension header', async () => {
    const service = makeService({
      envValue: 'all',
      readers: { 'customers.company': async () => new Date().toISOString() },
    })
    const result = await service.validateMutation(makeInput())
    expect(result).toEqual({ ok: true, shouldRunAfterSuccess: false })
  })

  it('passes when the client header is malformed (non-ISO)', async () => {
    const headers = new Headers()
    headers.set(OPTIMISTIC_LOCK_HEADER_NAME, 'not-a-date')
    const service = makeService({
      envValue: 'all',
      readers: { 'customers.company': async () => new Date().toISOString() },
    })
    const result = await service.validateMutation(makeInput({ requestHeaders: headers }))
    expect(result).toEqual({ ok: true, shouldRunAfterSuccess: false })
  })

  it('passes when the record no longer exists (lets the CRUD route 404 fire)', async () => {
    const headers = new Headers()
    headers.set(OPTIMISTIC_LOCK_HEADER_NAME, '2026-05-25T08:00:00.000Z')
    const service = makeService({
      envValue: 'all',
      readers: { 'customers.company': async () => null },
    })
    const result = await service.validateMutation(makeInput({ requestHeaders: headers }))
    expect(result).toEqual({ ok: true, shouldRunAfterSuccess: false })
  })
})

describe('createOptimisticLockGuardService — match / mismatch', () => {
  it('passes when expected matches current exactly', async () => {
    const iso = '2026-05-25T08:00:00.000Z'
    const headers = new Headers()
    headers.set(OPTIMISTIC_LOCK_HEADER_NAME, iso)
    const service = makeService({
      envValue: 'all',
      readers: { 'customers.company': async () => iso },
    })
    const result = await service.validateMutation(makeInput({ requestHeaders: headers }))
    expect(result).toEqual({ ok: true, shouldRunAfterSuccess: false })
  })

  it('returns 409 with structured body when current is newer than expected', async () => {
    const expected = '2026-05-25T08:00:00.000Z'
    const current = '2026-05-25T08:00:01.000Z'
    const headers = new Headers()
    headers.set(OPTIMISTIC_LOCK_HEADER_NAME, expected)
    const service = makeService({
      envValue: 'all',
      readers: { 'customers.company': async () => current },
    })
    const result = await service.validateMutation(makeInput({ requestHeaders: headers }))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.status).toBe(409)
    expect(result.body).toEqual({
      error: OPTIMISTIC_LOCK_CONFLICT_ERROR,
      code: OPTIMISTIC_LOCK_CONFLICT_CODE,
      currentUpdatedAt: current,
      expectedUpdatedAt: expected,
    })
  })

  it('returns 409 when current and expected differ by exactly 1 ms', async () => {
    const expected = '2026-05-25T08:00:00.000Z'
    const current = '2026-05-25T08:00:00.001Z'
    const headers = new Headers()
    headers.set(OPTIMISTIC_LOCK_HEADER_NAME, expected)
    const service = makeService({
      envValue: 'all',
      readers: { 'customers.company': async () => current },
    })
    const result = await service.validateMutation(makeInput({ requestHeaders: headers }))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.status).toBe(409)
  })

  it('treats current OLDER than expected as a conflict too (clock skew safety)', async () => {
    const expected = '2026-05-25T08:00:01.000Z'
    const current = '2026-05-25T08:00:00.000Z'
    const headers = new Headers()
    headers.set(OPTIMISTIC_LOCK_HEADER_NAME, expected)
    const service = makeService({
      envValue: 'all',
      readers: { 'customers.company': async () => current },
    })
    const result = await service.validateMutation(makeInput({ requestHeaders: headers }))
    expect(result.ok).toBe(false)
  })

  it('honors delete operations', async () => {
    const expected = '2026-05-25T08:00:00.000Z'
    const current = '2026-05-25T08:00:05.000Z'
    const headers = new Headers()
    headers.set(OPTIMISTIC_LOCK_HEADER_NAME, expected)
    const service = makeService({
      envValue: 'all',
      readers: { 'customers.company': async () => current },
    })
    const result = await service.validateMutation(
      makeInput({ requestHeaders: headers, operation: 'delete', requestMethod: 'DELETE' }),
    )
    expect(result.ok).toBe(false)
  })

  it('passes the resolveExpected hook override (enterprise extension point)', async () => {
    const headers = new Headers()
    headers.set(OPTIMISTIC_LOCK_HEADER_NAME, 'header-value')
    const captured: Array<{ expectedFromHeader: string | null; resourceKind: string; resourceId: string }> = []
    const service = createOptimisticLockGuardService({
      getEm: () => ({} as never),
      readers: { 'customers.company': async () => '2026-05-25T09:00:00.000Z' },
      envValue: 'customers.company',
      resolveExpected: (input) => {
        captured.push(input)
        return '2026-05-25T09:00:00.000Z'
      },
    })
    const result = await service.validateMutation(makeInput({ requestHeaders: headers }))
    expect(result).toEqual({ ok: true, shouldRunAfterSuccess: false })
    expect(captured).toEqual([
      { expectedFromHeader: 'header-value', resourceKind: 'customers.company', resourceId: 'company-1' },
    ])
  })

  it('exposes the resolved config via getConfig()', () => {
    expect(makeService({ envValue: undefined }).getConfig()).toEqual({ mode: 'off' })
    expect(makeService({ envValue: 'all' }).getConfig()).toEqual({ mode: 'all' })
    const allow = makeService({ envValue: 'customers.company' }).getConfig()
    expect(allow.mode).toBe('allowlist')
  })
})
