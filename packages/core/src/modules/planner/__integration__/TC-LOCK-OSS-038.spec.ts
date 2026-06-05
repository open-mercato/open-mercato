import { test, expect } from '@playwright/test'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  createAvailabilityRuleSetFixture,
  deleteAvailabilityRuleSetIfExists,
  createAvailabilityRuleFixture,
  deleteAvailabilityRuleIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/plannerFixtures'
import {
  bumpRecordViaApi,
  expectConflictBanner,
  putWithLock,
  expectConflictBody,
  readUpdatedAt,
} from '@open-mercato/core/modules/core/__integration__/helpers/optimisticLockUi'
import { fillControlledInput } from '@open-mercato/core/modules/core/__integration__/helpers/ui'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'

/**
 * TC-LOCK-OSS-038 (browser + API) — manual cases PLN-01 / PLN-02.
 *
 * PLN-01 (browser): the planner availability *rule set* edit route
 * `/backend/planner/availability-rulesets/<id>` renders `AvailabilityRuleSetForm`
 * (a `CrudForm` that forwards `optimisticLockUpdatedAt`). A stale edit must
 * surface the unified "Record changed" conflict bar instead of silently
 * overwriting. Pattern: load the edit page (form captures `updated_at`) →
 * advance `updated_at` out-of-band via a header-less API PUT → edit + save in
 * the browser (now-stale header → 409 → conflict bar). Submit via Control+Enter.
 *
 * PLN-02 (API): per-rule availability has no simple edit page (it lives behind
 * the `AvailabilityRulesEditor` tab), so the lock contract is proven at the API
 * level: a header-carrying PUT against `/api/planner/availability` with a stale
 * `updated_at` token must be refused with the 409 optimistic-lock conflict body.
 *
 * PLN-03 (browser + API, regression for issue #6 / Alina A1): deleting a stale
 * rule set from the edit page must NOT show a green "Record deleted" success
 * toast. The page `handleDelete` previously swallowed the 409 and flashed an
 * error, which let `CrudForm` treat the delete as successful and fire its
 * `deleteSuccess` toast even though the record was kept. The fix lets the 409
 * propagate so `CrudForm` surfaces the unified conflict bar and skips the toast.
 * API-level assertion (PLN-03 API) also proves the server refuses a stale DELETE
 * with the 409 optimistic-lock conflict body the false toast was masking.
 *
 * See `packages/core/src/modules/sales/__integration__/__concurrent_edit_pattern.md`.
 */

const RULE_SET_API = '/api/planner/availability-rule-sets'
const AVAILABILITY_API = '/api/planner/availability'

test.describe('TC-LOCK-OSS-038: planner availability lock (rule set + per-rule)', () => {
  test('PLN-01: stale availability rule set edit shows the conflict bar', async ({ page }) => {
    const token = await getAuthToken(page.request, 'admin')
    const stamp = Date.now()
    let ruleSetId: string | null = null
    try {
      ruleSetId = await createAvailabilityRuleSetFixture(page.request, token, {
        name: `QA Lock 038 ${stamp}`,
        timezone: 'UTC',
      })

      await login(page, 'admin')
      await page.goto(`/backend/planner/availability-rulesets/${ruleSetId}`)

      // Details form is loaded → its optimistic-lock token is captured at load time.
      const nameInput = page.locator('[data-crud-field-id="name"] input').first()
      await expect(nameInput).toBeVisible({ timeout: 15_000 })
      await expect(nameInput).toHaveValue(`QA Lock 038 ${stamp}`, { timeout: 10_000 })

      // Advance updated_at out-of-band → the browser form now holds a stale token.
      await bumpRecordViaApi(page.request, token, RULE_SET_API, {
        id: ruleSetId,
        name: `QA Lock 038 bumped ${stamp}`,
        timezone: 'UTC',
      })

      // Edit + save in the browser → stale header → 409 → conflict bar.
      await fillControlledInput(nameInput, `QA Lock 038 stale ${stamp}`)
      await nameInput.press('Control+Enter')

      await expectConflictBanner(page)
    } finally {
      await deleteAvailabilityRuleSetIfExists(page.request, token, ruleSetId)
    }
  })

  test('PLN-03 (API): stale rule set DELETE is refused with a 409 conflict body', async ({ page }) => {
    const token = await getAuthToken(page.request, 'admin')
    const stamp = Date.now()
    let ruleSetId: string | null = null
    try {
      ruleSetId = await createAvailabilityRuleSetFixture(page.request, token, {
        name: `QA Lock 038 PLN03 ${stamp}`,
        timezone: 'UTC',
      })

      const currentUpdatedAt = await readUpdatedAt(page.request, token, RULE_SET_API, ruleSetId)
      const staleIso = new Date(Date.parse(currentUpdatedAt) - 60_000).toISOString()

      // A header-carrying DELETE with a deliberately stale token must 409 and
      // must NOT remove the record (the false-success toast masked this refusal).
      const staleDelete = await page.request.fetch(
        `${RULE_SET_API}?id=${encodeURIComponent(ruleSetId)}`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            [OPTIMISTIC_LOCK_HEADER_NAME]: staleIso,
          },
        },
      )
      await expectConflictBody(staleDelete)

      // The record must still exist after the refused stale delete.
      const stillThere = await apiRequest(
        page.request,
        'GET',
        `${RULE_SET_API}?page=1&pageSize=1&ids=${encodeURIComponent(ruleSetId)}`,
        { token },
      )
      expect(stillThere.status()).toBe(200)
      const body = await readJsonSafe<{ items?: Array<{ id?: string }> }>(stillThere)
      expect(body?.items?.some((item) => item.id === ruleSetId)).toBe(true)
    } finally {
      await deleteAvailabilityRuleSetIfExists(page.request, token, ruleSetId)
    }
  })

  test('PLN-03b (browser): stale rule set delete shows the conflict bar, not a success toast', async ({ page }) => {
    const token = await getAuthToken(page.request, 'admin')
    const stamp = Date.now()
    let ruleSetId: string | null = null
    try {
      ruleSetId = await createAvailabilityRuleSetFixture(page.request, token, {
        name: `QA Lock 038 PLN03b ${stamp}`,
        timezone: 'UTC',
      })

      await login(page, 'admin')
      await page.goto(`/backend/planner/availability-rulesets/${ruleSetId}`)

      // Details form is loaded → its optimistic-lock token is captured at load time.
      const nameInput = page.locator('[data-crud-field-id="name"] input').first()
      await expect(nameInput).toBeVisible({ timeout: 15_000 })
      await expect(nameInput).toHaveValue(`QA Lock 038 PLN03b ${stamp}`, { timeout: 10_000 })

      // Advance updated_at out-of-band → the browser form now holds a stale token.
      await bumpRecordViaApi(page.request, token, RULE_SET_API, {
        id: ruleSetId,
        name: `QA Lock 038 PLN03b bumped ${stamp}`,
        timezone: 'UTC',
      })

      // Delete in the browser → stale header → 409. The conflict bar must appear
      // and the green "Record deleted" success toast must NOT.
      await page.getByRole('button', { name: 'Delete', exact: true }).click()
      await page.getByRole('alertdialog').getByRole('button', { name: 'Confirm' }).click()

      await expectConflictBanner(page)
      await expect(
        page.getByText('Record deleted', { exact: true }),
        'a refused stale delete must not show the success toast',
      ).toHaveCount(0)

      // The record must still exist after the refused stale delete.
      const stillThere = await apiRequest(
        page.request,
        'GET',
        `${RULE_SET_API}?page=1&pageSize=1&ids=${encodeURIComponent(ruleSetId)}`,
        { token },
      )
      expect(stillThere.status()).toBe(200)
      const body = await readJsonSafe<{ items?: Array<{ id?: string }> }>(stillThere)
      expect(body?.items?.some((item) => item.id === ruleSetId)).toBe(true)
    } finally {
      await deleteAvailabilityRuleSetIfExists(page.request, token, ruleSetId)
    }
  })

  test('PLN-02: stale per-rule availability write is refused with a 409 conflict body', async ({ page }) => {
    const token = await getAuthToken(page.request, 'admin')
    const stamp = Date.now()
    let ruleSetId: string | null = null
    let ruleId: string | null = null
    try {
      ruleSetId = await createAvailabilityRuleSetFixture(page.request, token, {
        name: `QA Lock 038 PLN02 ${stamp}`,
        timezone: 'UTC',
      })
      ruleId = await createAvailabilityRuleFixture(page.request, token, {
        subjectType: 'ruleset',
        subjectId: ruleSetId,
        timezone: 'UTC',
        rrule: 'DTSTART:20260601T090000Z\nDURATION:PT8H\nRRULE:FREQ=WEEKLY;BYDAY=MO',
        kind: 'availability',
        note: `QA Lock 038 PLN02 ${stamp}`,
      })

      // Read the rule's current updated_at (list is filtered by subject).
      const listResponse = await apiRequest(
        page.request,
        'GET',
        `${AVAILABILITY_API}?subjectType=ruleset&subjectIds=${encodeURIComponent(ruleSetId)}`,
        { token },
      )
      expect(listResponse.status(), 'GET /api/planner/availability should return 200').toBe(200)
      const listBody = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(listResponse)
      const rule = listBody?.items?.find((item) => item.id === ruleId)
      expect(rule, 'created availability rule should be listed for its subject').toBeTruthy()
      const currentUpdatedAt = (rule?.updated_at ?? rule?.updatedAt) as string | undefined
      expect(typeof currentUpdatedAt, 'availability rule should expose updated_at').toBe('string')

      // A header-carrying PUT with a deliberately stale token must 409.
      const staleIso = new Date(Date.parse(currentUpdatedAt as string) - 60_000).toISOString()
      const staleResponse = await putWithLock(
        page.request,
        token,
        AVAILABILITY_API,
        { id: ruleId, note: `QA Lock 038 PLN02 stale ${stamp}` },
        staleIso,
      )
      await expectConflictBody(staleResponse)
    } finally {
      await deleteAvailabilityRuleIfExists(page.request, token, ruleId)
      await deleteAvailabilityRuleSetIfExists(page.request, token, ruleSetId)
    }
  })
})
