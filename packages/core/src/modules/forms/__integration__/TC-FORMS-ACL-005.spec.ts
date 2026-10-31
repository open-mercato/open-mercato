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
 * TC-FORMS-ACL-005: `forms.view` alone reads but cannot author.
 *
 * The role is created fresh rather than by mutating the seeded `admin` role —
 * `workers: 1` removes parallelism but not shared state, and a mutated seed role
 * leaks into every later spec in the shard.
 */
test.describe('TC-FORMS-ACL-005: forms.view cannot create or edit', () => {
  test('grants the list read and denies create and patch', async ({ request }) => {
    test.slow()

    const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`
    const email = `qa-forms-acl005-${stamp}@test.local`
    const password = `Password${stamp}!`

    let adminToken: string | null = null
    let roleId: string | null = null
    let userId: string | null = null
    let formId: string | null = null

    try {
      adminToken = await getAuthToken(request, 'admin')
      const { organizationId } = getTokenContext(adminToken)
      expect(organizationId, 'admin token should carry an organization id').toBeTruthy()

      const form = await createFormFixture(request, adminToken, { name: `QA ACL005 ${stamp}` })
      formId = form.id

      roleId = await createRoleFixture(request, adminToken, { name: `QA Forms View Only ${stamp}` })
      await setRoleAclFeatures(request, adminToken, { roleId, features: ['forms.view'] })
      userId = await createUserFixture(request, adminToken, {
        email,
        password,
        organizationId,
        roles: [roleId],
      })

      const viewerToken = await getAuthToken(request, email, password)

      const listRes = await apiRequest(request, 'GET', '/api/forms', { token: viewerToken })
      expect(listRes.status(), 'forms.view grants the list read').toBe(200)

      const detailRes = await apiRequest(request, 'GET', `/api/forms/${formId}`, { token: viewerToken })
      expect(detailRes.status(), 'forms.view grants the detail read').toBe(200)

      const createRes = await apiRequest(request, 'POST', '/api/forms', {
        token: viewerToken,
        data: {
          key: `qa_acl005_denied_${randomUUID().slice(0, 8)}`,
          name: 'should never exist',
          defaultLocale: 'en',
          supportedLocales: ['en'],
        },
      })
      expect(createRes.status(), 'creating requires forms.design, so forms.view is denied').toBe(403)

      const patchRes = await apiRequest(request, 'PATCH', `/api/forms/${formId}`, {
        token: viewerToken,
        data: { name: 'should never persist' },
      })
      expect(patchRes.status(), 'patching requires forms.design').toBe(403)

      const deleteRes = await apiRequest(request, 'DELETE', `/api/forms/${formId}`, { token: viewerToken })
      expect(deleteRes.status(), 'archiving requires forms.design').toBe(403)

      // The denials were real, not silent no-ops that returned 403 after writing.
      const afterRes = await apiRequest(request, 'GET', `/api/forms/${formId}`, { token: adminToken })
      const after = await afterRes.json()
      expect(after.name, 'the denied patch did not change the name').toBe(`QA ACL005 ${stamp}`)
      expect(after.status, 'the denied delete did not archive the form').toBe('draft')
    } finally {
      await deleteUserIfExists(request, adminToken, userId)
      await deleteRoleIfExists(request, adminToken, roleId)
      await deleteFormIfExists(request, adminToken, formId)
    }
  })
})
