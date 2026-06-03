import { test, expect } from '@playwright/test'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { getTokenScope } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  createBusinessRuleFixture,
  deleteBusinessRuleIfExists,
  createRuleSetFixture,
  deleteRuleSetIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/businessRulesFixtures'
import {
  bumpRecordViaApi,
  expectConflictBanner,
  expectNoConflictBanner,
} from '@open-mercato/core/modules/core/__integration__/helpers/optimisticLockUi'
import { fillControlledInput } from '@open-mercato/core/modules/core/__integration__/helpers/ui'

/**
 * TC-LOCK-OSS-042 (browser UI) — manual cases BR-01 / BR-02.
 *
 * Browser-driven proof that a stale edit on the business-rule and rule-set
 * CrudForms surfaces the unified "Record changed" conflict bar instead of
 * silently overwriting, and that a clean single-tab save does NOT raise a
 * false-positive bar.
 *
 * Pattern: load the edit page (the form captures `updatedAt` from the instance
 * GET) → advance `updatedAt` out-of-band via a header-less API PUT (additive
 * path, always succeeds) → edit + save in the browser (the now-stale header →
 * 409 → conflict bar). See
 * `packages/core/src/modules/sales/__integration__/__concurrent_edit_pattern.md`.
 *
 * KNOWN PRODUCT GAP (PR #2055) — the two stale-edit tests are `test.fixme` until fixed:
 * the business_rules PUT routes are hand-rolled (NOT `makeCrudRoute`) and never read
 * `OPTIMISTIC_LOCK_HEADER_NAME` / compare `updated_at`, so a stale edit is silently
 * accepted (HTTP 200, no 409) and the conflict bar never appears — even though the edit
 * pages DO send `buildOptimisticLockHeader(...)`. Files to fix on #2055:
 *   - packages/core/src/modules/business_rules/api/rules/route.ts (PUT)
 *   - packages/core/src/modules/business_rules/api/sets/route.ts  (PUT)
 * They must adopt the optimistic-lock contract (return 409 + OPTIMISTIC_LOCK_CONFLICT_CODE
 * on a stale `updated_at`). Once the routes enforce the lock, remove the `.fixme` markers
 * below and the tests pass unchanged. The clean-save test stays active and proves the
 * fixtures/locators/routes are all correct.
 *
 * NOTE: the GET surfaces here are instance paths
 * (`/api/business_rules/{rules,sets}/<id>`), but the out-of-band bump targets
 * the collection PUT (`/api/business_rules/{rules,sets}`) with the id plus a
 * changed text field — that is all `bumpRecordViaApi` needs to advance the
 * record's `updatedAt`.
 */

test.describe('TC-LOCK-OSS-042: business rule + rule set edit optimistic-lock conflict bar', () => {
  // fixme: business_rules rules PUT route ignores the lock header (see header note).
  test.fixme('stale business rule edit shows the conflict bar; clean edit does not', async ({ page }) => {
    const token = await getAuthToken(page.request, 'admin')
    const scope = getTokenScope(token)
    const stamp = Date.now()
    let ruleId: string | null = null
    try {
      ruleId = await createBusinessRuleFixture(page.request, token, {
        ruleId: `QA_LOCK_042_${stamp}`,
        ruleName: `QA Lock 042 ${stamp}`,
        description: 'Optimistic-lock UI coverage',
        ruleType: 'GUARD',
        entityType: 'WorkOrder',
        eventType: 'beforeSave',
        conditionExpression: { field: 'status', operator: '=', value: 'ACTIVE' },
        successActions: null,
        failureActions: null,
        enabled: true,
        priority: 100,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      })

      await login(page, 'admin')
      await page.goto(`/backend/rules/${ruleId}`)

      // Form is loaded (its optimistic-lock token is now captured at load time).
      const nameInput = page.locator('[data-crud-field-id="ruleName"] input').first()
      await expect(nameInput).toBeVisible({ timeout: 10_000 })

      // Advance updatedAt out-of-band → the browser form now holds a stale token.
      await bumpRecordViaApi(page.request, token, '/api/business_rules/rules', {
        id: ruleId,
        ruleName: `QA Lock 042 bumped ${stamp}`,
      })

      // Edit + save in the browser → stale header → 409 → conflict bar.
      await fillControlledInput(nameInput, `QA Lock 042 stale ${stamp}`)
      await nameInput.press('Control+Enter')

      await expectConflictBanner(page)
    } finally {
      await deleteBusinessRuleIfExists(page.request, token, ruleId)
    }
  })

  test('clean single-tab business rule save does not raise a false-positive conflict bar', async ({ page }) => {
    const token = await getAuthToken(page.request, 'admin')
    const scope = getTokenScope(token)
    const stamp = Date.now()
    let ruleId: string | null = null
    try {
      ruleId = await createBusinessRuleFixture(page.request, token, {
        ruleId: `QA_LOCK_042B_${stamp}`,
        ruleName: `QA Lock 042b ${stamp}`,
        description: 'Optimistic-lock UI coverage',
        ruleType: 'GUARD',
        entityType: 'WorkOrder',
        eventType: 'beforeSave',
        conditionExpression: { field: 'status', operator: '=', value: 'ACTIVE' },
        successActions: null,
        failureActions: null,
        enabled: true,
        priority: 100,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      })

      await login(page, 'admin')
      await page.goto(`/backend/rules/${ruleId}`)

      const nameInput = page.locator('[data-crud-field-id="ruleName"] input').first()
      await expect(nameInput).toBeVisible({ timeout: 10_000 })

      const putPromise = page.waitForResponse(
        (r) => r.request().method() === 'PUT' && r.url().includes('/api/business_rules/rules'),
        { timeout: 10_000 },
      )
      await fillControlledInput(nameInput, `QA Lock 042b saved ${stamp}`)
      await nameInput.press('Control+Enter')
      const settled = await putPromise
      expect(settled.status(), 'clean save should not 409').toBeLessThan(400)
      await expectNoConflictBanner(page)
    } finally {
      await deleteBusinessRuleIfExists(page.request, token, ruleId)
    }
  })

  // fixme: business_rules sets PUT route ignores the lock header (see header note).
  test.fixme('stale rule set edit shows the conflict bar', async ({ page }) => {
    const token = await getAuthToken(page.request, 'admin')
    const scope = getTokenScope(token)
    const stamp = Date.now()
    let ruleSetId: string | null = null
    try {
      ruleSetId = await createRuleSetFixture(page.request, token, {
        setId: `qa-lock-042-${stamp}`,
        setName: `QA Lock Set 042 ${stamp}`,
        description: 'Optimistic-lock UI coverage',
        enabled: true,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      })

      await login(page, 'admin')
      await page.goto(`/backend/sets/${ruleSetId}`)

      const nameInput = page.locator('[data-crud-field-id="setName"] input').first()
      await expect(nameInput).toBeVisible({ timeout: 10_000 })

      await bumpRecordViaApi(page.request, token, '/api/business_rules/sets', {
        id: ruleSetId,
        setName: `QA Lock Set 042 bumped ${stamp}`,
      })

      await fillControlledInput(nameInput, `QA Lock Set 042 stale ${stamp}`)
      await nameInput.press('Control+Enter')

      await expectConflictBanner(page)
    } finally {
      await deleteRuleSetIfExists(page.request, token, ruleSetId)
    }
  })
})
