import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createFormFixture,
  deleteFormIfExists,
} from '@open-mercato/core/helpers/integration/formsFixtures'

/**
 * TC-FORMS-ACL-006: a signed-in staff user holding no forms feature is denied
 * every admin route.
 *
 * `setup.ts` grants the six forms features to `admin` only — no `employee` row —
 * so "authenticated" must never imply "authorized" on any of these paths.
 */
test.describe('TC-FORMS-ACL-006: no forms feature denies every admin route', () => {
  test('denies list, detail, submissions, analytics, distributions and versions', async ({ request }) => {
    test.slow()

    const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`
    const email = `qa-forms-acl006-${stamp}@test.local`
    const password = `Password${stamp}!`

    let adminToken: string | null = null
    let roleId: string | null = null
    let userId: string | null = null
    let formId: string | null = null

    try {
      adminToken = await getAuthToken(request, 'admin')
      const { organizationId } = getTokenContext(adminToken)

      const form = await createFormFixture(request, adminToken, { name: `QA ACL006 ${stamp}` })
      formId = form.id

      // A role with zero features — not merely without forms features.
      roleId = await createRoleFixture(request, adminToken, { name: `QA Forms No Features ${stamp}` })
      await setRoleAclFeatures(request, adminToken, { roleId, features: [] })
      userId = await createUserFixture(request, adminToken, {
        email,
        password,
        organizationId,
        roles: [roleId],
      })

      const deniedToken = await getAuthToken(request, email, password)

      const denied: Array<{ method: string; path: string }> = [
        { method: 'GET', path: '/api/forms' },
        { method: 'GET', path: `/api/forms/${formId}` },
        { method: 'GET', path: `/api/forms/${formId}/submissions` },
        { method: 'GET', path: `/api/forms/${formId}/analytics` },
        { method: 'GET', path: `/api/forms/${formId}/distributions` },
        { method: 'POST', path: `/api/forms/${formId}/versions/fork` },
      ]

      for (const route of denied) {
        const response = await apiRequest(request, route.method, route.path, {
          token: deniedToken,
          data: route.method === 'POST' ? {} : undefined,
        })
        expect(
          response.status(),
          `${route.method} ${route.path} must be 403 without any forms feature (got ${response.status()})`,
        ).toBe(403)
      }
    } finally {
      await deleteUserIfExists(request, adminToken, userId)
      await deleteRoleIfExists(request, adminToken, roleId)
      await deleteFormIfExists(request, adminToken, formId)
    }
  })
})
