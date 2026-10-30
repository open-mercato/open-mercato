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
 * TC-FORMS-ATT-002: an upload is only accepted for a field the version declares
 * as `x-om-type: 'file'`.
 *
 * `resolveFieldUploadConfig` reads the field node off the submission's PINNED
 * version and returns `null` for anything that is not a file field, which the
 * route turns into `422 INVALID_FIELD`. Without that gate the upload endpoint
 * would be a general-purpose, unauthenticated-ish blob store keyed by any string
 * the client chooses: a caller could park arbitrary encrypted bytes against a
 * submission under field keys the form never declared, and nothing downstream
 * (export, PDF, retention purge) would know they exist.
 *
 * The `field_key`-less and file-less bodies are covered too, because those are
 * the malformed-multipart paths and they must be client errors rather than
 * unhandled 500s.
 */
test.describe('TC-FORMS-ATT-002: uploads are gated on the field type', () => {
  test('refuses a text field, an unknown field and a malformed multipart body', async ({ request }) => {
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

        // `full_name` is a declared field, but it is `x-om-type: 'text'`.
        const textFieldRes = await publicUploadAttachment(anonymous, {
          submissionId: run.submissionId,
          accessToken: run.accessToken,
          fieldKey: 'full_name',
          filename: 'qa-att-002.png',
          contentType: 'image/png',
          bytes,
        })
        const textFieldBody = await readJsonSafe<{ error?: string; id?: string }>(textFieldRes)
        expect(
          textFieldRes.status(),
          `uploading to a text field must be refused (got ${textFieldRes.status()}: ${JSON.stringify(textFieldBody)})`,
        ).toBe(422)
        expect(textFieldBody?.error, 'the refusal names the invalid field').toBe('INVALID_FIELD')
        expect(textFieldBody?.id, 'nothing was stored').toBeFalsy()

        // A field key the version does not declare at all.
        const unknownFieldRes = await publicUploadAttachment(anonymous, {
          submissionId: run.submissionId,
          accessToken: run.accessToken,
          fieldKey: 'not_a_declared_field',
          filename: 'qa-att-002.png',
          contentType: 'image/png',
          bytes,
        })
        const unknownFieldBody = await readJsonSafe<{ error?: string; id?: string }>(unknownFieldRes)
        expect(
          unknownFieldRes.status(),
          `uploading to an undeclared field must be refused (got ${unknownFieldRes.status()}: ${JSON.stringify(unknownFieldBody)})`,
        ).toBe(422)
        expect(unknownFieldBody?.error).toBe('INVALID_FIELD')
        expect(unknownFieldBody?.id, 'nothing was stored').toBeFalsy()

        // Malformed multipart: no `field_key` part.
        const noFieldKeyRes = await anonymous.fetch(
          `/api/forms/public/submissions/${run.submissionId}/attachments`,
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${run.accessToken}` },
            multipart: { file: { name: 'x.png', mimeType: 'image/png', buffer: bytes } },
          },
        )
        expect(noFieldKeyRes.status(), 'a body with no field_key is a client error').toBe(422)
        expect((await readJsonSafe<{ error?: string }>(noFieldKeyRes))?.error).toBe('VALIDATION_FAILED')

        // Malformed multipart: no `file` part.
        const noFileRes = await anonymous.fetch(
          `/api/forms/public/submissions/${run.submissionId}/attachments`,
          {
            method: 'POST',
            headers: { Authorization: `Bearer ${run.accessToken}` },
            multipart: { field_key: 'scan' },
          },
        )
        expect(noFileRes.status(), 'a body with no file part is a client error').toBe(422)
        expect((await readJsonSafe<{ error?: string }>(noFileRes))?.error).toBe('VALIDATION_FAILED')

        // Control: the declared file field accepts the same bytes, proving the
        // refusals above were about the field and not the payload.
        const goodRes = await publicUploadAttachment(anonymous, {
          submissionId: run.submissionId,
          accessToken: run.accessToken,
          fieldKey: 'scan',
          filename: 'qa-att-002.png',
          contentType: 'image/png',
          bytes,
        })
        expect(
          goodRes.status(),
          `the declared file field accepts the upload (got ${goodRes.status()}: ${await goodRes.text()})`,
        ).toBe(201)
      })
    } finally {
      await deleteDistributionIfExists(request, adminToken, distributionId)
      await deleteFormIfExists(request, adminToken, formId)
    }
  })
})
