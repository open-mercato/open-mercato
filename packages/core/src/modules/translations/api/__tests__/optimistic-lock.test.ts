/** @jest-environment node */

import {
  enforceCommandOptimisticLock,
} from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  OPTIMISTIC_LOCK_HEADER_NAME,
  OPTIMISTIC_LOCK_CONFLICT_CODE,
} from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

/**
 * The standalone translations route (`PUT/DELETE /api/translations/[entityType]/[entityId]`)
 * enforces optimistic locking against the TRANSLATION ROW'S OWN `updated_at`
 * before running the save/delete command. This proves the contract the route
 * wires (`enforceCommandOptimisticLock(... { resourceKind: 'translations.translation',
 * current: row.updated_at, request })`): a stale standalone PUT must 409 instead
 * of silently clobbering a concurrent edit — closing the no-lock hole that the
 * spec previously deferred (Phase 6b Step 4).
 */
const RESOURCE_KIND = 'translations.translation'
const ROW_ID = '11111111-1111-1111-1111-111111111111'
const CURRENT_VERSION = '2026-06-01T11:00:00.000Z'
const STALE_VERSION = '2026-06-01T10:00:00.000Z'

function requestWithExpected(expected: string | null): Request {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (expected) headers.set(OPTIMISTIC_LOCK_HEADER_NAME, expected)
  return new Request('https://example.test/api/translations/catalog:catalog_product/p1', {
    method: 'PUT',
    headers,
  })
}

describe('translations route optimistic locking (row version)', () => {
  it('409s a stale standalone write (client expected version != current row version)', () => {
    let thrown: unknown
    try {
      enforceCommandOptimisticLock({
        resourceKind: RESOURCE_KIND,
        resourceId: ROW_ID,
        current: CURRENT_VERSION,
        request: requestWithExpected(STALE_VERSION),
        envValue: 'all',
      })
    } catch (err) {
      thrown = err
    }
    expect(thrown).toBeDefined()
    expect(isCrudHttpError(thrown)).toBe(true)
    const httpError = thrown as { status: number; body: { code: string; currentUpdatedAt: string; expectedUpdatedAt: string } }
    expect(httpError.status).toBe(409)
    expect(httpError.body.code).toBe(OPTIMISTIC_LOCK_CONFLICT_CODE)
    expect(httpError.body.currentUpdatedAt).toBe(new Date(CURRENT_VERSION).toISOString())
    expect(httpError.body.expectedUpdatedAt).toBe(new Date(STALE_VERSION).toISOString())
  })

  it('passes when the client expected version matches the current row version', () => {
    expect(() =>
      enforceCommandOptimisticLock({
        resourceKind: RESOURCE_KIND,
        resourceId: ROW_ID,
        current: CURRENT_VERSION,
        request: requestWithExpected(CURRENT_VERSION),
        envValue: 'all',
      }),
    ).not.toThrow()
  })

  it('is a no-op when the client sends no expected-version header (strictly additive)', () => {
    expect(() =>
      enforceCommandOptimisticLock({
        resourceKind: RESOURCE_KIND,
        resourceId: ROW_ID,
        current: CURRENT_VERSION,
        request: requestWithExpected(null),
        envValue: 'all',
      }),
    ).not.toThrow()
  })

  it('is a no-op when no existing row version is loaded (first save / insert path)', () => {
    expect(() =>
      enforceCommandOptimisticLock({
        resourceKind: RESOURCE_KIND,
        resourceId: ROW_ID,
        current: null,
        request: requestWithExpected(STALE_VERSION),
        envValue: 'all',
      }),
    ).not.toThrow()
  })

  it('is disabled when OM_OPTIMISTIC_LOCK is off', () => {
    expect(() =>
      enforceCommandOptimisticLock({
        resourceKind: RESOURCE_KIND,
        resourceId: ROW_ID,
        current: CURRENT_VERSION,
        request: requestWithExpected(STALE_VERSION),
        envValue: 'off',
      }),
    ).not.toThrow()
  })
})
