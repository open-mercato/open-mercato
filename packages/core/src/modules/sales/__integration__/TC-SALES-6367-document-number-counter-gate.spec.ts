import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

/**
 * TC-SALES-6367: repositioning the document-number counter requires `sales.documents.number.edit`.
 *
 * A role holding `sales.settings.manage` (as the seeded employee role does) could previously move
 * the order counter anywhere through the numbering settings, including below numbers already
 * issued, even though it is denied the narrower number-edit feature. It must still be able to
 * save the settings page when the counters it echoes back are unchanged.
 *
 * The denied attempt moves the counter forward, so a regression cannot hand later tests a number
 * that is already on a document.
 */

const SETTINGS_PATH = '/api/sales/settings/document-numbers'

type Settings = {
  orderNumberFormat: string
  quoteNumberFormat: string
  nextOrderNumber: number
  nextQuoteNumber: number
}

test.describe('TC-SALES-6367: document-number counter gate', () => {
  test('a settings manager without number-edit cannot move the counter but can re-save it', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const scope = getTokenScope(adminToken)
    const stamp = Date.now()
    const email = `qa-sales-numbering-${stamp}@acme.com`
    const password = `QaNumbering1!${stamp}`
    let roleId: string | null = null
    let userId: string | null = null

    try {
      roleId = await createRoleFixture(request, adminToken, {
        name: `QA Sales Numbering ${stamp}`,
        tenantId: scope.tenantId ?? undefined,
      })
      await setRoleAclFeatures(request, adminToken, { roleId, features: ['sales.settings.manage'] })
      userId = await createUserFixture(request, adminToken, {
        email,
        password,
        organizationId: scope.organizationId!,
        roles: [roleId],
        name: `QA Sales Numbering ${stamp}`,
      })
      const token = await getAuthToken(request, email, password)

      const read = async () => {
        const response = await apiRequest(request, 'GET', SETTINGS_PATH, { token })
        expect(response.status(), 'settings manager should read numbering settings').toBe(200)
        return (await readJsonSafe<Settings>(response))!
      }

      const save = (current: Settings, orderNextNumber: number) =>
        apiRequest(request, 'PUT', SETTINGS_PATH, {
          token,
          data: {
            orderNumberFormat: current.orderNumberFormat,
            quoteNumberFormat: current.quoteNumberFormat,
            orderNextNumber,
          },
        })

      const before = await read()
      const target = before.nextOrderNumber + 10_000
      const moved = await save(before, target)
      expect(moved.status(), 'moving the counter without sales.documents.number.edit should be 403').toBe(403)
      expect((await read()).nextOrderNumber, 'a refused save must not move the counter').toBeLessThan(target)

      const current = await read()
      const unchanged = await save(current, current.nextOrderNumber)
      expect(unchanged.status(), 're-saving an unchanged counter should succeed').toBe(200)
      expect((await read()).nextOrderNumber, 'an unchanged re-save must not rewind the counter').toBeGreaterThanOrEqual(
        current.nextOrderNumber,
      )
    } finally {
      if (userId) await deleteUserIfExists(request, adminToken, userId)
      if (roleId) await deleteRoleIfExists(request, adminToken, roleId)
    }
  })
})
