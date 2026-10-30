import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { getTokenContext, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createCampaign,
  deleteCampaignIfExists,
  getCampaign,
  saveGraph,
  setEnabled,
  testDispatch,
} from './helpers/marketing'

/**
 * TC-MA-005: publishing and dry-running are separate powers from authoring.
 *
 * Enabling a campaign and test-firing one both reach real customers, so each has its own ACL
 * feature and its own endpoint. This proves the separation actually holds: a role granted
 * `campaigns.manage` but not `campaigns.publish` can save a graph and cannot take it live.
 */
test.describe('TC-MA-005 publish and dry run', () => {
  test('a manage-only role can author but cannot publish', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const { organizationId } = getTokenContext(adminToken)
    const stamp = Date.now()
    let campaignId: string | null = null
    let roleId: string | null = null
    let userId: string | null = null
    const email = `qa-ma-author-${stamp}@example.com`
    const roleName = `qa-ma-author-${stamp}`
    const authorPassword = 'Qa-Author-1!'

    try {
      campaignId = await createCampaign(request, adminToken, `QA publish ${stamp}`)
      const created = await getCampaign(request, adminToken, campaignId)

      roleId = await createRoleFixture(request, adminToken, { name: roleName })
      await setRoleAclFeatures(request, adminToken, {
        roleId,
        features: ['marketing_automation.campaigns.view', 'marketing_automation.campaigns.manage'],
      })
      // Roles are referenced by id, and the password must satisfy the default policy
      // (length + uppercase + digit + special).
      userId = await createUserFixture(request, adminToken, {
        email,
        password: authorPassword,
        organizationId,
        roles: [roleId],
        name: 'QA Campaign Author',
      })
      const authorToken = await getAuthToken(request, email, authorPassword)

      // Authoring is allowed.
      const saved = await saveGraph(request, authorToken, campaignId, {
        updatedAt: created.updatedAt,
        name: `QA publish ${stamp}`,
        triggers: [{ kind: 'event', eventId: 'sales.order.created' }],
        definition: {
          version: 1,
          audience: null,
          steps: [{ id: 's1', type: 'send_email', params: { subject: 'QA', bodyHtml: '<p>QA</p>' } }],
        },
      })
      expect(saved.ok(), 'campaigns.manage can save a graph').toBe(true)

      // Publishing is not.
      const afterSave = await getCampaign(request, adminToken, campaignId)
      const denied = await setEnabled(request, authorToken, campaignId, {
        updatedAt: afterSave.updatedAt,
        isEnabled: true,
      })
      expect(denied.status(), 'campaigns.publish is required to take a campaign live').toBe(403)
      expect((await getCampaign(request, adminToken, campaignId)).isEnabled).toBe(false)

      // And an admin, who holds publish, can.
      const allowed = await setEnabled(request, adminToken, campaignId, {
        updatedAt: afterSave.updatedAt,
        isEnabled: true,
      })
      expect(allowed.ok()).toBe(true)
      expect((await getCampaign(request, adminToken, campaignId)).isEnabled).toBe(true)
    } finally {
      await deleteCampaignIfExists(request, adminToken, campaignId)
      await deleteUserIfExists(request, adminToken, userId)
      await deleteRoleIfExists(request, adminToken, roleId)
    }
  })

  test('refuses to publish a campaign with nothing to run', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let campaignId: string | null = null
    try {
      campaignId = await createCampaign(request, token, `QA empty publish ${Date.now()}`)
      const created = await getCampaign(request, token, campaignId)
      const response = await setEnabled(request, token, campaignId, {
        updatedAt: created.updatedAt,
        isEnabled: true,
      })
      expect(response.status()).toBe(400)
      const body = await readJsonSafe<{ code?: string }>(response)
      expect(body?.code).toMatch(/^marketing_automation\.validation\./)
      expect((await getCampaign(request, token, campaignId)).isEnabled).toBe(false)
    } finally {
      await deleteCampaignIfExists(request, token, campaignId)
    }
  })

  test('a dry run reports the plan and sends nothing', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = Date.now()
    let campaignId: string | null = null
    let personEntityId: string | null = null

    try {
      personEntityId = await createPersonFixture(request, token, {
        firstName: 'Dry',
        lastName: `Run${stamp}`,
        displayName: `Dry Run ${stamp}`,
        primaryEmail: `qa-ma-dry-${stamp}@example.com`,
      })
      campaignId = await createCampaign(request, token, `QA dry run ${stamp}`)
      const created = await getCampaign(request, token, campaignId)

      await saveGraph(request, token, campaignId, {
        updatedAt: created.updatedAt,
        name: `QA dry run ${stamp}`,
        triggers: [{ kind: 'event', eventId: 'sales.order.created' }],
        definition: {
          version: 1,
          // Deliberately restrictive so the dry run has to report an exclusion, which is the
          // question it is usually asked: why did this person not get it?
          audience: { operator: 'AND', rules: [{ field: 'trigger.orderTotal', operator: '>=', value: 1000 }] },
          steps: [
            { id: 'w1', type: 'wait', params: { minutes: 15 } },
            { id: 's1', type: 'send_email', params: { subject: 'QA', bodyHtml: '<p>QA</p>' } },
          ],
        },
      })

      const excluded = await testDispatch(request, token, campaignId, { subjectEntityId: personEntityId })
      expect(excluded.ok()).toBe(true)
      const excludedBody = await readJsonSafe<{
        inAudience?: boolean
        sent?: boolean
        plan?: unknown[]
        subject?: Record<string, unknown>
      }>(excluded)
      expect(excludedBody?.inAudience).toBe(false)
      expect(excludedBody?.sent).toBe(false)
      // The plan is still reported, so the author can see what would have happened.
      expect(Array.isArray(excludedBody?.plan)).toBe(true)

      // The firing assertion for the PII rule: this route is reachable with no `customers.*` grant,
      // so it must report presence, never the decrypted address or the tag list itself.
      const subjectKeys = Object.keys(excludedBody?.subject ?? {})
      expect(subjectKeys).not.toContain('email')
      expect(subjectKeys).not.toContain('tags')
      expect(excludedBody?.subject).toMatchObject({ exists: true, hasEmail: true })
      expect(JSON.stringify(excludedBody)).not.toContain('qa-ma-dry-')

      const included = await testDispatch(request, token, campaignId, {
        subjectEntityId: personEntityId,
        trigger: { orderTotal: 2500 },
      })
      const includedBody = await readJsonSafe<{ inAudience?: boolean; sent?: boolean; plan?: Array<Record<string, unknown>> }>(included)
      expect(includedBody?.inAudience).toBe(true)
      expect(includedBody?.sent, 'a dry run never sends').toBe(false)
      // A leading wait parks the journey, so the plan stops there — the same thing the engine does.
      expect(includedBody?.plan?.[0]).toMatchObject({ kind: 'pause', minutes: 15 })
    } finally {
      await deleteCampaignIfExists(request, token, campaignId)
      await deleteEntityIfExists(request, token, '/api/customers/people', personEntityId)
    }
  })
})
