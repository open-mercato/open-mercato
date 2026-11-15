import { expect, test } from '@playwright/test'
import {
  getAuthToken,
  withCredentialIsolatedRequest,
} from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createDistributionFixture,
  createPublishedFormFixture,
  deleteDistributionIfExists,
  deleteFormIfExists,
  publicAutosave,
  publicSubmit,
  startPublicSubmissionOrThrow,
  uniqueClientIp,
  waitForAutosaveWindow,
} from '@open-mercato/core/helpers/integration/formsFixtures'

/**
 * TC-FORMS-PUB-001: the open-link happy path — resolve a slug, start, autosave,
 * submit.
 *
 * Every public call runs on a credential-isolated context so the `request`
 * fixture's cookie jar cannot silently authorize it, and carries a synthetic
 * `x-forwarded-for` so the public limiter bucket is not shared with the next
 * spec.
 *
 * The waits are not padding: `SubmissionService.save()` throttles autosaves to
 * one per `FORMS_AUTOSAVE_INTERVAL_MS / 2` (5s on the default) measured from the
 * current revision's `saved_at`, and `start` writes revision 1 with
 * `saved_at = now` — so even the FIRST autosave is throttled.
 */
test.describe('TC-FORMS-PUB-001: open-mode public runtime happy path', () => {
  test('resolves by slug, starts, autosaves and submits anonymously', async ({ request }) => {
    test.setTimeout(120_000)

    let adminToken: string | null = null
    let formId: string | null = null
    let distributionId: string | null = null

    try {
      adminToken = await getAuthToken(request, 'admin')
      const published = await createPublishedFormFixture(request, adminToken, { name: 'QA PUB001' })
      formId = published.formId

      const distribution = await createDistributionFixture(request, adminToken, formId, {
        mode: 'open',
        settings: {
          embed: { enabled: true, allowedDomains: ['https://www.acme.com'], autoResize: true },
        },
      })
      distributionId = distribution.id
      const slug = distribution.publicSlug
      expect(slug, 'an open distribution mints a public slug').toBeTruthy()

      const clientIp = uniqueClientIp()

      await withCredentialIsolatedRequest(async (anonymous) => {
        const contextRes = await anonymous.get(`/api/forms/public/distributions/${slug}`)
        expect(
          contextRes.status(),
          `the public slug lookup should be 200 (got ${contextRes.status()}: ${await contextRes.text()})`,
        ).toBe(200)
        const context = await readJsonSafe<Record<string, unknown>>(contextRes)
        expect((context?.form as Record<string, unknown>)?.key, 'the context names the form').toBe(published.formKey)
        expect(context?.schema, 'the context serves the published JSON Schema').toBeTruthy()
        expect(context?.fieldIndex, 'the context serves the flattened field index').toBeTruthy()
        expect(context?.requires_customer_auth, 'an open distribution needs no customer session').toBe(false)
        // The framing allowlist is consumed server-side only and must never be
        // echoed to a public payload.
        expect(
          JSON.stringify(context ?? {}),
          'the embed allowlist must not leak into the public context',
        ).not.toContain('www.acme.com')

        const started = await startPublicSubmissionOrThrow(anonymous, { slug: slug as string, clientIp })
        const startedSubmission = started.body.submission as Record<string, unknown>
        expect(startedSubmission.status, 'a fresh submission starts as a draft').toBe('draft')
        expect(startedSubmission.currentRevisionId, 'the submission points at revision 1').toBe(started.revisionId)
        expect((started.body.revision as Record<string, unknown>).revisionNumber).toBe(1)
        expect(started.body.expires_at, 'the access token carries an expiry').toBeTruthy()

        await waitForAutosaveWindow()
        const saveRes = await publicAutosave(anonymous, {
          submissionId: started.submissionId,
          accessToken: started.accessToken,
          baseRevisionId: started.revisionId,
          patch: { full_name: 'Jane Anonymous' },
          changeSummary: 'filled the name',
          clientIp,
        })
        const saveBody = await readJsonSafe<{
          revision?: { id?: string; revisionNumber?: number; changedFieldKeys?: string[] }
          access_token?: string
        }>(saveRes)
        expect(
          saveRes.status(),
          `autosave should return 200 (got ${saveRes.status()}: ${JSON.stringify(saveBody)})`,
        ).toBe(200)
        expect(saveBody?.revision?.revisionNumber, 'autosave appends revision 2').toBe(2)
        expect(saveBody?.revision?.changedFieldKeys, 'autosave records the changed field').toContain('full_name')
        expect(saveBody?.access_token, 'a token-authorized save re-issues a slid token').toBeTruthy()
        const secondRevisionId = saveBody!.revision!.id as string

        const submitRes = await publicSubmit(anonymous, {
          submissionId: started.submissionId,
          accessToken: saveBody?.access_token ?? started.accessToken,
          baseRevisionId: secondRevisionId,
          clientIp,
        })
        const submitBody = await readJsonSafe<{ submission?: Record<string, unknown> }>(submitRes)
        expect(
          submitRes.status(),
          `submit should return 200 (got ${submitRes.status()}: ${JSON.stringify(submitBody)})`,
        ).toBe(200)
        expect(submitBody?.submission?.status, 'submitting flips the status').toBe('submitted')
        expect(submitBody?.submission?.submittedAt, 'submitting stamps submittedAt').toBeTruthy()

        // The submit metadata is derived server-side; the client cannot forge it.
        const metadata = submitBody?.submission?.submitMetadata as Record<string, unknown> | null
        expect(metadata, 'submit records metadata').toBeTruthy()
        expect(metadata?.ip, 'the server records the forwarded client ip').toBe(clientIp)
        expect(metadata?.userAgent !== undefined, 'the server records a user-agent slot').toBe(true)
        expect(metadata?.serverSubmittedAt, 'the server stamps its own submit time').toBeTruthy()
      })
    } finally {
      await deleteDistributionIfExists(request, adminToken, distributionId)
      await deleteFormIfExists(request, adminToken, formId)
    }
  })
})
