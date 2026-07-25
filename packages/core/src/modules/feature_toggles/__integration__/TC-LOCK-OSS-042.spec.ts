import { test, expect, type APIRequestContext } from '@playwright/test'
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  createFeatureToggleFixture,
  deleteFeatureToggleIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/featureTogglesFixtures'
import {
  expectConflictBody,
  resolveApiUrl,
} from '@open-mercato/core/modules/core/__integration__/helpers/optimisticLockUi'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

/**
 * TC-LOCK-OSS-042 — global feature-toggle table delete optimistic lock (issue #3239).
 *
 * The global table (`FeatureTogglesTable`) issues row deletes with an
 * optimistic-lock header derived from the list row's `updatedAt`. Before the
 * fix, the list API returned the version as `updated_at` (snake_case) while the
 * table read `row.updatedAt`, so `buildOptimisticLockHeader(undefined)` produced
 * an empty header and stale deletes silently bypassed the lock.
 *
 * This API-level test proves the end-to-end contract the table relies on:
 *  1. the GLOBAL LIST response exposes the version under `updatedAt` (camelCase),
 *  2. a stale DELETE carrying that captured version is refused with the standard
 *     409 `optimistic_lock_conflict` body.
 *
 * Global feature-toggle writes require `feature_toggles.global.manage`, so this
 * runs as `superadmin`.
 */

const GLOBAL_API = '/api/feature_toggles/global'

async function readListUpdatedAt(
  request: APIRequestContext,
  token: string,
  toggleId: string,
): Promise<string> {
  const response = await apiRequest(
    request,
    'GET',
    `${GLOBAL_API}?id=${encodeURIComponent(toggleId)}&pageSize=200`,
    { token },
  )
  expect(response.status(), 'GET global feature toggles list should be 200').toBe(200)
  const body = (await response.json()) as { items?: Array<{ id?: string; updatedAt?: unknown }> }
  const row = (body.items ?? []).find((item) => item.id === toggleId)
  expect(row, 'the created toggle should appear in the global list').toBeTruthy()
  expect(typeof row!.updatedAt, 'global list row must expose updatedAt (issue #3239)').toBe('string')
  return row!.updatedAt as string
}

async function deleteWithLock(
  request: APIRequestContext,
  token: string,
  toggleId: string,
  lockValue: string,
) {
  return request.fetch(resolveApiUrl(`${GLOBAL_API}?id=${encodeURIComponent(toggleId)}`), {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      [OPTIMISTIC_LOCK_HEADER_NAME]: lockValue,
    },
    data: { id: toggleId },
  })
}

test.describe('TC-LOCK-OSS-042: global feature-toggle table delete optimistic lock', () => {
  test('a stale global-toggle delete is refused with a 409 conflict', async ({ page }) => {
    const token = await getAuthToken(page.request, 'superadmin')
    const stamp = Date.now()
    const identifier = `qa_lock_042_${stamp}`
    let toggleId: string | null = null
    try {
      toggleId = await createFeatureToggleFixture(page.request, token, {
        identifier,
        name: `QA Lock 042 ${stamp}`,
        category: 'qa',
        type: 'boolean',
        defaultValue: true,
      })

      // The list response is the surface the table reads to build the delete
      // lock header — capture the version exactly as the UI would.
      const staleUpdatedAt = await readListUpdatedAt(page.request, token, toggleId)

      // Advance `updated_at` out-of-band via a header-less update so the captured
      // list version is now stale.
      const bump = await apiRequest(page.request, 'PUT', GLOBAL_API, {
        token,
        data: { id: toggleId, name: `QA Lock 042 bumped ${stamp}` },
      })
      expect(bump.status(), 'out-of-band update should succeed').toBeLessThan(300)

      // Replay the now-stale delete carrying the captured list version → 409.
      const conflict = await deleteWithLock(page.request, token, toggleId, staleUpdatedAt)
      await expectConflictBody(conflict)
    } finally {
      await deleteFeatureToggleIfExists(page.request, token, toggleId)
    }
  })
})
