import { test, expect, type APIRequestContext } from '@playwright/test'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { createDictionaryFixture } from '@open-mercato/core/modules/core/__integration__/helpers/dictionariesFixtures'
import {
  expectConflictBody,
  expectConflictBanner,
  expectNoConflictBanner,
  resolveApiUrl,
} from '@open-mercato/core/modules/core/__integration__/helpers/optimisticLockUi'
import { fillControlledInput } from '@open-mercato/core/modules/core/__integration__/helpers/ui'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

/**
 * TC-LOCK-OSS-041 — feature_toggles + dictionaries optimistic-lock conflict bar.
 *
 * Surfaces under test:
 *  - FT-01 (browser): the per-tenant feature-toggle override card
 *    (`/backend/feature-toggles/global/<id>`) is a `CrudForm` that submits the
 *    override PUT with an optimistic-lock header and routes a 409 to the unified
 *    "Record changed" conflict bar. A stale override edit must surface the bar;
 *    a clean single-tab save must not.
 *  - DICT-01 / DICT-02 (API-level fallback): the dictionary (`PATCH
 *    /api/dictionaries/<id>`) and dictionary-entry (`PATCH
 *    /api/dictionaries/<id>/entries/<entryId>`) routes guard writes with
 *    `enforceCommandOptimisticLock`. These surfaces are edited through the
 *    Dictionaries manager dialogs (no dedicated `data-crud-field-id` edit page),
 *    so the conflict contract is proven at the API level with a stale
 *    `expectedUpdatedAt` header → 409 `optimistic_lock_conflict`.
 *
 * Pattern (per `optimisticLockUi.ts`): capture the record's `updated_at`,
 * advance it out-of-band via a header-less write, then replay the now-stale
 * write to trigger the 409 → conflict bar.
 *
 * The admin user is NOT a super administrator, so the GLOBAL toggle edit page
 * (`feature_toggles.global.manage`) is intentionally not exercised here — the
 * reachable browser conflict surface for a tenant admin is the override card
 * (`feature_toggles.manage`).
 */

const FT_OVERRIDES_API = '/api/feature_toggles/overrides'

type SeededStringToggle = { id: string; identifier: string }

async function findStringToggle(
  request: APIRequestContext,
  token: string,
): Promise<SeededStringToggle> {
  const response = await apiRequest(
    request,
    'GET',
    '/api/feature_toggles/global?type=string&pageSize=200',
    { token },
  )
  expect(response.status(), 'GET feature toggles should be 200').toBe(200)
  const body = (await response.json()) as { items?: Array<{ id?: string; identifier?: string; type?: string }> }
  const toggle = (body.items ?? []).find((item) => item.type === 'string' && typeof item.id === 'string')
  expect(toggle, 'a seeded string-typed feature toggle should exist').toBeTruthy()
  return { id: toggle!.id as string, identifier: toggle!.identifier ?? '' }
}

async function readOverrideUpdatedAt(
  request: APIRequestContext,
  token: string,
  toggleId: string,
): Promise<string | null> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/feature_toggles/global/${toggleId}/override`,
    { token },
  )
  expect(response.status(), 'GET override should be 200').toBe(200)
  const body = (await response.json()) as { updatedAt?: string | null }
  return body.updatedAt ?? null
}

async function setOverride(
  request: APIRequestContext,
  token: string,
  toggleId: string,
  isOverride: boolean,
  overrideValue?: unknown,
): Promise<void> {
  const response = await apiRequest(request, 'PUT', FT_OVERRIDES_API, {
    token,
    data: { toggleId, isOverride, overrideValue },
  })
  expect(response.status(), 'override PUT should succeed').toBeLessThan(300)
}

async function patchWithLock(
  request: APIRequestContext,
  token: string,
  path: string,
  body: Record<string, unknown>,
  lockValue: string,
) {
  return request.fetch(resolveApiUrl(path), {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      [OPTIMISTIC_LOCK_HEADER_NAME]: lockValue,
    },
    data: body,
  })
}

async function patchHeaderless(
  request: APIRequestContext,
  token: string,
  path: string,
  body: Record<string, unknown>,
): Promise<void> {
  const response = await apiRequest(request, 'PATCH', path, { token, data: body })
  expect(
    response.status(),
    `out-of-band PATCH ${path} should succeed (additive path), got ${response.status()}`,
  ).toBeLessThan(300)
}

test.describe('TC-LOCK-OSS-041: feature toggle override + dictionary optimistic-lock', () => {
  test('FT-01 stale feature-toggle override edit shows the conflict bar', async ({ page }) => {
    const token = await getAuthToken(page.request, 'admin')
    const stamp = Date.now()
    const toggle = await findStringToggle(page.request, token)
    try {
      // Ensure an override row exists so the form's lock check is active and the
      // override exposes a real `updatedAt`.
      await setOverride(page.request, token, toggle.id, true, `seed ${stamp}`)
      const overrideUpdatedAt = await readOverrideUpdatedAt(page.request, token, toggle.id)
      expect(typeof overrideUpdatedAt, 'override should expose updatedAt after first set').toBe('string')

      await login(page, 'admin')
      await page.goto(`/backend/feature-toggles/global/${toggle.id}`)

      // The override card's CrudForm captures `updatedAt` at load. The string
      // override value renders as a plain text input inside the custom field.
      const valueInput = page.locator('[data-crud-field-id="overrideValue"] input').first()
      await expect(valueInput).toBeVisible({ timeout: 10_000 })

      // Advance the override's `updated_at` out-of-band → the form now holds a
      // stale token.
      await setOverride(page.request, token, toggle.id, true, `bumped ${stamp}`)

      // Edit + save in the browser → stale header → 409 → conflict bar. The
      // override card is an embedded CrudForm with an explicit submit button.
      await fillControlledInput(valueInput, `stale ${stamp}`)
      await page.getByRole('button', { name: /save override/i }).click()

      await expectConflictBanner(page)
    } finally {
      await setOverride(page.request, token, toggle.id, false).catch(() => undefined)
    }
  })

  test('FT-01 clean single-tab override save does not raise a false-positive conflict bar', async ({ page }) => {
    const token = await getAuthToken(page.request, 'admin')
    const stamp = Date.now()
    const toggle = await findStringToggle(page.request, token)
    try {
      await setOverride(page.request, token, toggle.id, true, `seed ${stamp}`)

      await login(page, 'admin')
      await page.goto(`/backend/feature-toggles/global/${toggle.id}`)

      const valueInput = page.locator('[data-crud-field-id="overrideValue"] input').first()
      await expect(valueInput).toBeVisible({ timeout: 10_000 })

      const putPromise = page.waitForResponse(
        (response) =>
          response.request().method() === 'PUT' && response.url().includes(FT_OVERRIDES_API),
        { timeout: 10_000 },
      )
      await fillControlledInput(valueInput, `clean ${stamp}`)
      await page.getByRole('button', { name: /save override/i }).click()
      const settled = await putPromise
      expect(settled.status(), 'clean override save should not 409').toBeLessThan(400)
      await expectNoConflictBanner(page)
    } finally {
      await setOverride(page.request, token, toggle.id, false).catch(() => undefined)
    }
  })

  test('DICT-01 stale dictionary edit is refused with a 409 conflict (API fallback)', async ({ page }) => {
    const token = await getAuthToken(page.request, 'admin')
    const stamp = Date.now()
    let dictionaryId: string | null = null
    try {
      dictionaryId = await createDictionaryFixture(page.request, token, {
        key: `qa_lock_041_${stamp}`,
        name: `QA Lock 041 ${stamp}`,
      })

      const detail = await apiRequest(page.request, 'GET', `/api/dictionaries/${dictionaryId}`, { token })
      expect(detail.status(), 'GET dictionary should be 200').toBe(200)
      const before = (await detail.json()) as { updatedAt?: string }
      const staleUpdatedAt = before.updatedAt
      expect(typeof staleUpdatedAt, 'dictionary should expose updatedAt').toBe('string')

      // Advance `updated_at` out-of-band via a header-less PATCH.
      await patchHeaderless(page.request, token, `/api/dictionaries/${dictionaryId}`, {
        name: `QA Lock 041 bumped ${stamp}`,
      })

      // Replay the now-stale write with the original token → 409.
      const conflict = await patchWithLock(
        page.request,
        token,
        `/api/dictionaries/${dictionaryId}`,
        { name: `QA Lock 041 stale ${stamp}` },
        staleUpdatedAt as string,
      )
      await expectConflictBody(conflict)
    } finally {
      if (dictionaryId) {
        await apiRequest(page.request, 'DELETE', `/api/dictionaries/${dictionaryId}`, { token }).catch(
          () => undefined,
        )
      }
    }
  })

  test('DICT-02 stale dictionary-entry edit is refused with a 409 conflict (API fallback)', async ({ page }) => {
    const token = await getAuthToken(page.request, 'admin')
    const stamp = Date.now()
    let dictionaryId: string | null = null
    let entryId: string | null = null
    try {
      dictionaryId = await createDictionaryFixture(page.request, token, {
        key: `qa_lock_041e_${stamp}`,
        name: `QA Lock 041 Entry ${stamp}`,
      })

      const created = await apiRequest(
        page.request,
        'POST',
        `/api/dictionaries/${dictionaryId}/entries`,
        { token, data: { value: `val_${stamp}`, label: `Label ${stamp}` } },
      )
      expect(created.status(), 'POST entry should be 201').toBe(201)
      const entry = (await created.json()) as { id?: string; updatedAt?: string }
      entryId = entry.id ?? null
      const staleUpdatedAt = entry.updatedAt
      expect(typeof entryId, 'entry creation should return an id').toBe('string')
      expect(typeof staleUpdatedAt, 'entry should expose updatedAt').toBe('string')

      // Advance the entry's `updated_at` out-of-band via a header-less PATCH.
      await patchHeaderless(
        page.request,
        token,
        `/api/dictionaries/${dictionaryId}/entries/${entryId}`,
        { label: `Label bumped ${stamp}` },
      )

      // Replay the now-stale write → 409.
      const conflict = await patchWithLock(
        page.request,
        token,
        `/api/dictionaries/${dictionaryId}/entries/${entryId}`,
        { label: `Label stale ${stamp}` },
        staleUpdatedAt as string,
      )
      await expectConflictBody(conflict)
    } finally {
      if (dictionaryId && entryId) {
        await apiRequest(
          page.request,
          'DELETE',
          `/api/dictionaries/${dictionaryId}/entries/${entryId}`,
          { token },
        ).catch(() => undefined)
      }
      if (dictionaryId) {
        await apiRequest(page.request, 'DELETE', `/api/dictionaries/${dictionaryId}`, { token }).catch(
          () => undefined,
        )
      }
    }
  })
})
