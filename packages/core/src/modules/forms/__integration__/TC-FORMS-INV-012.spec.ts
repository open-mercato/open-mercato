import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import {
  apiRequest,
  getAuthToken,
  withCredentialIsolatedRequest,
} from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createDistributionFixture,
  createInvitationsFixture,
  createPublishedFormFixture,
  deleteDistributionIfExists,
  deleteFormIfExists,
  listInvitations,
  startPublicSubmission,
  uniqueClientIp,
} from '@open-mercato/core/helpers/integration/formsFixtures'

/**
 * TC-FORMS-INV-012: unknown, revoked and unusable invitation tokens are all
 * refused, and none of them mints an access token.
 *
 * The three statuses answer differently on purpose and a client depends on the
 * difference: an unknown token is `404 NOT_FOUND` (nothing to resume), a revoked
 * one is `410 GONE` on the public paths (the link existed and was withdrawn), and
 * the admin-side `send` refuses a revoked invitation with `409
 * forms.errors.invitation_revoked` so an operator cannot re-mail a withdrawn link.
 *
 * Every public probe asserts `access_token` is absent — the status code alone
 * would not catch a route that refused and still handed out a credential.
 */
test.describe('TC-FORMS-INV-012: unusable invitation tokens', () => {
  test('refuses unknown and revoked tokens, and blocks sending a revoked invitation', async ({ request }) => {
    test.setTimeout(150_000)

    const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`
    let adminToken: string | null = null
    let formId: string | null = null
    let distributionId: string | null = null

    try {
      adminToken = await getAuthToken(request, 'admin')
      const published = await createPublishedFormFixture(request, adminToken, { name: `QA INV012 ${stamp}` })
      formId = published.formId

      const distribution = await createDistributionFixture(request, adminToken, formId, { mode: 'personal' })
      distributionId = distribution.id

      const [withEmail, withoutEmail] = await createInvitationsFixture(
        request,
        adminToken,
        distributionId,
        [
          { email: `qa-inv012-${stamp}@test.local`, name: 'Revocable' },
          { ref: `qa-inv012-no-email-${stamp}` },
        ],
      )
      const revocableToken = withEmail.rawToken as string
      expect(revocableToken, 'the revocable invitation minted a token').toBeTruthy()

      // A recipient with no email cannot be mailed: 422, and it is a distinct
      // failure from "revoked" so the UI can tell the operator what to fix.
      const noEmailSend = await apiRequest(
        request,
        'POST',
        `/api/forms/distributions/${distributionId}/invitations/${withoutEmail.id}/send`,
        { token: adminToken, data: {} },
      )
      const noEmailBody = await readJsonSafe<{ error?: string }>(noEmailSend)
      expect(
        noEmailSend.status(),
        `sending to a recipient with no email should be 422 (got ${noEmailSend.status()}: ${JSON.stringify(noEmailBody)})`,
      ).toBe(422)
      expect(noEmailBody?.error).toBe('forms.errors.invitation_no_email')

      // Revoke the first invitation.
      const revokeRes = await apiRequest(
        request,
        'DELETE',
        `/api/forms/distributions/${distributionId}/invitations/${withEmail.id}`,
        { token: adminToken },
      )
      expect(
        revokeRes.status(),
        `revoking should return 200 (got ${revokeRes.status()}: ${await revokeRes.text()})`,
      ).toBe(200)

      const listed = await listInvitations(request, adminToken, distributionId)
      const revokedRow = (listed?.items ?? []).find((item) => item.id === withEmail.id)
      expect(revokedRow, 'revoking soft-deletes rather than removing the row').toBeTruthy()
      expect(revokedRow?.status, 'the revoked invitation reports its status').toBe('revoked')

      // Re-sending a revoked invitation is a 409, not a silent success.
      const revokedSend = await apiRequest(
        request,
        'POST',
        `/api/forms/distributions/${distributionId}/invitations/${withEmail.id}/send`,
        { token: adminToken, data: {} },
      )
      const revokedSendBody = await readJsonSafe<{ error?: string }>(revokedSend)
      expect(
        revokedSend.status(),
        `sending a revoked invitation should be 409 (got ${revokedSend.status()}: ${JSON.stringify(revokedSendBody)})`,
      ).toBe(409)
      expect(revokedSendBody?.error).toBe('forms.errors.invitation_revoked')

      await withCredentialIsolatedRequest(async (anonymous) => {
        // Unknown token — a plausible-looking 64-char hex string.
        const unknownToken = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '')
        const unknownRes = await anonymous.get(`/api/forms/public/invitations/${unknownToken}`)
        const unknownBody = await readJsonSafe<{ error?: string }>(unknownRes)
        expect(
          unknownRes.status(),
          `an unknown token should be 404 (got ${unknownRes.status()}: ${JSON.stringify(unknownBody)})`,
        ).toBe(404)
        expect(unknownBody?.error).toBe('NOT_FOUND')

        const unknownStart = await startPublicSubmission(anonymous, {
          token: unknownToken,
          clientIp: uniqueClientIp(),
        })
        expect(unknownStart.status, 'starting with an unknown token should be 404').toBe(404)
        expect(unknownStart.accessToken, 'an unknown token must mint no access token').toBeFalsy()

        // Revoked token — the link existed and was withdrawn.
        const revokedRes = await anonymous.get(`/api/forms/public/invitations/${revocableToken}`)
        const revokedBody = await readJsonSafe<{ error?: string; details?: { status?: string } | null }>(revokedRes)
        expect(
          revokedRes.status(),
          `a revoked token should be 410 (got ${revokedRes.status()}: ${JSON.stringify(revokedBody)})`,
        ).toBe(410)
        expect(revokedBody?.error).toBe('GONE')
        expect(revokedBody?.details?.status, 'the refusal names the terminal status').toBe('revoked')

        const revokedStart = await startPublicSubmission(anonymous, {
          token: revocableToken,
          clientIp: uniqueClientIp(),
        })
        expect(revokedStart.status, 'starting with a revoked token should be 410').toBe(410)
        expect(revokedStart.body.error).toBe('GONE')
        expect(revokedStart.accessToken, 'a revoked token must mint no access token').toBeFalsy()

        // A body carrying neither slug nor token, and one carrying both, are
        // rejected by the disjunction refine rather than defaulting to either.
        const neither = await startPublicSubmission(anonymous, { clientIp: uniqueClientIp() })
        expect(neither.status, 'a start with neither slug nor token is 422').toBe(422)
        expect(neither.body.error).toBe('VALIDATION_FAILED')

        const both = await startPublicSubmission(anonymous, {
          slug: distribution.publicSlug ?? 'qa-inv012-slug',
          token: revocableToken,
          clientIp: uniqueClientIp(),
        })
        expect(both.status, 'a start carrying both slug and token is 422').toBe(422)
        expect(both.body.error).toBe('VALIDATION_FAILED')
      })

      // No submission was created by any of the refused attempts.
      const inboxRes = await apiRequest(request, 'GET', `/api/forms/${formId}/submissions`, {
        token: adminToken,
      })
      const inbox = await readJsonSafe<{ total?: number }>(inboxRes)
      expect(inbox?.total, 'none of the refused tokens started a submission').toBe(0)
    } finally {
      await deleteDistributionIfExists(request, adminToken, distributionId)
      await deleteFormIfExists(request, adminToken, formId)
    }
  })
})
