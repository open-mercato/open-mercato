import {
  createGenericOptimisticLockReader,
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
  it('returns mode=all when unset (default ON)', () => {
    expect(parseOptimisticLockEnv(undefined)).toEqual({ mode: 'all' })
    expect(parseOptimisticLockEnv(null)).toEqual({ mode: 'all' })
  })

  it('returns mode=all for empty / whitespace strings (default ON)', () => {
    expect(parseOptimisticLockEnv('')).toEqual({ mode: 'all' })
    expect(parseOptimisticLockEnv('   ')).toEqual({ mode: 'all' })
  })

  it('returns mode=off for the explicit "off" token (case-insensitive)', () => {
    expect(parseOptimisticLockEnv('off')).toEqual({ mode: 'off' })
    expect(parseOptimisticLockEnv('OFF')).toEqual({ mode: 'off' })
    expect(parseOptimisticLockEnv('  off  ')).toEqual({ mode: 'off' })
  })

  it.each(['false', '0', 'no', 'disabled', 'none'])(
    'treats "%s" as an off-token (mirrors parseBooleanToken)',
    (token) => {
      expect(parseOptimisticLockEnv(token)).toEqual({ mode: 'off' })
    },
  )

  it('disables the guard when any off-token appears alongside other entries (input is invalid; off wins)', () => {
    expect(parseOptimisticLockEnv('off,customers.company')).toEqual({ mode: 'off' })
    expect(parseOptimisticLockEnv('customers.company,false')).toEqual({ mode: 'off' })
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
  it('passes when mode is off (explicit off-token)', async () => {
    const service = makeService({ envValue: 'off' })
    const result = await service.validateMutation(makeInput())
    expect(result).toEqual({ ok: true, shouldRunAfterSuccess: false })
  })

  // NEG-02 opt-out (OM_OPTIMISTIC_LOCK=off): this was originally a test.fixme in
  // TC-LOCK-OSS-046.spec.ts because the shared integration app boots default-ON
  // and a second app with the env flag flipped cannot be booted. The behavior is
  // a pure function of the parser + guard, so it is proven here as a unit test:
  // with the lock disabled, a STALE header (a token that mismatches the current
  // updated_at, which would normally 409) instead passes through ok — exactly the
  // 200/no-enforcement contract the integration case asserted.
  it.each(['off', 'false', '0', 'no', 'disabled', 'none'])(
    'NEG-02: with OM_OPTIMISTIC_LOCK="%s" a stale header is NOT enforced (would-be 409 passes)',
    async (offToken) => {
      const stale = '2026-05-25T08:00:00.000Z'
      const current = '2026-05-25T09:00:00.000Z'
      const headers = new Headers()
      headers.set(OPTIMISTIC_LOCK_HEADER_NAME, stale)
      const service = makeService({
        envValue: offToken,
        readers: { 'customers.company': async () => current },
      })
      // Sanity: the same stale-vs-current pair DOES 409 when the guard is ON,
      // so this assertion isolates the opt-out, not a degenerate no-op input.
      const onService = makeService({
        envValue: 'all',
        readers: { 'customers.company': async () => current },
      })
      const onResult = await onService.validateMutation(makeInput({ requestHeaders: new Headers(headers) }))
      expect(onResult.ok).toBe(false)

      const result = await service.validateMutation(makeInput({ requestHeaders: headers }))
      expect(result).toEqual({ ok: true, shouldRunAfterSuccess: false })
      expect(service.getConfig()).toEqual({ mode: 'off' })
    },
  )

  it('passes when env is unset (default mode=all) but no reader is registered (strict-additive opt-in)', async () => {
    const service = makeService({ envValue: undefined, readers: {} })
    const result = await service.validateMutation(makeInput())
    expect(result).toEqual({ ok: true, shouldRunAfterSuccess: false })
  })

  it('passes when env is unset (default mode=all) but the client did not send the extension header', async () => {
    const service = makeService({
      envValue: undefined,
      readers: { 'customers.company': async () => '2026-05-25T08:00:00.000Z' },
    })
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

  it('detects mismatches end-to-end with env UNSET (proves default-ON behavior)', async () => {
    const expected = '2026-05-25T08:00:00.000Z'
    const current = '2026-05-25T08:00:05.000Z'
    const headers = new Headers()
    headers.set(OPTIMISTIC_LOCK_HEADER_NAME, expected)
    // No envValue / readers passed via constructor — but we DO pass an
    // inline readers map so the service has a reader to consult. The
    // important assertion is that with envValue=undefined (default mode=all)
    // the guard does NOT short-circuit and still fires the conflict.
    const service = makeService({
      envValue: undefined,
      readers: { 'customers.company': async () => current },
    })
    const result = await service.validateMutation(makeInput({ requestHeaders: headers }))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected failure')
    expect(result.status).toBe(409)
    expect(result.body).toMatchObject({
      code: OPTIMISTIC_LOCK_CONFLICT_CODE,
      currentUpdatedAt: current,
      expectedUpdatedAt: expected,
    })
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
    expect(makeService({ envValue: undefined }).getConfig()).toEqual({ mode: 'all' })
    expect(makeService({ envValue: 'off' }).getConfig()).toEqual({ mode: 'off' })
    expect(makeService({ envValue: 'all' }).getConfig()).toEqual({ mode: 'all' })
    const allow = makeService({ envValue: 'customers.company' }).getConfig()
    expect(allow.mode).toBe('allowlist')
  })
})

describe('createGenericOptimisticLockReader', () => {
  class FakeEntity {}

  type FindOneCapture = {
    entity: unknown
    filter: Record<string, unknown>
    options: Record<string, unknown> | undefined
  }

  function makeEm(rowToReturn: Record<string, unknown> | null, captureSink: FindOneCapture[]) {
    return {
      async findOne(entity: unknown, filter: Record<string, unknown>, options?: Record<string, unknown>) {
        captureSink.push({ entity, filter, options })
        return rowToReturn
      },
    } as never
  }

  it('returns the updatedAt ISO string when the row exists', async () => {
    const captures: FindOneCapture[] = []
    const reader = createGenericOptimisticLockReader({ entity: FakeEntity })
    const em = makeEm({ updatedAt: new Date('2026-05-26T07:00:00.000Z') }, captures)
    const result = await reader(em, {
      resourceKind: 'customers.deal',
      resourceId: 'deal-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
    expect(result).toBe('2026-05-26T07:00:00.000Z')
    expect(captures).toHaveLength(1)
    expect(captures[0].entity).toBe(FakeEntity)
    expect(captures[0].filter).toEqual({
      id: 'deal-1',
      tenantId: 'tenant-1',
      organizationId: 'org-1',
      deletedAt: null,
    })
    expect(captures[0].options).toEqual({ fields: ['updatedAt'] })
  })

  it('accepts a string updatedAt as already-ISO', async () => {
    const reader = createGenericOptimisticLockReader({ entity: FakeEntity })
    const em = makeEm({ updatedAt: '2026-05-26T07:00:00.000Z' }, [])
    const result = await reader(em, {
      resourceKind: 'k',
      resourceId: 'r',
      tenantId: 't',
      organizationId: null,
    })
    expect(result).toBe('2026-05-26T07:00:00.000Z')
  })

  it('returns null when the row is missing', async () => {
    const reader = createGenericOptimisticLockReader({ entity: FakeEntity })
    const em = makeEm(null, [])
    const result = await reader(em, {
      resourceKind: 'k',
      resourceId: 'r',
      tenantId: 't',
      organizationId: 't',
    })
    expect(result).toBeNull()
  })

  it('omits the organizationId filter when none is provided', async () => {
    const captures: FindOneCapture[] = []
    const reader = createGenericOptimisticLockReader({ entity: FakeEntity })
    const em = makeEm({ updatedAt: new Date('2026-05-26T07:00:00.000Z') }, captures)
    await reader(em, {
      resourceKind: 'k',
      resourceId: 'r',
      tenantId: 't',
      organizationId: null,
    })
    expect(captures[0].filter).toEqual({ id: 'r', tenantId: 't', deletedAt: null })
  })

  it('skips tenant + org + softDelete filters when the caller disables them', async () => {
    const captures: FindOneCapture[] = []
    const reader = createGenericOptimisticLockReader({
      entity: FakeEntity,
      tenantField: null,
      orgField: null,
      softDeleteField: null,
    })
    const em = makeEm({ updatedAt: new Date('2026-05-26T07:00:00.000Z') }, captures)
    await reader(em, {
      resourceKind: 'k',
      resourceId: 'r',
      tenantId: 't',
      organizationId: 'o',
    })
    expect(captures[0].filter).toEqual({ id: 'r' })
  })

  it('merges an extraFilter (discriminator on shared tables)', async () => {
    const captures: FindOneCapture[] = []
    const reader = createGenericOptimisticLockReader({
      entity: FakeEntity,
      extraFilter: { kind: 'company' },
    })
    const em = makeEm({ updatedAt: new Date('2026-05-26T07:00:00.000Z') }, captures)
    await reader(em, {
      resourceKind: 'customers.company',
      resourceId: 'c',
      tenantId: 't',
      organizationId: 'o',
    })
    expect(captures[0].filter).toMatchObject({ kind: 'company' })
  })

  it('honours a custom idField / orgField / tenantField / updatedAtField', async () => {
    const captures: FindOneCapture[] = []
    const reader = createGenericOptimisticLockReader({
      entity: FakeEntity,
      idField: 'uuid',
      tenantField: 'tenant',
      orgField: 'org',
      softDeleteField: 'archivedAt',
      updatedAtField: 'modifiedAt',
    })
    const em = makeEm({ modifiedAt: new Date('2026-05-26T07:00:00.000Z') }, captures)
    const result = await reader(em, {
      resourceKind: 'k',
      resourceId: 'abc',
      tenantId: 'T',
      organizationId: 'O',
    })
    expect(result).toBe('2026-05-26T07:00:00.000Z')
    expect(captures[0].filter).toEqual({
      uuid: 'abc',
      tenant: 'T',
      org: 'O',
      archivedAt: null,
    })
    expect(captures[0].options).toEqual({ fields: ['modifiedAt'] })
  })

  it('fails open (returns null) AND logs loudly with the resourceKind when findOne throws', async () => {
    const reader = createGenericOptimisticLockReader({ entity: FakeEntity })
    const em = {
      async findOne() {
        throw new Error('column "deleted_at" does not exist')
      },
    } as never
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const result = await reader(em, {
        resourceKind: 'customers.tag',
        resourceId: 'r',
        tenantId: 't',
        organizationId: 'o',
      })
      // Fail-open control flow preserved: a query error must never 500 the mutation.
      expect(result).toBeNull()
      // ...but a misconfig must be visible, naming the affected resourceKind.
      expect(errorSpy).toHaveBeenCalledTimes(1)
      const [message] = errorSpy.mock.calls[0]
      expect(String(message)).toContain('customers.tag')
      expect(String(message)).toContain('[optimistic-lock]')
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('returns null when the projected updatedAt is missing / null / non-Date', async () => {
    const reader = createGenericOptimisticLockReader({ entity: FakeEntity })
    expect(
      await reader(makeEm({}, []), { resourceKind: 'k', resourceId: 'r', tenantId: 't', organizationId: null }),
    ).toBeNull()
    expect(
      await reader(makeEm({ updatedAt: null }, []), {
        resourceKind: 'k',
        resourceId: 'r',
        tenantId: 't',
        organizationId: null,
      }),
    ).toBeNull()
    expect(
      await reader(makeEm({ updatedAt: 12345 }, []), {
        resourceKind: 'k',
        resourceId: 'r',
        tenantId: 't',
        organizationId: null,
      }),
    ).toBeNull()
  })

  it('plugs into createOptimisticLockGuardService as a reader', async () => {
    const reader = createGenericOptimisticLockReader({ entity: FakeEntity })
    const em = makeEm({ updatedAt: new Date('2026-05-26T07:00:00.000Z') }, [])
    const headers = new Headers()
    headers.set(OPTIMISTIC_LOCK_HEADER_NAME, '2026-05-26T07:00:00.000Z')
    const service = createOptimisticLockGuardService({
      getEm: () => em,
      envValue: 'all',
      readers: { 'customers.deal': reader },
    })
    const result = await service.validateMutation(
      makeInput({ resourceKind: 'customers.deal', requestHeaders: headers }),
    )
    expect(result).toEqual({ ok: true, shouldRunAfterSuccess: false })
  })
})
