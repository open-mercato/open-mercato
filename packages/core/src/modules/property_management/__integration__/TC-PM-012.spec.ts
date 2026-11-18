import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setUserAclVisibility,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { createOrganizationInDb, deleteOrganizationInDb, deleteUserAclInDb } from '@open-mercato/core/helpers/integration/dbFixtures'
import { deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { stampOf } from './helpers'
import { createSalesChannel, readSettings, restoreSettings, saveSettings, settingsReleased, type SettingsBody } from './leaseFixtures'

/**
 * TC-PM-012: property management settings
 * GET returns the organization's row with defaults; PUT validates ranges (proposal expiry 0 → 422)
 * and that referenced channel / status entry belong to the organization (422); two organizations
 * of one tenant keep separate values; an organization without a channel cannot create a lease
 * (422 billing_channel_missing).
 */
test.describe('TC-PM-012: settings', () => {
  test('validates and saves the settings of the current organization', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = stampOf()
    let original: SettingsBody | null = null
    let channelId: string | null = null
    try {
      original = await readSettings(request, token)
      expect(original.leaseEndingThresholdDays).toBeGreaterThan(0)
      expect(original.proposalExpiryDays).toBeGreaterThanOrEqual(1)

      const zeroExpiry = await saveSettings(request, token, { ...original, proposalExpiryDays: 0 })
      expect(zeroExpiry.status(), 'proposal expiry 0 is refused').toBe(422)

      const foreignChannel = await saveSettings(request, token, { ...original, billingChannelId: randomUUID() })
      expect(foreignChannel.status(), 'a channel outside the organization is refused').toBe(422)

      const foreignStatus = await saveSettings(request, token, { ...original, cancelledOrderStatusEntryId: randomUUID() })
      expect(foreignStatus.status(), 'a status entry outside the organization is refused').toBe(422)

      channelId = await createSalesChannel(request, token, stamp)
      const saved = await saveSettings(request, token, { ...original, billingChannelId: channelId, proposalExpiryDays: 21 })
      const body = await readJsonSafe<SettingsBody & { updatedAt?: string | null }>(saved)
      expect(saved.status()).toBe(200)
      expect(body?.billingChannelId).toBe(channelId)
      expect(body?.proposalExpiryDays).toBe(21)
      expect(typeof body?.updatedAt).toBe('string')

      const reread = await readSettings(request, token)
      expect(reread.billingChannelId).toBe(channelId)
      expect(reread.proposalExpiryDays).toBe(21)
    } finally {
      const restore = await restoreSettings(request, token, original)
      if (settingsReleased(restore, { channelId })) await deleteEntityIfExists(request, token, '/api/sales/channels', channelId)
      if (restore.failure) throw new Error(`[internal] ${restore.failure}; the QA sales channel ${channelId} was kept`)
    }
  })

  test('keeps separate values per organization and refuses leases without a channel', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const stamp = stampOf()
    const email = `qa-pm-settings-${stamp}@example.com`
    const password = 'StrongSecret123!'
    let orgBId: string | null = null
    let roleId: string | null = null
    let userId: string | null = null
    let original: SettingsBody | null = null
    let channelId: string | null = null
    try {
      original = await readSettings(request, adminToken)
      channelId = await createSalesChannel(request, adminToken, stamp)
      expect((await saveSettings(request, adminToken, { ...original, billingChannelId: channelId, proposalExpiryDays: 30 })).status()).toBe(200)

      const { tenantId } = getTokenScope(adminToken)
      orgBId = await createOrganizationInDb({ name: `TC-PM-012 Org B ${stamp}`, tenantId })
      roleId = await createRoleFixture(request, adminToken, { name: `TC-PM-012 ${stamp}`, tenantId })
      userId = await createUserFixture(request, adminToken, { email, password, organizationId: orgBId, roles: [roleId] })
      await setUserAclVisibility(request, adminToken, {
        userId,
        organizations: [orgBId],
        features: ['property_management.view', 'property_management.manage', 'property_management.leases.manage'],
      })
      const orgBToken = await getAuthToken(request, email, password)
      expect(getTokenScope(orgBToken).organizationId).toBe(orgBId)

      const orgBSettings = await readSettings(request, orgBToken)
      expect(orgBSettings.billingChannelId, 'org B has no channel').toBeNull()
      expect(orgBSettings.proposalExpiryDays, 'org B keeps the default').toBe(14)

      const crossChannel = await saveSettings(request, orgBToken, { ...orgBSettings, billingChannelId: channelId })
      expect(crossChannel.status(), "org A's channel is foreign to org B").toBe(422)

      const lease = await apiRequest(request, 'POST', '/api/property_management/leases', {
        token: orgBToken,
        data: {
          unitId: randomUUID(),
          customerCompanyId: randomUUID(),
          startsOn: '2030-01-01',
          termMonths: 12,
          monthlyRate: 1000,
          asProposal: false,
        },
      })
      const leaseBody = await readJsonSafe<{ code?: string }>(lease)
      expect(lease.status()).toBe(422)
      expect(leaseBody?.code).toBe('billing_channel_missing')

      expect((await readSettings(request, adminToken)).proposalExpiryDays, 'org A keeps its own value').toBe(30)
    } finally {
      const restore = await restoreSettings(request, adminToken, original)
      if (settingsReleased(restore, { channelId })) await deleteEntityIfExists(request, adminToken, '/api/sales/channels', channelId)
      await deleteUserIfExists(request, adminToken, userId)
      await deleteUserAclInDb(userId ?? '').catch(() => undefined)
      await deleteRoleIfExists(request, adminToken, roleId)
      await deleteOrganizationInDb(orgBId).catch(() => undefined)
      if (restore.failure) throw new Error(`[internal] ${restore.failure}; the QA sales channel ${channelId} was kept`)
    }
  })
})
