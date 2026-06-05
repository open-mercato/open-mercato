import {
  assertOptimisticLock,
  buildOptimisticLockConflictBody,
  createCommandOptimisticLockGuardService,
  enforceCommandOptimisticLock,
  enforceRecordGoneIsConflict,
  readOptimisticLockExpected,
} from '../optimistic-lock-command'
import { CrudHttpError, isCrudHttpError } from '../errors'
import {
  OPTIMISTIC_LOCK_CONFLICT_CODE,
  OPTIMISTIC_LOCK_CONFLICT_ERROR,
  OPTIMISTIC_LOCK_HEADER_NAME,
} from '../optimistic-lock-headers'

const A = '2026-05-25T08:42:18.123Z'
const B = '2026-05-25T08:42:20.999Z'

function headersWith(token: string | null): Headers {
  const h = new Headers()
  if (token != null) h.set(OPTIMISTIC_LOCK_HEADER_NAME, token)
  return h
}

describe('readOptimisticLockExpected', () => {
  it('reads + trims the header from a Headers object', () => {
    expect(readOptimisticLockExpected(headersWith(`  ${A}  `))).toBe(A)
  })

  it('reads the header from a Request', () => {
    const req = new Request('https://example.test/api/sales/order-lines', {
      method: 'PUT',
      headers: headersWith(A),
    })
    expect(readOptimisticLockExpected(req)).toBe(A)
  })

  it('returns null when the header is absent / empty / source missing', () => {
    expect(readOptimisticLockExpected(headersWith(null))).toBeNull()
    expect(readOptimisticLockExpected(headersWith('   '))).toBeNull()
    expect(readOptimisticLockExpected(null)).toBeNull()
    expect(readOptimisticLockExpected(undefined)).toBeNull()
  })
})

describe('assertOptimisticLock', () => {
  it('throws 409 with the structured body on a version mismatch', () => {
    let caught: unknown
    try {
      assertOptimisticLock({
        resourceKind: 'sales.order',
        resourceId: 'order-1',
        expected: A,
        current: B,
        envValue: 'all',
      })
    } catch (err) {
      caught = err
    }
    expect(isCrudHttpError(caught)).toBe(true)
    const httpError = caught as CrudHttpError
    expect(httpError.status).toBe(409)
    expect(httpError.body).toEqual({
      error: OPTIMISTIC_LOCK_CONFLICT_ERROR,
      code: OPTIMISTIC_LOCK_CONFLICT_CODE,
      currentUpdatedAt: B,
      expectedUpdatedAt: A,
    })
  })

  it('passes when expected matches current (normalized comparison across Date + string)', () => {
    expect(() =>
      assertOptimisticLock({
        resourceKind: 'sales.order',
        resourceId: 'order-1',
        expected: A,
        current: new Date(A),
        envValue: 'all',
      }),
    ).not.toThrow()
  })

  it('is a no-op when no expected token is supplied (strictly additive)', () => {
    expect(() =>
      assertOptimisticLock({
        resourceKind: 'sales.order',
        resourceId: 'order-1',
        expected: null,
        current: B,
        envValue: 'all',
      }),
    ).not.toThrow()
    expect(() =>
      assertOptimisticLock({
        resourceKind: 'sales.order',
        resourceId: 'order-1',
        expected: '   ',
        current: B,
        envValue: 'all',
      }),
    ).not.toThrow()
  })

  it('is a no-op when the current version is missing (let the command 404)', () => {
    expect(() =>
      assertOptimisticLock({
        resourceKind: 'sales.order',
        resourceId: 'order-1',
        expected: A,
        current: null,
        envValue: 'all',
      }),
    ).not.toThrow()
  })

  it('is a no-op when expected is an unparseable token', () => {
    expect(() =>
      assertOptimisticLock({
        resourceKind: 'sales.order',
        resourceId: 'order-1',
        expected: 'not-a-date',
        current: B,
        envValue: 'all',
      }),
    ).not.toThrow()
  })

  it('respects OM_OPTIMISTIC_LOCK=off (no 409 even on mismatch)', () => {
    expect(() =>
      assertOptimisticLock({
        resourceKind: 'sales.order',
        resourceId: 'order-1',
        expected: A,
        current: B,
        envValue: 'off',
      }),
    ).not.toThrow()
  })

  it('respects an allow-list that excludes the resourceKind', () => {
    expect(() =>
      assertOptimisticLock({
        resourceKind: 'sales.order',
        resourceId: 'order-1',
        expected: A,
        current: B,
        envValue: 'customers.company',
      }),
    ).not.toThrow()
  })

  it('enforces the check for a resourceKind present in the allow-list', () => {
    expect(() =>
      assertOptimisticLock({
        resourceKind: 'sales.order',
        resourceId: 'order-1',
        expected: A,
        current: B,
        envValue: 'sales.order',
      }),
    ).toThrow(CrudHttpError)
  })

  it('is ON by default (env unset) — mismatch 409s', () => {
    const prev = process.env.OM_OPTIMISTIC_LOCK
    delete process.env.OM_OPTIMISTIC_LOCK
    try {
      expect(() =>
        assertOptimisticLock({
          resourceKind: 'sales.order',
          resourceId: 'order-1',
          expected: A,
          current: B,
        }),
      ).toThrow(CrudHttpError)
    } finally {
      if (prev !== undefined) process.env.OM_OPTIMISTIC_LOCK = prev
    }
  })
})

describe('enforceCommandOptimisticLock', () => {
  it('reads the expected token from the request header and 409s on mismatch', () => {
    const req = new Request('https://example.test/api/sales/order-lines', {
      method: 'PUT',
      headers: headersWith(A),
    })
    expect(() =>
      enforceCommandOptimisticLock({
        resourceKind: 'sales.order',
        resourceId: 'order-1',
        current: B,
        request: req,
        envValue: 'all',
      }),
    ).toThrow(CrudHttpError)
  })

  it('prefers the explicit expected override over the header', () => {
    const req = new Request('https://example.test/api/sales/order-lines', {
      method: 'PUT',
      headers: headersWith(B), // header matches current → would pass if used
    })
    expect(() =>
      enforceCommandOptimisticLock({
        resourceKind: 'sales.order',
        resourceId: 'order-1',
        current: B,
        expected: A, // stale override → must 409
        request: req,
        envValue: 'all',
      }),
    ).toThrow(CrudHttpError)
  })

  it('is a no-op when neither override nor header is present', () => {
    expect(() =>
      enforceCommandOptimisticLock({
        resourceKind: 'sales.order',
        resourceId: 'order-1',
        current: B,
        request: headersWith(null),
        envValue: 'all',
      }),
    ).not.toThrow()
  })

  it('passes when the header matches the current version', () => {
    expect(() =>
      enforceCommandOptimisticLock({
        resourceKind: 'sales.order',
        resourceId: 'order-1',
        current: new Date(A),
        request: headersWith(A),
        envValue: 'all',
      }),
    ).not.toThrow()
  })
})

describe('enforceRecordGoneIsConflict', () => {
  it('409s when the client opted in (header present) but the record is gone', () => {
    let caught: unknown
    try {
      enforceRecordGoneIsConflict({
        resourceKind: 'customers.interaction',
        resourceId: 'int-1',
        request: headersWith(A),
        envValue: 'all',
      })
    } catch (err) {
      caught = err
    }
    expect(isCrudHttpError(caught)).toBe(true)
    const httpError = caught as CrudHttpError
    expect(httpError.status).toBe(409)
    // No current version exists for a deleted record, so it echoes the expected token.
    expect(httpError.body).toEqual({
      error: OPTIMISTIC_LOCK_CONFLICT_ERROR,
      code: OPTIMISTIC_LOCK_CONFLICT_CODE,
      currentUpdatedAt: A,
      expectedUpdatedAt: A,
    })
  })

  it('is a no-op when the client did not opt in (no header → caller 404 fires)', () => {
    expect(() =>
      enforceRecordGoneIsConflict({
        resourceKind: 'customers.interaction',
        resourceId: 'int-1',
        request: headersWith(null),
        envValue: 'all',
      }),
    ).not.toThrow()
  })

  it('prefers an explicit expected override over the header', () => {
    expect(() =>
      enforceRecordGoneIsConflict({
        resourceKind: 'customers.interaction',
        resourceId: 'int-1',
        expected: A,
        request: headersWith(null),
        envValue: 'all',
      }),
    ).toThrow(CrudHttpError)
  })

  it('is a no-op when the env disables the guard for the resource', () => {
    expect(() =>
      enforceRecordGoneIsConflict({
        resourceKind: 'customers.interaction',
        resourceId: 'int-1',
        request: headersWith(A),
        envValue: 'off',
      }),
    ).not.toThrow()
  })

  it('is a no-op when the expected token is unparseable', () => {
    expect(() =>
      enforceRecordGoneIsConflict({
        resourceKind: 'customers.interaction',
        resourceId: 'int-1',
        request: headersWith('not-a-date'),
        envValue: 'all',
      }),
    ).not.toThrow()
  })
})

describe('buildOptimisticLockConflictBody', () => {
  it('shapes the structured conflict body', () => {
    expect(buildOptimisticLockConflictBody(B, A)).toEqual({
      error: OPTIMISTIC_LOCK_CONFLICT_ERROR,
      code: OPTIMISTIC_LOCK_CONFLICT_CODE,
      currentUpdatedAt: B,
      expectedUpdatedAt: A,
    })
  })
})

describe('createCommandOptimisticLockGuardService', () => {
  it('default service mirrors enforceCommandOptimisticLock (header compare → 409 on mismatch)', async () => {
    const guard = createCommandOptimisticLockGuardService()
    let caught: unknown
    try {
      await guard.enforce({
        resourceKind: 'sales.order',
        resourceId: 'order-1',
        current: B,
        request: headersWith(A),
        envValue: 'all',
      })
    } catch (err) {
      caught = err
    }
    expect(isCrudHttpError(caught)).toBe(true)
    expect((caught as CrudHttpError).status).toBe(409)
  })

  it('default service is a no-op when the client sends no expected token (strictly additive)', async () => {
    const guard = createCommandOptimisticLockGuardService()
    await expect(
      guard.enforce({
        resourceKind: 'sales.order',
        resourceId: 'order-1',
        current: B,
        request: headersWith(null),
        envValue: 'all',
      }),
    ).resolves.toBeUndefined()
  })

  it('default service is a no-op when the env disables the guard for the resource', async () => {
    const guard = createCommandOptimisticLockGuardService()
    await expect(
      guard.enforce({
        resourceKind: 'sales.order',
        resourceId: 'order-1',
        current: B,
        request: headersWith(A),
        envValue: 'off',
      }),
    ).resolves.toBeUndefined()
  })

  it('resolveExpected overrides the header-derived token (enterprise extension point)', async () => {
    const seen: Array<{ expectedFromHeader: string | null; resourceKind: string; resourceId: string }> = []
    // Resolver supplies a stale token even though the client header matches `current`,
    // proving enterprise can drive the expected version from a lock record.
    const guard = createCommandOptimisticLockGuardService({
      resolveExpected: (input) => {
        seen.push(input)
        return A
      },
    })
    let caught: unknown
    try {
      await guard.enforce({
        resourceKind: 'sales.order',
        resourceId: 'order-9',
        current: B,
        request: headersWith(B),
        envValue: 'all',
      })
    } catch (err) {
      caught = err
    }
    expect(isCrudHttpError(caught)).toBe(true)
    expect((caught as CrudHttpError).status).toBe(409)
    expect(seen).toHaveLength(1)
    expect(seen[0]).toEqual({ expectedFromHeader: B, resourceKind: 'sales.order', resourceId: 'order-9' })
  })

  it('awaits an async resolveExpected and passes when it returns the current token', async () => {
    const guard = createCommandOptimisticLockGuardService({
      resolveExpected: async () => B,
    })
    await expect(
      guard.enforce({
        resourceKind: 'sales.order',
        resourceId: 'order-9',
        current: B,
        request: headersWith(A),
        envValue: 'all',
      }),
    ).resolves.toBeUndefined()
  })

  it('resolveExpected returning null skips the check (no expected → additive no-op)', async () => {
    const guard = createCommandOptimisticLockGuardService({
      resolveExpected: () => null,
    })
    await expect(
      guard.enforce({
        resourceKind: 'sales.order',
        resourceId: 'order-9',
        current: B,
        request: headersWith(A),
        envValue: 'all',
      }),
    ).resolves.toBeUndefined()
  })
})
