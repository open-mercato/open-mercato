import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  deleteSettingsRow,
  getXraySettings,
  putXraySettings,
  readSettingsRowExists,
  type XraySettingsBody,
} from './helpers/xrayApi'

/**
 * TC-INS-X06: Process X-Ray settings use optimistic locking
 * Covers:
 *   - GET /api/insights/xray/settings (defaults, then the stored version)
 *   - PUT /api/insights/xray/settings (create, update with the current version, stale version → 409, invalid → 400)
 *
 * The first save creates the organization's settings; each save returns a new `updatedAt`.
 * A save that sends an older `updatedAt` in the optimistic-lock header is refused with the
 * standard 409 `optimistic_lock_conflict` body and changes nothing. The k-anonymity floor
 * (5) is enforced, and per-person breakdowns stay off unless explicitly enabled.
 */
test.describe('TC-INS-X06: X-Ray settings optimistic lock', () => {
  test('rejects a save based on a stale version', async ({ request }) => {
    let token: string | null = null
    let tenantId: string | null = null
    let organizationId: string | null = null
    let createdRow = false
    let original: XraySettingsBody['result'] | null = null

    try {
      token = await getAuthToken(request, 'admin')
      const scope = getTokenScope(token)
      tenantId = scope.tenantId
      organizationId = scope.organizationId
      createdRow = !(await readSettingsRowExists(tenantId, organizationId))

      const initial = await getXraySettings(request, token)
      expect(initial.status, `GET settings should return 200: ${initial.text}`).toBe(200)
      original = initial.body?.result ?? null
      if (createdRow) {
        expect(original).toEqual(expect.objectContaining({ enabled: true, retentionDays: 365, kAnonymity: 10, individualsEnabled: false, updatedAt: null }))
      }

      const first = await putXraySettings(request, token, { retentionDays: 200 }, { expectedUpdatedAt: original?.updatedAt ?? null })
      expect(first.status, `first PUT should return 200: ${first.text}`).toBe(200)
      const firstVersion = first.body?.result.updatedAt
      expect(firstVersion).toBeTruthy()
      expect(first.body?.result.retentionDays).toBe(200)

      const second = await putXraySettings(request, token, { retentionDays: 201 }, { expectedUpdatedAt: firstVersion })
      expect(second.status, `PUT with the current version should return 200: ${second.text}`).toBe(200)
      const secondVersion = second.body?.result.updatedAt
      expect(secondVersion).toBeTruthy()
      expect(secondVersion).not.toBe(firstVersion)

      const stale = await putXraySettings(request, token, { retentionDays: 202 }, { expectedUpdatedAt: firstVersion })
      expect(stale.status, `PUT with a stale version should return 409: ${stale.text}`).toBe(409)
      expect(stale.body).toEqual(expect.objectContaining({ code: 'optimistic_lock_conflict', currentUpdatedAt: secondVersion }))

      const current = await getXraySettings(request, token)
      expect(current.body?.result).toEqual(expect.objectContaining({ retentionDays: 201, updatedAt: secondVersion }))

      const invalid = await putXraySettings(request, token, { kAnonymity: 2 })
      expect(invalid.status, 'the k-anonymity floor is enforced').toBe(400)
      const unknownField = await putXraySettings(request, token, { surprise: true })
      expect(unknownField.status, 'unknown fields are rejected').toBe(400)

      const employeeToken = await getAuthToken(request, 'employee')
      expect((await getXraySettings(request, employeeToken)).status, 'settings require insights.xray.manage').toBe(403)
    } finally {
      if (token && tenantId && organizationId) {
        if (createdRow) {
          await deleteSettingsRow(tenantId, organizationId)
        } else if (original) {
          await putXraySettings(request, token, {
            enabled: original.enabled,
            retentionDays: original.retentionDays,
            kAnonymity: original.kAnonymity,
            debounceSeconds: original.debounceSeconds,
            individualsEnabled: original.individualsEnabled,
          })
        }
      }
    }
  })
})
