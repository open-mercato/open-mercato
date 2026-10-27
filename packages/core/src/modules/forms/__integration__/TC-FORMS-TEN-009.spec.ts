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
 * TC-FORMS-TEN-009: mutating a form in another organization is a 404, and the
 * row is provably untouched afterwards.
 *
 * The status assertion alone is not enough here. A route could answer 404 from a
 * post-write guard and still have written; re-reading from inside the owning
 * organization is what proves nothing changed.
 *
 * ENVIRONMENT: mixes API and DB fixtures — needs the standard harness where the
 * app and the fixtures share a database.
 */
test.describe('TC-FORMS-TEN-009: cross-organization form mutation', () => {
  test('refuses a foreign patch and delete, leaving the row unchanged', async ({ request }) => {
    test.slow()

    const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`
    const originalName = `QA TEN009 foreign ${stamp}`

    let adminToken: string | null = null
    let otherOrgId: string | null = null
    let foreignFormId: string | null = null

    try {
      adminToken = await getAuthToken(request, 'admin')
      const { tenantId } = getTokenContext(adminToken)
      otherOrgId = await createOrganizationInDb({ name: `QA Forms TEN009 Org ${stamp}`, tenantId })

      const foreign = await createFormFixture(request, adminToken, {
        name: originalName,
        selectedOrgId: otherOrgId,
      })
      foreignFormId = foreign.id

      const patchRes = await apiRequest(request, 'PATCH', `/api/forms/${foreignFormId}`, {
        token: adminToken,
        data: { name: 'cross-organization rename attempt' },
      })
      expect(patchRes.status(), 'a cross-organization patch must read as not-found').toBe(404)
      expect((await readJsonSafe<{ error?: string }>(patchRes))?.error).toBe('forms.errors.form_not_found')

      const deleteRes = await apiRequest(request, 'DELETE', `/api/forms/${foreignFormId}`, { token: adminToken })
      expect(deleteRes.status(), 'a cross-organization delete must read as not-found').toBe(404)
      expect((await readJsonSafe<{ error?: string }>(deleteRes))?.error).toBe('forms.errors.form_not_found')

      const forkRes = await apiRequest(request, 'POST', `/api/forms/${foreignFormId}/versions/fork`, {
        token: adminToken,
        data: {},
      })
      expect(forkRes.status(), 'forking a foreign form must read as not-found').toBe(404)

      // The write attempts were rejected, not merely reported as rejected.
      const ownerRead = await apiRequestWithSelectedOrg(request, 'GET', `/api/forms/${foreignFormId}`, {
        token: adminToken,
        selectedOrgId: otherOrgId,
      })
      expect(ownerRead.status(), 'the owning organization can still read the form').toBe(200)
      const owned = await readJsonSafe<{ name?: string; status?: string; versions?: unknown[] }>(ownerRead)
      expect(owned?.name, 'the denied patch did not rename the foreign form').toBe(originalName)
      expect(owned?.status, 'the denied delete did not archive the foreign form').toBe('draft')
      expect(owned?.versions?.length ?? 0, 'the denied fork created no version').toBe(0)
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
