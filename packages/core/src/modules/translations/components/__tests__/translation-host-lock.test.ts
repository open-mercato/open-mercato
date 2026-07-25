/** @jest-environment node */

import { buildOptimisticLockHeader, extractOptimisticLockConflict } from '@open-mercato/ui/backend/utils/optimisticLock'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

/**
 * TranslationManager wires its `PUT /api/translations/[entityType]/[entityId]`
 * optimistic-lock header from the TRANSLATION ROW'S OWN version (`updatedAt`
 * returned by the GET), and the standalone route enforces it server-side against
 * the row's `updated_at` (record_locks Phase 6b Step 4 — closed no-lock hole).
 *
 * The host entity's version is NOT used: the host's EAV `entityType`
 * (`module:entity`) cannot be cleanly mapped to a registered optimistic-lock
 * reader key (those are derived from the host module's ORM entity name / events
 * config, so they do not equal `canonicalizeResourceTag(entityType)`), so there
 * is no reliable server-side path to resolve the host's current version for an
 * arbitrary `entityType`. Guarding the translation row's own version closes the
 * hole with real server-side enforcement and no cross-module coupling.
 *
 * This guards the row-version → header derivation and the 409 surface
 * recognition without rendering the heavy react-query widget.
 */
describe('translations save keys off the translation row version', () => {
  const ROW_VERSION = '2026-06-01T10:00:00.000Z'

  function resolveTranslationRowUpdatedAt(translationData: { updatedAt?: unknown } | null): string | null {
    const value = translationData?.updatedAt
    return typeof value === 'string' && value.trim().length > 0 ? value : null
  }

  it('derives the expected-version header from the translation row (GET response)', () => {
    const translationData = { entityType: 'catalog:catalog_product', entityId: 'product-1', updatedAt: ROW_VERSION }
    const header = buildOptimisticLockHeader(resolveTranslationRowUpdatedAt(translationData))
    expect(header).toEqual({ [OPTIMISTIC_LOCK_HEADER_NAME]: ROW_VERSION })
  })

  it('sends no header for a brand-new translation (no existing row → strictly additive)', () => {
    const header = buildOptimisticLockHeader(resolveTranslationRowUpdatedAt(null))
    expect(header).toEqual({})
  })

  it('sends no header when the row response carries no usable version', () => {
    expect(buildOptimisticLockHeader(resolveTranslationRowUpdatedAt({ updatedAt: '   ' }))).toEqual({})
    expect(buildOptimisticLockHeader(resolveTranslationRowUpdatedAt({ updatedAt: 12345 }))).toEqual({})
    expect(buildOptimisticLockHeader(resolveTranslationRowUpdatedAt({}))).toEqual({})
  })

  it('a 409 optimistic-lock conflict is recognized so onError can surface the conflict bar', () => {
    const conflictError = {
      status: 409,
      body: {
        code: 'optimistic_lock_conflict',
        currentUpdatedAt: '2026-06-01T11:00:00.000Z',
        expectedUpdatedAt: ROW_VERSION,
      },
    }
    const conflict = extractOptimisticLockConflict(conflictError)
    expect(conflict).not.toBeNull()
    expect(conflict?.currentUpdatedAt).toBe('2026-06-01T11:00:00.000Z')
  })

  it('a non-conflict error is not mistaken for a lock conflict', () => {
    expect(extractOptimisticLockConflict({ status: 500, body: { error: 'boom' } })).toBeNull()
  })
})
