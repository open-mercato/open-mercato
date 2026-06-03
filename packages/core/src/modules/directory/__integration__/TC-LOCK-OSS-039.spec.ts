import { test, expect } from '@playwright/test'
import { login } from '@open-mercato/core/modules/core/__integration__/helpers/auth'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import {
  deleteGeneralEntityIfExists,
  getTokenContext,
} from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  bumpRecordViaApi,
  expectConflictBanner,
} from '@open-mercato/core/modules/core/__integration__/helpers/optimisticLockUi'
import { fillControlledInput } from '@open-mercato/core/modules/core/__integration__/helpers/ui'

/**
 * TC-LOCK-OSS-039 (browser UI) — manual cases DIR-01 / DIR-02.
 *
 * Browser-driven proof that a stale edit on the directory tenant and
 * organization CrudForms surfaces the unified "Record changed" conflict bar
 * (`data-testid="record-conflict-banner"`) instead of silently overwriting.
 *
 * Pattern (see `optimisticLockUi.ts`): load the edit page (the form captures
 * the record's `updated_at`) → advance `updated_at` out-of-band via a
 * header-less API PUT → edit + save in the browser so the now-stale header
 * triggers the 409 → conflict bar.
 *
 * Role note: tenant management requires `directory.tenants.manage`, which the
 * seeded tenant admin does NOT carry, so the tenant case runs as `superadmin`.
 * Organizations are tenant-scoped and the seeded admin manages its own tenant,
 * so the organization case runs as `admin`.
 */

const TENANTS_API = '/api/directory/tenants'
const ORGANIZATIONS_API = '/api/directory/organizations'

test.describe('TC-LOCK-OSS-039: directory edit optimistic-lock conflict bar', () => {
  test('stale tenant edit shows the conflict bar', async ({ page }) => {
    const token = await getAuthToken(page.request, 'superadmin')
    const stamp = Date.now()
    let tenantId: string | null = null
    try {
      const createResponse = await apiRequest(page.request, 'POST', TENANTS_API, {
        token,
        data: { name: `QA Lock 039 Tenant ${stamp}` },
      })
      expect(createResponse.status(), 'POST /api/directory/tenants should return 201').toBe(201)
      const created = (await createResponse.json()) as { id?: string }
      tenantId = created.id ?? null
      expect(tenantId, 'created tenant should have an id').toBeTruthy()

      await login(page, 'superadmin')
      await page.goto(`/backend/directory/tenants/${tenantId}/edit`)

      // Form is loaded; its optimistic-lock token is captured at load time.
      const nameInput = page.locator('[data-crud-field-id="name"] input').first()
      await expect(nameInput).toBeVisible({ timeout: 10_000 })

      // Advance updated_at out-of-band → the browser form now holds a stale token.
      await bumpRecordViaApi(page.request, token, TENANTS_API, {
        id: tenantId,
        name: `QA Lock 039 Tenant bumped ${stamp}`,
      })

      // Edit + save in the browser → stale header → 409 → conflict bar.
      await fillControlledInput(nameInput, `QA Lock 039 Tenant stale ${stamp}`)
      await nameInput.press('Control+Enter')

      await expectConflictBanner(page)
    } finally {
      await deleteGeneralEntityIfExists(page.request, token, TENANTS_API, tenantId)
    }
  })

  test('stale organization edit shows the conflict bar', async ({ page }) => {
    const token = await getAuthToken(page.request, 'admin')
    const { tenantId } = getTokenContext(token)
    expect(tenantId, 'admin token should carry a tenant id').toBeTruthy()
    const stamp = Date.now()
    let orgId: string | null = null
    try {
      const createResponse = await apiRequest(page.request, 'POST', ORGANIZATIONS_API, {
        token,
        data: { tenantId, name: `QA Lock 039 Org ${stamp}` },
      })
      expect(createResponse.status(), 'POST /api/directory/organizations should return 201').toBe(201)
      const created = (await createResponse.json()) as { id?: string }
      orgId = created.id ?? null
      expect(orgId, 'created organization should have an id').toBeTruthy()

      await login(page, 'admin')
      await page.goto(`/backend/directory/organizations/${orgId}/edit`)

      // Form is loaded; its optimistic-lock token is captured at load time.
      const nameInput = page.locator('[data-crud-field-id="name"] input').first()
      await expect(nameInput).toBeVisible({ timeout: 10_000 })

      // Advance updated_at out-of-band → the browser form now holds a stale token.
      await bumpRecordViaApi(page.request, token, ORGANIZATIONS_API, {
        id: orgId,
        name: `QA Lock 039 Org bumped ${stamp}`,
      })

      // Edit + save in the browser → stale header → 409 → conflict bar.
      await fillControlledInput(nameInput, `QA Lock 039 Org stale ${stamp}`)
      await nameInput.press('Control+Enter')

      await expectConflictBanner(page)
    } finally {
      await deleteGeneralEntityIfExists(page.request, token, ORGANIZATIONS_API, orgId)
    }
  })
})
