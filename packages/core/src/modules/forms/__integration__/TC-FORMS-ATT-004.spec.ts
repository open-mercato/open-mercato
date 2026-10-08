import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import {
  getAuthToken,
  withCredentialIsolatedRequest,
} from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  buildFileFieldFormSchema,
  buildTinyPngBytes,
  createAnonymousRunFixture,
  createDistributionFixture,
  createPublishedFormFixture,
  deleteDistributionIfExists,
  deleteFormIfExists,
  publicUploadAttachment,
  startPublicSubmissionOrThrow,
  uniqueClientIp,
} from '@open-mercato/core/helpers/integration/formsFixtures'

/**
 * TC-FORMS-ATT-004: an attachment is readable only through the submission that
 * owns it.
 *
 * The download route is nested under a submission id and authorizes with that
 * submission's principal, so the attack it must stop is presenting submission B's
 * valid access token on submission B's route while naming submission A's
 * attachment id — a plausible confusion if the handler looked the attachment up
 * by id alone. `readUpload` scopes by `(organizationId, submissionId,
 * attachmentId)`, so the answer must be 404: not 403, which would confirm the id
 * exists.
 *
 * The no-token variant issues from a context that never saw a login, so it
 * cannot pass on a replayed session.
 */
test.describe('TC-FORMS-ATT-004: cross-submission attachment access', () => {
  test('refuses another submission’s attachment id and an unauthenticated download', async ({ request }) => {
    test.setTimeout(180_000)

    let adminToken: string | null = null
    let formIdA: string | null = null
    let distributionIdA: string | null = null
    let formIdB: string | null = null
    let distributionIdB: string | null = null

    const bytes = buildTinyPngBytes()

    try {
      adminToken = await getAuthToken(request, 'admin')

      await withCredentialIsolatedRequest(async (anonymous) => {
        const runA = await createAnonymousRunFixture(request, anonymous, adminToken as string, {
          schema: buildFileFieldFormSchema({ accept: ['image/png'], maxSizeBytes: 4096 }),
        })
        formIdA = runA.formId
        distributionIdA = runA.distributionId

        const uploadRes = await publicUploadAttachment(anonymous, {
          submissionId: runA.submissionId,
          accessToken: runA.accessToken,
          fieldKey: 'scan',
          filename: 'qa-att-004.png',
          contentType: 'image/png',
          bytes,
        })
        expect(
          uploadRes.status(),
          `the upload should succeed (got ${uploadRes.status()}: ${await uploadRes.text()})`,
        ).toBe(201)
        const attachmentId = (await readJsonSafe<{ id?: string }>(uploadRes))!.id as string

        // A second, independent submission with its own valid access token.
        const publishedB = await createPublishedFormFixture(request, adminToken as string, {
          name: 'QA ATT004 B',
          schema: buildFileFieldFormSchema({ accept: ['image/png'], maxSizeBytes: 4096 }),
        })
        formIdB = publishedB.formId
        const distributionB = await createDistributionFixture(
          request,
          adminToken as string,
          publishedB.formId,
          { mode: 'open' },
        )
        distributionIdB = distributionB.id
        const runB = await startPublicSubmissionOrThrow(anonymous, {
          slug: distributionB.publicSlug as string,
          clientIp: uniqueClientIp(),
        })

        // The owner can read it — the control that makes the denials meaningful.
        const ownRes = await anonymous.get(
          `/api/forms/public/submissions/${runA.submissionId}/attachments/${attachmentId}`,
          { headers: { Authorization: `Bearer ${runA.accessToken}` } },
        )
        expect(ownRes.status(), 'the owning participant can download their attachment').toBe(200)

        // B's token on B's route, naming A's attachment.
        const crossRes = await anonymous.get(
          `/api/forms/public/submissions/${runB.submissionId}/attachments/${attachmentId}`,
          { headers: { Authorization: `Bearer ${runB.accessToken}` } },
        )
        expect(
          crossRes.status(),
          `another submission must not reach this attachment (got ${crossRes.status()})`,
        ).toBe(404)
        const crossBody = await readJsonSafe<{ error?: string }>(crossRes)
        expect(crossBody?.error, 'the refusal is a not-found, not a forbidden').toBe('NOT_FOUND')

        // Indistinguishable from an attachment id that does not exist.
        const missingRes = await anonymous.get(
          `/api/forms/public/submissions/${runB.submissionId}/attachments/${randomUUID()}`,
          { headers: { Authorization: `Bearer ${runB.accessToken}` } },
        )
        expect(missingRes.status(), 'a nonexistent attachment id answers the same status').toBe(
          crossRes.status(),
        )
        expect(await readJsonSafe(missingRes), 'and the same body').toEqual(crossBody)

        // B's token on A's route is rejected at the principal layer, before the
        // attachment is even looked up.
        const wrongRouteRes = await anonymous.get(
          `/api/forms/public/submissions/${runA.submissionId}/attachments/${attachmentId}`,
          { headers: { Authorization: `Bearer ${runB.accessToken}` } },
        )
        expect(
          wrongRouteRes.status(),
          "another submission's token on the owning route is unauthorized",
        ).toBe(401)

        // No credentials at all.
        const anonymousRes = await anonymous.get(
          `/api/forms/public/submissions/${runA.submissionId}/attachments/${attachmentId}`,
        )
        expect(anonymousRes.status(), 'an unauthenticated download is unauthorized').toBe(401)
        expect(
          (await anonymousRes.body()).equals(bytes),
          'a rejected download must not return the bytes',
        ).toBe(false)
      })
    } finally {
      await deleteDistributionIfExists(request, adminToken, distributionIdA)
      await deleteDistributionIfExists(request, adminToken, distributionIdB)
      await deleteFormIfExists(request, adminToken, formIdA)
      await deleteFormIfExists(request, adminToken, formIdB)
    }
  })
})
