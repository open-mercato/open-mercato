/**
 * Regression coverage for issue #3601: the universal optimistic-lock floor
 * (`customers.optimistic-lock`, registered with `targetEntity: '*'`) must defer
 * to an authorized enterprise record-lock "Keep mine" override instead of
 * rejecting it on the now-stale `updated_at`.
 */
import {
  clearOptimisticLockReadersForTests,
  registerOptimisticLockReaders,
} from '@open-mercato/shared/lib/crud/optimistic-lock-store'
import {
  OPTIMISTIC_LOCK_CONFLICT_CODE,
  OPTIMISTIC_LOCK_HEADER_NAME,
} from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

const resolveMock = jest.fn(() => ({}))

jest.mock('@open-mercato/shared/lib/di/container', () => ({
  createRequestContainer: jest.fn(async () => ({ resolve: resolveMock })),
}))

import { guards, isAuthorizedRecordLockOverride } from '../guards'
import type { MutationGuardInput } from '@open-mercato/shared/lib/crud/mutation-guard-registry'

const RESOURCE_KIND = 'customers.deal'
const CURRENT_UPDATED_AT = '2026-06-25T18:58:35.000Z'
const STALE_UPDATED_AT = '2026-06-25T18:38:06.000Z'

const optimisticLockGuard = guards.find((guard) => guard.id === 'customers.optimistic-lock')!

function buildInput(headers: Record<string, string>): MutationGuardInput {
  return {
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    userId: 'user-1',
    resourceKind: RESOURCE_KIND,
    resourceId: '11111111-1111-4111-8111-111111111111',
    operation: 'update',
    requestMethod: 'PUT',
    requestHeaders: new Headers(headers),
    mutationPayload: null,
  }
}

describe('isAuthorizedRecordLockOverride', () => {
  it('is true for keep-mine resolutions (case/whitespace tolerant)', () => {
    expect(isAuthorizedRecordLockOverride(new Headers({ 'x-om-record-lock-resolution': 'accept_mine' }))).toBe(true)
    expect(isAuthorizedRecordLockOverride(new Headers({ 'x-om-record-lock-resolution': 'merged' }))).toBe(true)
    expect(isAuthorizedRecordLockOverride(new Headers({ 'x-om-record-lock-resolution': '  ACCEPT_MINE ' }))).toBe(true)
  })

  it('is false for accept-incoming, absent, or unknown resolutions', () => {
    expect(isAuthorizedRecordLockOverride(new Headers({ 'x-om-record-lock-resolution': 'accept_incoming' }))).toBe(false)
    expect(isAuthorizedRecordLockOverride(new Headers({ 'x-om-record-lock-resolution': 'normal' }))).toBe(false)
    expect(isAuthorizedRecordLockOverride(new Headers({}))).toBe(false)
  })
})

describe('customers.optimistic-lock guard — record-lock keep-mine deferral (#3601)', () => {
  const previousEnv = process.env.OM_OPTIMISTIC_LOCK

  beforeEach(() => {
    clearOptimisticLockReadersForTests()
    resolveMock.mockClear()
    resolveMock.mockReturnValue({})
    process.env.OM_OPTIMISTIC_LOCK = 'all'
    registerOptimisticLockReaders({
      [RESOURCE_KIND]: async () => CURRENT_UPDATED_AT,
    })
  })

  afterAll(() => {
    clearOptimisticLockReadersForTests()
    if (previousEnv === undefined) delete process.env.OM_OPTIMISTIC_LOCK
    else process.env.OM_OPTIMISTIC_LOCK = previousEnv
  })

  it('rejects a stale update with 409 when no resolution header is present (control)', async () => {
    const result = await optimisticLockGuard.validate(
      buildInput({ [OPTIMISTIC_LOCK_HEADER_NAME]: STALE_UPDATED_AT }),
    )
    expect(result.ok).toBe(false)
    expect(result.status).toBe(409)
    expect(result.body?.code).toBe(OPTIMISTIC_LOCK_CONFLICT_CODE)
  })

  it('defers (passes) when the request carries an authorized accept_mine override', async () => {
    const result = await optimisticLockGuard.validate(
      buildInput({
        [OPTIMISTIC_LOCK_HEADER_NAME]: STALE_UPDATED_AT,
        'x-om-record-lock-resolution': 'accept_mine',
      }),
    )
    expect(result.ok).toBe(true)
    // Deferral short-circuits before any DB read.
    expect(resolveMock).not.toHaveBeenCalled()
  })

  it('defers (passes) for a merged override too', async () => {
    const result = await optimisticLockGuard.validate(
      buildInput({
        [OPTIMISTIC_LOCK_HEADER_NAME]: STALE_UPDATED_AT,
        'x-om-record-lock-resolution': 'merged',
      }),
    )
    expect(result.ok).toBe(true)
  })

  it('still enforces the floor for accept_incoming (which reloads with a fresh timestamp)', async () => {
    const result = await optimisticLockGuard.validate(
      buildInput({
        [OPTIMISTIC_LOCK_HEADER_NAME]: STALE_UPDATED_AT,
        'x-om-record-lock-resolution': 'accept_incoming',
      }),
    )
    expect(result.ok).toBe(false)
    expect(result.status).toBe(409)
  })
})
