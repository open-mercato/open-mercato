import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { ownerPolicyRequest } from '@open-mercato/core/helpers/integration/attachmentAccessFixtures'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { getTokenContext } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  WEBHOOK_SPEC_TIMEOUT_MS,
  cleanupInboundEmails,
  createInboundTracker,
  fetchInboxEmail,
  receiveInboundEmail,
  resolveInboxAddress,
  skipUnlessResendStubAvailable,
  uniqueRunId,
  type InboxEmailDetail,
} from './helpers/inboundAttachments'

export const integrationMeta = { dependsOnModules: ['example', 'attachments'] }

const INTERNAL_FIELDS = [
  'attachmentsClaimToken',
  'attachmentsClaimedAt',
  'attachmentsFirstFailureAt',
  'attachmentsReleaseRequestedAt',
  'attachmentsReleasedAt',
  'attachmentsIngestGeneration',
  'attachmentsCurrentGeneration',
  'attachmentsNextRunAt',
]

function expectNoInternalFields(email: Record<string, unknown> | null | undefined): void {
  expect(email).toBeTruthy()
  for (const field of INTERNAL_FIELDS) expect(Object.keys(email ?? {})).not.toContain(field)
}

/**
 * TC-INBOX-ATT-004: `GET /api/inbox_ops/emails/[id]` returns `attachmentIds` to a caller with
 * `inbox_ops.proposals.view` and `null` to a role with only `inbox_ops.log.view`; the ingest claim
 * fields are never serialized there nor in the `email` of `GET /api/inbox_ops/proposals/[id]`.
 * The proposal is inserted through `withClient` because CI has no LLM key.
 * Spec: .ai/specs/2026-10-25-inbox-ops-inbound-attachments.md
 */
test.describe('TC-INBOX-ATT-004: attachment ids are redacted with the email content', () => {
  test('returns attachmentIds only with inbox_ops.proposals.view and never the claim fields', async ({ request }) => {
    test.setTimeout(WEBHOOK_SPEC_TIMEOUT_MS)
    await skipUnlessResendStubAvailable()
    const admin = await getAuthToken(request, 'admin')
    const scope = getTokenContext(admin)
    const tracker = createInboundTracker()
    const run = uniqueRunId('TC-INBOX-ATT-004')
    const proposalId = randomUUID()
    let roleId: string | null = null
    let userId: string | null = null
    let proposalInserted = false
    try {
      const received = await receiveInboundEmail(request, admin, tracker, {
        to: await resolveInboxAddress(request, admin),
        subject: `Quote request ${run}`,
        text: 'Quote attached.',
        attachments: [{ filename: `${run}-quote.txt`, contentType: 'text/plain', content: 'quote' }],
      })
      const attachmentIds = received.email.attachmentIds ?? []
      expect(attachmentIds).toHaveLength(1)

      const adminView = await fetchInboxEmail(request, admin, received.emailId)
      expect(adminView.status).toBe(200)
      expect(adminView.email?.attachmentIds).toEqual(attachmentIds)
      expect(adminView.email?.attachmentsStatus).toBe('completed')
      expectNoInternalFields(adminView.email)

      roleId = await createRoleFixture(request, admin, { name: run, tenantId: scope.tenantId })
      await setRoleAclFeatures(request, admin, { roleId, features: ['inbox_ops.log.view'] })
      const email = `${run}@example.com`
      const password = `Inbox1!${randomUUID()}`
      userId = await createUserFixture(request, admin, {
        email,
        password,
        organizationId: scope.organizationId,
        roles: [roleId],
        name: 'Log viewer',
      })
      const logViewer = await getAuthToken(request, email, password)
      const redacted = await ownerPolicyRequest<{ email?: InboxEmailDetail }>('GET', `/api/inbox_ops/emails/${received.emailId}`, logViewer)
      expect(redacted.status).toBe(200)
      expect(redacted.body?.email?.id).toBe(received.emailId)
      expect(redacted.body?.email?.attachmentIds).toBeNull()
      expect(redacted.body?.email?.attachmentsStatus).toBeNull()
      expectNoInternalFields(redacted.body?.email)

      await withClient(async (client) => {
        await client.query(
          `insert into inbox_proposals
             (id, inbox_email_id, summary, participants, confidence, status, possibly_incomplete, is_active, organization_id, tenant_id, created_at, updated_at)
           values ($1, $2, $3, '[]'::jsonb, 0.9, 'pending', false, true, $4, $5, now(), now())`,
          [proposalId, received.emailId, `Proposal ${run}`, scope.organizationId, scope.tenantId],
        )
      })
      proposalInserted = true
      const proposal = await ownerPolicyRequest<{ email?: InboxEmailDetail | null }>('GET', `/api/inbox_ops/proposals/${proposalId}`, admin)
      expect(proposal.status).toBe(200)
      expect(proposal.body?.email?.id).toBe(received.emailId)
      expect(proposal.body?.email?.attachmentIds).toEqual(attachmentIds)
      expectNoInternalFields(proposal.body?.email)
    } finally {
      // Each cleanup runs even when an earlier one fails.
      if (proposalInserted) {
        await withClient(async (client) => {
          await client.query('delete from inbox_proposals where id = $1', [proposalId])
        }).catch(() => undefined)
      }
      await deleteUserIfExists(request, admin, userId).catch(() => undefined)
      await deleteRoleIfExists(request, admin, roleId).catch(() => undefined)
      await cleanupInboundEmails(request, admin, tracker)
    }
  })
})
