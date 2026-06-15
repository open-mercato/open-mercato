import { test, expect, type APIRequestContext } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  putWithLock,
  expectConflictBody,
  resolveApiUrl,
} from '@open-mercato/core/modules/core/__integration__/helpers/optimisticLockUi'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

/**
 * TC-LOCK-OSS-034 — sidebar customization (AUTH-08) optimistic-lock conflict
 * contract.
 *
 * `SidebarCustomizationEditor` persists the user's layout through
 * `PUT /api/auth/sidebar/preferences`
 * (`packages/core/src/modules/auth/api/sidebar/preferences/route.ts`). The route
 * guards the user-scope write with `enforceCommandOptimisticLock`
 * (`resourceKind: 'auth.sidebar_preference'`) once a row already exists. NOTE:
 * the task brief said PATCH, but the live route only exposes GET/PUT/DELETE and
 * the lock runs on PUT — so the executable contract is driven over PUT (the
 * shared `putWithLock` helper already pins the method to PUT).
 *
 * The user preference is a **per-user singleton** (no fixture id, and the only
 * DELETE handles role variants via `?roleId`), so the test mirrors the
 * inbox-settings singleton pattern from TC-LOCK-OSS-043:
 *   1. establish a preferences row via header-less PUTs (the entity's
 *      `updated_at` is `onUpdate`-only, so the INSERT leaves it NULL — a second
 *      PUT promotes it to a real timestamp; see `establishPreferencesVersion`),
 *   2. read its non-null `updatedAt` from GET,
 *   3. advance `updatedAt` out-of-band via a further header-less PUT (the
 *      strictly-additive path always succeeds and bumps the version),
 *   4. replay the now-stale PUT carrying the original expected-version header
 *      → 409 `optimistic_lock_conflict`.
 * `finally` restores the singleton to an empty baseline with a fresh lock token.
 *
 * Coverage: API-level (`putWithLock` + `expectConflictBody`). The editor lives
 * behind a multi-step drag/relabel UI whose Save only PUTs a non-empty diff;
 * the singleton conflict semantics are identical and proven deterministically
 * at the route, so no browser assertion is added here.
 */

const PREFERENCES_API = '/api/auth/sidebar/preferences'

const EMPTY_SETTINGS = {
  groupOrder: [] as string[],
  groupLabels: {} as Record<string, string>,
  itemLabels: {} as Record<string, string>,
  hiddenItems: [] as string[],
  itemOrder: {} as Record<string, string[]>,
}

async function putPreferences(
  request: APIRequestContext,
  token: string,
  body: Record<string, unknown>,
  lockValue?: string,
) {
  return request.fetch(resolveApiUrl(PREFERENCES_API), {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(lockValue !== undefined ? { [OPTIMISTIC_LOCK_HEADER_NAME]: lockValue } : {}),
    },
    data: body,
  })
}

async function readPreferencesUpdatedAt(
  request: APIRequestContext,
  token: string,
): Promise<string | null> {
  const response = await request.fetch(resolveApiUrl(PREFERENCES_API), {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  })
  expect(response.status(), 'GET sidebar preferences should be 200').toBe(200)
  const body = (await response.json()) as { updatedAt?: string | null; scope?: { type?: string } }
  expect(body.scope?.type, 'default GET should resolve the user-scope singleton').toBe('user')
  return typeof body.updatedAt === 'string' ? body.updatedAt : null
}

/**
 * Establish a per-user singleton row that exposes a non-null `updated_at`.
 *
 * The entity's `updated_at` carries `onUpdate` (no `onCreate`), so the very
 * first PUT (an INSERT) leaves `updated_at` NULL — the lock token only becomes a
 * real timestamp after a subsequent PUT (an UPDATE). We therefore PUT twice and
 * confirm GET now reports a string `updatedAt` before treating it as the
 * baseline expected-version.
 */
async function establishPreferencesVersion(
  request: APIRequestContext,
  token: string,
  marker: string,
): Promise<string> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const put = await putPreferences(request, token, {
      ...EMPTY_SETTINGS,
      groupOrder: [`${marker}-${attempt}`],
    })
    expect(put.status(), 'PUT establishing the singleton should succeed').toBeLessThan(300)
  }
  const updatedAt = await readPreferencesUpdatedAt(request, token)
  expect(typeof updatedAt, 'an established (updated) preferences row should expose updatedAt').toBe('string')
  return updatedAt as string
}

test.describe('TC-LOCK-OSS-034: sidebar customization optimistic-lock conflict', () => {
  test('AUTH-08 stale sidebar-preferences PUT is refused with a 409 conflict', async ({ page }) => {
    const token = await getAuthToken(page.request, 'admin')
    const stamp = Date.now()
    try {
      // 1+2. Establish the per-user singleton row and read its (non-null) version.
      const staleUpdatedAt = await establishPreferencesVersion(
        page.request,
        token,
        `qa-lock-034-${stamp}`,
      )

      // 3. Advance updated_at out-of-band via a header-less PUT.
      const bump = await putPreferences(page.request, token, {
        ...EMPTY_SETTINGS,
        groupOrder: [`qa-lock-034-bumped-${stamp}`],
      })
      expect(bump.status(), 'out-of-band PUT should succeed').toBeLessThan(300)

      // 4. Replay the now-stale write with the original expected-version → 409.
      const conflict = await putWithLock(
        page.request,
        token,
        PREFERENCES_API,
        { ...EMPTY_SETTINGS, groupOrder: [`qa-lock-034-stale-${stamp}`] },
        staleUpdatedAt,
      )
      const body = await expectConflictBody(conflict)
      expect(
        body.currentUpdatedAt ?? (body as { currentUpdatedAt?: string }).currentUpdatedAt,
        'conflict body should report a current version',
      ).toBeTruthy()
    } finally {
      // Restore the singleton to an empty baseline with a fresh lock token.
      const current = await readPreferencesUpdatedAt(page.request, token).catch(() => undefined)
      await putPreferences(
        page.request,
        token,
        { ...EMPTY_SETTINGS },
        current ?? undefined,
      ).catch(() => undefined)
    }
  })

  test('AUTH-08 matching-version sidebar-preferences PUT is accepted (no false-positive 409)', async ({ page }) => {
    const token = await getAuthToken(page.request, 'admin')
    const stamp = Date.now()
    try {
      const currentUpdatedAt = await establishPreferencesVersion(
        page.request,
        token,
        `qa-lock-034b-${stamp}`,
      )

      // Same expected-version header → clean save, must NOT 409.
      const accepted = await putWithLock(
        page.request,
        token,
        PREFERENCES_API,
        { ...EMPTY_SETTINGS, groupOrder: [`qa-lock-034b-saved-${stamp}`] },
        currentUpdatedAt,
      )
      expect(accepted.status(), 'matching-version PUT should not 409').toBeLessThan(400)
    } finally {
      const current = await readPreferencesUpdatedAt(page.request, token).catch(() => undefined)
      await putPreferences(
        page.request,
        token,
        { ...EMPTY_SETTINGS },
        current ?? undefined,
      ).catch(() => undefined)
    }
  })
})
