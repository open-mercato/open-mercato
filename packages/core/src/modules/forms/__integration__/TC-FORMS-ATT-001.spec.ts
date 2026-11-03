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
  publicAutosave,
  publicUploadAttachment,
  waitForAutosaveWindow,
} from '@open-mercato/core/helpers/integration/formsFixtures'

/**
 * TC-FORMS-ATT-001: an anonymous participant can upload a file and read it back,
 * and the returned reference is a valid answer for the file field.
 *
 * The round trip is the point. The bytes are encrypted at rest with the
 * per-organization DEK, so a download that returns the *identical* buffer is the
 * only end-to-end proof that encrypt/decrypt agree — a subtly broken key
 * derivation would still produce a 200 with plausible-looking content.
 *
 * The autosave step matters too: the upload and the answer are separate writes,
 * and a reference shape the compiled AJV schema rejects would leave the
 * participant with an uploaded file they cannot attach.
 */
test.describe('TC-FORMS-ATT-001: anonymous attachment upload and download', () => {
  test('uploads a PNG, downloads identical bytes and accepts the reference as an answer', async ({ request }) => {
    test.setTimeout(150_000)

    let adminToken: string | null = null
    let formId: string | null = null
    let distributionId: string | null = null

    const bytes = buildTinyPngBytes()

    try {
      adminToken = await getAuthToken(request, 'admin')

      await withCredentialIsolatedRequest(async (anonymous) => {
        const run = await createAnonymousRunFixture(request, anonymous, adminToken as string, {
          schema: buildFileFieldFormSchema({ accept: ['image/png'], maxSizeBytes: 4096 }),
        })
        formId = run.formId
        distributionId = run.distributionId

        const uploadRes = await publicUploadAttachment(anonymous, {
          submissionId: run.submissionId,
          accessToken: run.accessToken,
          fieldKey: 'scan',
          filename: 'qa-att-001.png',
          contentType: 'image/png',
          bytes,
        })
        const uploaded = await readJsonSafe<{
          id?: string
          filename?: string
          contentType?: string
          sizeBytes?: number
        }>(uploadRes)
        expect(
          uploadRes.status(),
          `the upload should return 201 (got ${uploadRes.status()}: ${JSON.stringify(uploaded)})`,
        ).toBe(201)
        expect(uploaded?.id, 'the upload returns an attachment id').toBeTruthy()
        expect(uploaded?.filename, 'the upload echoes the filename').toBe('qa-att-001.png')
        expect(uploaded?.contentType, 'the upload echoes the content type').toBe('image/png')
        expect(uploaded?.sizeBytes, 'the upload reports the stored size').toBe(bytes.length)
        const attachmentId = uploaded!.id as string

        const downloadRes = await anonymous.get(
          `/api/forms/public/submissions/${run.submissionId}/attachments/${attachmentId}`,
          { headers: { Authorization: `Bearer ${run.accessToken}` } },
        )
        expect(
          downloadRes.status(),
          `the owning participant should download their upload (got ${downloadRes.status()})`,
        ).toBe(200)
        expect(downloadRes.headers()['content-type'], 'the download keeps the content type').toContain('image/png')
        expect(
          downloadRes.headers()['content-disposition'],
          'the download is served as an attachment',
        ).toContain('attachment')
        const downloaded = await downloadRes.body()
        expect(
          downloaded.equals(bytes),
          'the decrypted bytes must be byte-identical to what was uploaded',
        ).toBe(true)

        // The returned reference is a valid answer for the file field.
        await waitForAutosaveWindow()
        const saveRes = await publicAutosave(anonymous, {
          submissionId: run.submissionId,
          accessToken: run.accessToken,
          baseRevisionId: run.revisionId,
          patch: {
            full_name: 'Uploader Ursula',
            scan: [
              {
                id: attachmentId,
                filename: uploaded!.filename as string,
                contentType: uploaded!.contentType as string,
                sizeBytes: uploaded!.sizeBytes as number,
              },
            ],
          },
        })
        const saved = await readJsonSafe<{ revision?: { changedFieldKeys?: string[] } }>(saveRes)
        expect(
          saveRes.status(),
          `attaching the reference should succeed (got ${saveRes.status()}: ${JSON.stringify(saved)})`,
        ).toBe(200)
        expect(
          saved?.revision?.changedFieldKeys,
          'the revision records the file field as changed',
        ).toContain('scan')

        const readRes = await anonymous.get(`/api/forms/public/submissions/${run.submissionId}`, {
          headers: { Authorization: `Bearer ${run.accessToken}` },
        })
        const view = await readJsonSafe<{ decoded_data?: Record<string, unknown> }>(readRes)
        const storedRefs = view?.decoded_data?.scan as Array<Record<string, unknown>> | undefined
        expect(Array.isArray(storedRefs), 'the file answer persists as an array of references').toBe(true)
        expect(storedRefs?.length, 'exactly one file is attached').toBe(1)
        expect(storedRefs?.[0]?.id, 'the stored reference points at the uploaded attachment').toBe(attachmentId)
      })
    } finally {
      await deleteDistributionIfExists(request, adminToken, distributionId)
      await deleteFormIfExists(request, adminToken, formId)
    }
  })
})
