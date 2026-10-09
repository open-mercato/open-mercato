import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { apiRequestWithSelectedOrg } from '@open-mercato/core/helpers/integration/authFixtures'
import {
  createOrganizationInDb,
  deleteOrganizationInDb,
} from '@open-mercato/core/helpers/integration/dbFixtures'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { createFormFixture } from '@open-mercato/core/helpers/integration/formsFixtures'

/**
 * TC-FORMS-TEN-008: reading a form that lives in another organization is a 404,
 * never a 403 and never a 200.
 *
 * Every forms admin route narrows on the single `organizationId` the request
 * resolves to (`scope.selectedId ?? auth.orgId`), so a form created under a
 * different `om_selected_org` is outside the caller's scope. 404 rather than 403
 * is the contract that matters: a 403 would confirm the id exists somewhere.
 *
 * The second organization is created via raw SQL because the directory create
 * command routes through `enforceTenantSelection`, which denies the only
 * loginable non-super-admin accounts on a `mercato init` instance.
 *
 * ENVIRONMENT: this spec mixes API and DB fixtures, so it needs the app and the
 * fixtures to share one database — the standard integration harness, not an
 * arbitrary dev server whose `DATABASE_URL` differs.
 */
test.describe('TC-FORMS-TEN-008: cross-organization form read', () => {
  test('answers 404 for a foreign form id and stays indistinguishable from a missing one', async ({ request }) => {
    test.slow()

    const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`
    let adminToken: string | null = null
    let otherOrgId: string | null = null
    let foreignFormId: string | null = null

    try {
      adminToken = await getAuthToken(request, 'admin')
      const { tenantId } = getTokenContext(adminToken)
      expect(tenantId, 'admin token should carry a tenant id').toBeTruthy()

      otherOrgId = await createOrganizationInDb({ name: `QA Forms TEN008 Org ${stamp}`, tenantId })

      // The `om_selected_org` cookie places the form in the other organization.
      const foreign = await createFormFixture(request, adminToken, {
        name: `QA TEN008 foreign ${stamp}`,
        selectedOrgId: otherOrgId,
      })
      foreignFormId = foreign.id

      // Sanity: the form really is reachable from inside its own organization,
      // so a later 404 proves scoping rather than a broken fixture.
      const inScope = await apiRequestWithSelectedOrg(request, 'GET', `/api/forms/${foreignFormId}`, {
        token: adminToken,
        selectedOrgId: otherOrgId,
      })
      expect(inScope.status(), 'the foreign form is readable from inside its own organization').toBe(200)

      const crossOrg = await apiRequest(request, 'GET', `/api/forms/${foreignFormId}`, { token: adminToken })
      expect(crossOrg.status(), 'a foreign-organization form must read as not-found').toBe(404)
      const crossBody = await readJsonSafe<{ error?: string }>(crossOrg)
      expect(crossBody?.error, 'the 404 body must not leak that the id exists').toBe('forms.errors.form_not_found')

      // Indistinguishable from an id that does not exist at all.
      const missing = await apiRequest(request, 'GET', `/api/forms/${randomUUID()}`, { token: adminToken })
      expect(missing.status(), 'a nonexistent id answers the same status').toBe(crossOrg.status())
      expect(await readJsonSafe(missing), 'a nonexistent id answers the same body').toEqual(crossBody)

      // The foreign form is also absent from the caller's list projection.
      const listRes = await apiRequest(
        request,
        'GET',
        `/api/forms?q=${encodeURIComponent(stamp)}&pageSize=100`,
        { token: adminToken },
      )
      const list = await readJsonSafe<{ items?: Array<{ id: string }> }>(listRes)
      expect(
        (list?.items ?? []).some((item) => item.id === foreignFormId),
        'the foreign form must not appear in the caller organization list',
      ).toBe(false)
    } finally {
      if (adminToken && foreignFormId && otherOrgId) {
        await apiRequestWithSelectedOrg(request, 'DELETE', `/api/forms/${foreignFormId}`, {
          token: adminToken,
          selectedOrgId: otherOrgId,
        }).catch(() => undefined)
      }
      await deleteOrganizationInDb(otherOrgId).catch(() => undefined)
    }
  })
})
