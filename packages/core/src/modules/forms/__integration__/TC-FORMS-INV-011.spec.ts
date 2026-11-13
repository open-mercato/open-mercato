import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import {
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
  publicAutosave,
  publicSubmit,
  startPublicSubmissionOrThrow,
  uniqueClientIp,
  waitForAutosaveWindow,
} from '@open-mercato/core/helpers/integration/formsFixtures'

/**
 * TC-FORMS-INV-011: a personal invitation token is redeemable end to end, and the
 * invitation's own status tracks the run.
 *
 * The status ladder (`pending → opened → started → submitted`) is what an admin
 * reads to chase non-responders, so it is asserted at each hop rather than only
 * at the end. The PII assertion on the public descriptor is the security half:
 * `GET /api/forms/public/invitations/:token` is unauthenticated — anybody holding
 * the link can call it — so it must not echo the recipient's email or name.
 */
test.describe('TC-FORMS-INV-011: invitation redemption end to end', () => {
  test('resolves the token, starts, autosaves, submits and advances the invitation status', async ({ request }) => {
    test.setTimeout(180_000)

    const stamp = `${Date.now()}-${randomUUID().slice(0, 8)}`
    const recipientEmail = `qa-inv011-${stamp}@test.local`
    const recipientName = `QA INV011 Recipient ${stamp}`

    let adminToken: string | null = null
    let formId: string | null = null
    let distributionId: string | null = null

    try {
      adminToken = await getAuthToken(request, 'admin')
      const published = await createPublishedFormFixture(request, adminToken, { name: `QA INV011 ${stamp}` })
      formId = published.formId

      const distribution = await createDistributionFixture(request, adminToken, formId, {
        mode: 'personal',
      })
      distributionId = distribution.id

      const [invitation] = await createInvitationsFixture(request, adminToken, distributionId, [
        { email: recipientEmail, name: recipientName },
      ])
      const rawToken = invitation.rawToken as string
      expect(rawToken, 'the invitation minted a raw token').toBeTruthy()

      const readStatus = async (): Promise<string | undefined> => {
        const listed = await listInvitations(request, adminToken as string, distributionId as string)
        const row = (listed?.items ?? []).find((item) => item.id === invitation.id)
        return row?.status as string | undefined
      }

      // The create command mails the personal link inline when the recipient has
      // an email, so this row starts on `sent` rather than `pending`. Either is a
      // valid pre-open state; the ladder below is what this case is about.
      expect(
        ['pending', 'sent'],
        'a fresh invitation has not been opened yet',
      ).toContain(await readStatus())

      await withCredentialIsolatedRequest(async (anonymous) => {
        const resolveRes = await anonymous.get(`/api/forms/public/invitations/${rawToken}`)
        const context = await readJsonSafe<Record<string, unknown>>(resolveRes)
        expect(
          resolveRes.status(),
          `resolving the raw token should be 200 (got ${resolveRes.status()}: ${JSON.stringify(context)})`,
        ).toBe(200)
        expect(context?.distribution_id, 'the descriptor names the distribution').toBe(distributionId)
        expect((context?.form as Record<string, unknown>)?.key, 'the descriptor names the form').toBe(
          published.formKey,
        )
        const invitationDescriptor = context?.invitation as Record<string, unknown>
        expect(invitationDescriptor?.id, 'the descriptor names the invitation').toBe(invitation.id)
        expect(
          invitationDescriptor?.status,
          'resolving marks a pending invitation as opened in the same response',
        ).toBe('opened')

        // The descriptor is unauthenticated, so recipient PII must not ride along.
        const serialized = JSON.stringify(context ?? {})
        expect(serialized, 'the public descriptor must not echo the recipient email').not.toContain(recipientEmail)
        expect(serialized, 'the public descriptor must not echo the recipient name').not.toContain(recipientName)
        expect(serialized, 'the public descriptor must not echo the raw token back').not.toContain(rawToken)

        const clientIp = uniqueClientIp()
        const started = await startPublicSubmissionOrThrow(anonymous, { token: rawToken, clientIp })
        const submissionId = started.submissionId

        await waitForAutosaveWindow()
        const saveRes = await publicAutosave(anonymous, {
          submissionId,
          accessToken: started.accessToken,
          baseRevisionId: started.revisionId,
          patch: { full_name: 'Invited Ivy' },
          clientIp,
        })
        const saved = await readJsonSafe<{ revision?: { id?: string }; access_token?: string }>(saveRes)
        expect(
          saveRes.status(),
          `the invited autosave should succeed (got ${saveRes.status()}: ${JSON.stringify(saved)})`,
        ).toBe(200)

        const submitRes = await publicSubmit(anonymous, {
          submissionId,
          accessToken: saved?.access_token ?? started.accessToken,
          baseRevisionId: saved!.revision!.id as string,
          clientIp,
        })
        const submitted = await readJsonSafe<{ submission?: { status?: string } }>(submitRes)
        expect(
          submitRes.status(),
          `the invited submit should succeed (got ${submitRes.status()}: ${JSON.stringify(submitted)})`,
        ).toBe(200)
        expect(submitted?.submission?.status).toBe('submitted')

        // Redeeming a submitted invitation is over — the link is single-use.
        const afterSubmitRes = await anonymous.get(`/api/forms/public/invitations/${rawToken}`)
        expect(
          afterSubmitRes.status(),
          'a submitted invitation is gone, so the link cannot be reused',
        ).toBe(410)
        expect((await readJsonSafe<{ error?: string }>(afterSubmitRes))?.error).toBe('GONE')
      })

      expect(await readStatus(), 'the invitation ends the run as submitted').toBe('submitted')

      const listed = await listInvitations(request, adminToken, distributionId)
      const row = (listed?.items ?? []).find((item) => item.id === invitation.id)
      expect(row?.openedAt, 'the admin view records when the invitation was opened').toBeTruthy()
      expect(row?.startedAt, 'the admin view records when the run started').toBeTruthy()
      expect(row?.submittedAt, 'the admin view records when the run was submitted').toBeTruthy()

      const inboxRes = await request.get(`/api/forms/${formId}/submissions`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      })
      const inbox = await readJsonSafe<{ total?: number; items?: Array<{ status?: string }> }>(inboxRes)
      expect(inbox?.total, 'the run produced exactly one submission').toBe(1)
      expect(inbox?.items?.[0]?.status, 'the admin inbox sees it as submitted').toBe('submitted')
    } finally {
      await deleteDistributionIfExists(request, adminToken, distributionId)
      await deleteFormIfExists(request, adminToken, formId)
    }
  })
})
