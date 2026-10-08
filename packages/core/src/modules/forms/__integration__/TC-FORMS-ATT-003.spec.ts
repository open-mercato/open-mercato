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
  deleteDistributionIfExists,
  deleteFormIfExists,
  publicUploadAttachment,
} from '@open-mercato/core/helpers/integration/formsFixtures'

/**
 * TC-FORMS-ATT-003: the MIME allowlist and the size ceiling are enforced
 * server-side, from the pinned version's own field config.
 *
 * Both constraints live in the schema (`x-om-accept`, `x-om-max-size-bytes`) and
 * the client never supplies them — `resolveFieldUploadConfig` reads them off the
 * submission's pinned version and `evaluateUploadGate` applies them. That is the
 * whole security property: a participant editing the request cannot widen either
 * limit, because the limits are not in the request.
 *
 * The two refusals answer with different statuses on purpose — `DISALLOWED_TYPE`
 * is 422 (the file is wrong) and `TOO_LARGE` is 413 (the request is too big) —
 * and a client surfaces different copy for each, so both are pinned.
 */
test.describe('TC-FORMS-ATT-003: upload MIME and size gates', () => {
  test('refuses a disallowed type with 422 and an oversize file with 413', async ({ request }) => {
    test.setTimeout(150_000)

    let adminToken: string | null = null
    let formId: string | null = null
    let distributionId: string | null = null

    const png = buildTinyPngBytes()
    const maxSizeBytes = 512

    try {
      adminToken = await getAuthToken(request, 'admin')

      await withCredentialIsolatedRequest(async (anonymous) => {
        const run = await createAnonymousRunFixture(request, anonymous, adminToken as string, {
          schema: buildFileFieldFormSchema({ accept: ['image/png'], maxSizeBytes }),
        })
        formId = run.formId
        distributionId = run.distributionId

        // Wrong MIME type, small enough to pass the size gate.
        const wrongTypeRes = await publicUploadAttachment(anonymous, {
          submissionId: run.submissionId,
          accessToken: run.accessToken,
          fieldKey: 'scan',
          filename: 'qa-att-003.txt',
          contentType: 'text/plain',
          bytes: Buffer.from('not an image', 'utf8'),
        })
        const wrongTypeBody = await readJsonSafe<{ error?: string; id?: string }>(wrongTypeRes)
        expect(
          wrongTypeRes.status(),
          `a disallowed MIME type must be refused with 422 (got ${wrongTypeRes.status()}: ${JSON.stringify(wrongTypeBody)})`,
        ).toBe(422)
        expect(wrongTypeBody?.error, 'the refusal names the disallowed type').toBe('DISALLOWED_TYPE')
        expect(wrongTypeBody?.id, 'nothing was stored').toBeFalsy()

        // Right MIME type, over the field's ceiling.
        const oversize = Buffer.concat([png, Buffer.alloc(maxSizeBytes, 0x42)])
        expect(oversize.length, 'the oversize fixture really exceeds the ceiling').toBeGreaterThan(maxSizeBytes)
        const oversizeRes = await publicUploadAttachment(anonymous, {
          submissionId: run.submissionId,
          accessToken: run.accessToken,
          fieldKey: 'scan',
          filename: 'qa-att-003-big.png',
          contentType: 'image/png',
          bytes: oversize,
        })
        const oversizeBody = await readJsonSafe<{ error?: string; id?: string }>(oversizeRes)
        expect(
          oversizeRes.status(),
          `an oversize file must be refused with 413 (got ${oversizeRes.status()}: ${JSON.stringify(oversizeBody)})`,
        ).toBe(413)
        expect(oversizeBody?.error, 'the refusal names the size violation').toBe('TOO_LARGE')
        expect(oversizeBody?.id, 'nothing was stored').toBeFalsy()

        // An empty file is refused too — a zero-byte upload is never a valid answer.
        const emptyRes = await publicUploadAttachment(anonymous, {
          submissionId: run.submissionId,
          accessToken: run.accessToken,
          fieldKey: 'scan',
          filename: 'qa-att-003-empty.png',
          contentType: 'image/png',
          bytes: Buffer.alloc(0),
        })
        const emptyBody = await readJsonSafe<{ error?: string }>(emptyRes)
        expect(
          emptyRes.status(),
          `an empty file must be refused (got ${emptyRes.status()}: ${JSON.stringify(emptyBody)})`,
        ).toBe(413)
        expect(emptyBody?.error, 'the refusal names the empty payload').toBe('EMPTY')

        // Control: a PNG inside the ceiling is accepted, so the gates are
        // discriminating rather than universally closed.
        expect(png.length, 'the control fixture is within the ceiling').toBeLessThanOrEqual(maxSizeBytes)
        const goodRes = await publicUploadAttachment(anonymous, {
          submissionId: run.submissionId,
          accessToken: run.accessToken,
          fieldKey: 'scan',
          filename: 'qa-att-003-ok.png',
          contentType: 'image/png',
          bytes: png,
        })
        expect(
          goodRes.status(),
          `an allowed, in-budget upload is accepted (got ${goodRes.status()}: ${await goodRes.text()})`,
        ).toBe(201)
      })
    } finally {
      await deleteDistributionIfExists(request, adminToken, distributionId)
      await deleteFormIfExists(request, adminToken, formId)
    }
  })
})
