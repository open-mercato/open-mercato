import { expect, test } from '@playwright/test'
import {
  getAuthToken,
  withCredentialIsolatedRequest,
} from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  createAnonymousRunFixture,
  deleteDistributionIfExists,
  deleteFormIfExists,
  publicAutosave,
  publicRead,
  waitForAutosaveWindow,
} from '@open-mercato/core/helpers/integration/formsFixtures'

/**
 * TC-FORMS-PUB-004: a tampered access token is rejected on every path.
 *
 * The token format is
 * `base64url(submissionId).base64url(invitationId).role.exp.hmac`, so each case
 * below attacks a different arm of `verifyAccessToken`: a flipped HMAC character
 * (signature), a dropped segment (malformed), a past `exp` (expired) and a
 * re-pointed submission segment (the submission-match assertion that stops a
 * token being replayed against another submission).
 *
 * Flipping the LAST hex character of the HMAC is deliberate: rewriting the body
 * instead would also exercise the signature check, but this isolates it.
 */
function flipLastHexChar(value: string): string {
  const last = value.slice(-1)
  const replacement = last === '0' ? '1' : '0'
  return `${value.slice(0, -1)}${replacement}`
}

test.describe('TC-FORMS-PUB-004: tampered access tokens', () => {
  test('rejects a bad signature, a truncated token, an expired exp and a re-pointed submission', async ({ request }) => {
    test.setTimeout(120_000)

    let adminToken: string | null = null
    let formId: string | null = null
    let distributionId: string | null = null

    try {
      adminToken = await getAuthToken(request, 'admin')

      await withCredentialIsolatedRequest(async (anonymous) => {
        const run = await createAnonymousRunFixture(request, anonymous, adminToken as string)
        formId = run.formId
        distributionId = run.distributionId

        const segments = run.accessToken.split('.')
        expect(segments.length, 'the access token is a 5-segment dotted string').toBe(5)
        const [submissionSegment, invitationSegment, roleSegment, expSegment, hmacSegment] = segments

        const tampered: Array<{ label: string; token: string }> = [
          {
            label: 'a flipped HMAC character',
            token: [submissionSegment, invitationSegment, roleSegment, expSegment, flipLastHexChar(hmacSegment)].join('.'),
          },
          {
            label: 'a truncated 4-segment token',
            token: [submissionSegment, invitationSegment, roleSegment, expSegment].join('.'),
          },
          {
            label: 'an expiry moved into the past',
            token: [submissionSegment, invitationSegment, roleSegment, '1', hmacSegment].join('.'),
          },
          {
            label: 'a re-pointed submission segment',
            token: [
              Buffer.from('00000000-0000-4000-8000-000000000000').toString('base64url'),
              invitationSegment,
              roleSegment,
              expSegment,
              hmacSegment,
            ].join('.'),
          },
          { label: 'an empty bearer body', token: ' ' },
        ]

        await waitForAutosaveWindow()

        for (const { label, token } of tampered) {
          const saveRes = await publicAutosave(anonymous, {
            submissionId: run.submissionId,
            accessToken: token,
            baseRevisionId: run.revisionId,
            patch: { full_name: `tampered via ${label}` },
            clientIp: run.clientIp,
          })
          expect(
            saveRes.status(),
            `autosave with ${label} must be rejected (got ${saveRes.status()}: ${await saveRes.text()})`,
          ).toBe(401)

          const readRes = await publicRead(anonymous, { submissionId: run.submissionId, accessToken: token })
          expect(readRes.status(), `read with ${label} must be rejected`).toBe(401)
        }

        // Nothing landed, and the genuine token still works — proving the
        // rejections were about the tampering and not a broken fixture.
        const ownRead = await publicRead(anonymous, {
          submissionId: run.submissionId,
          accessToken: run.accessToken,
        })
        expect(ownRead.status(), 'the untampered token still authorizes the read').toBe(200)
        const view = await readJsonSafe<{
          submission?: { currentRevisionId?: string }
          decoded_data?: Record<string, unknown>
        }>(ownRead)
        expect(view?.submission?.currentRevisionId, 'no tampered save advanced the chain').toBe(run.revisionId)
        expect(JSON.stringify(view?.decoded_data ?? {}), 'no tampered patch persisted').not.toContain('tampered via')
      })
    } finally {
      await deleteDistributionIfExists(request, adminToken, distributionId)
      await deleteFormIfExists(request, adminToken, formId)
    }
  })
})
