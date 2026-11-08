import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { ownerPolicyRequest, type OwnerAccessList } from '@open-mercato/core/helpers/integration/attachmentAccessFixtures'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { deleteGeneralEntityIfExists, expectId, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  INBOUND_EMAIL_ENTITY_ID,
  WEBHOOK_SPEC_TIMEOUT_MS,
  cleanupInboundEmails,
  createInboundTracker,
  receiveInboundEmail,
  resolveInboxAddress,
  skipUnlessResendStubAvailable,
  uniqueRunId,
} from './helpers/inboundAttachments'

export const integrationMeta = { dependsOnModules: ['example', 'attachments', 'directory'] }

/**
 * TC-INBOX-ATT-006: a user of another tenant whose role holds the inbox and attachment features
 * cannot read an inbound attachment or its email through any route.
 * Spec: .ai/specs/2026-10-25-inbox-ops-inbound-attachments.md
 */
test.describe('TC-INBOX-ATT-006: inbound attachments are tenant-isolated', () => {
  test('denies a reader from another tenant', async ({ request }) => {
    test.setTimeout(WEBHOOK_SPEC_TIMEOUT_MS)
    await skipUnlessResendStubAvailable()
    const admin = await getAuthToken(request, 'admin')
    const superadmin = await getAuthToken(request, 'superadmin')
    const tracker = createInboundTracker()
    const run = uniqueRunId('TC-INBOX-ATT-006')
    let tenantId: string | null = null
    let organizationId: string | null = null
    let roleId: string | null = null
    let userId: string | null = null
    try {
      const received = await receiveInboundEmail(request, admin, tracker, {
        to: await resolveInboxAddress(request, admin),
        subject: `Contract ${run}`,
        text: 'Contract attached.',
        attachments: [{ filename: `${run}-contract.txt`, contentType: 'text/plain', content: 'contract terms' }],
      })
      const [attachmentId] = received.email.attachmentIds ?? []
      expect(attachmentId).toBeTruthy()

      const tenant = await apiRequest(request, 'POST', '/api/directory/tenants', { token: superadmin, data: { name: `${run}-tenant` } })
      expect(tenant.status()).toBe(201)
      tenantId = expectId((await readJsonSafe<{ id?: string }>(tenant))?.id, 'tenant create should return id')
      const organization = await apiRequest(request, 'POST', '/api/directory/organizations', {
        token: superadmin,
        data: { tenantId, name: `${run}-org` },
      })
      expect(organization.status()).toBe(201)
      organizationId = expectId((await readJsonSafe<{ id?: string }>(organization))?.id, 'org create should return id')
      roleId = await createRoleFixture(request, superadmin, { name: run, tenantId })
      await setRoleAclFeatures(request, superadmin, {
        roleId,
        features: ['attachments.view', 'attachments.manage', 'inbox_ops.proposals.view', 'inbox_ops.log.view'],
      })
      const email = `${run}@example.com`
      const password = `Inbox1!${randomUUID()}`
      userId = await createUserFixture(request, superadmin, { email, password, organizationId, roles: [roleId] })
      const foreign = await getAuthToken(request, email, password)

      expect((await ownerPolicyRequest('GET', `/api/attachments/file/${attachmentId}`, foreign)).status).toBe(404)
      expect((await ownerPolicyRequest('GET', `/api/attachments/library/${attachmentId}`, foreign)).status).toBe(404)
      const recordList = await ownerPolicyRequest<OwnerAccessList>(
        'GET',
        `/api/attachments?entityId=${encodeURIComponent(INBOUND_EMAIL_ENTITY_ID)}&recordId=${received.emailId}`,
        foreign,
      )
      expect(recordList.status).toBe(200)
      expect(recordList.body?.items ?? []).toEqual([])
      expect((await ownerPolicyRequest('GET', `/api/inbox_ops/emails/${received.emailId}/attachments`, foreign)).status).toBe(404)
      expect((await ownerPolicyRequest('GET', `/api/inbox_ops/emails/${received.emailId}`, foreign)).status).toBe(404)
      expect((await ownerPolicyRequest('GET', `/api/attachments/file/${attachmentId}`, admin)).status).toBe(200)
    } finally {
      await deleteUserIfExists(request, superadmin, userId)
      await deleteRoleIfExists(request, superadmin, roleId)
      await deleteGeneralEntityIfExists(request, superadmin, '/api/directory/organizations', organizationId)
      await deleteGeneralEntityIfExists(request, superadmin, '/api/directory/tenants', tenantId)
      await cleanupInboundEmails(request, admin, tracker)
    }
  })
})
