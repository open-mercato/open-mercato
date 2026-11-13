import { expect, test, type APIRequestContext } from '@playwright/test'
import { withAttachmentOwnerFixture } from '@open-mercato/core/helpers/integration/attachmentAccessFixtures'
import { deleteAttachmentIfExists } from '@open-mercato/core/helpers/integration/attachmentsFixtures'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export const integrationMeta = { dependsOnModules: ['documents'] }

const BASE_URL = process.env.BASE_URL?.trim() || 'http://localhost:3000'

async function attemptUpload(
  request: APIRequestContext,
  token: string,
  input: { entityId: string; recordId: string; fileName: string; assignments?: Array<{ type: string; id: string }> },
) {
  return request.fetch(`${BASE_URL}/api/attachments`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    multipart: {
      entityId: input.entityId,
      recordId: input.recordId,
      file: { name: input.fileName, mimeType: 'text/plain', buffer: Buffer.from(input.fileName) },
      ...(input.assignments ? { assignments: JSON.stringify(input.assignments) } : {}),
    },
  })
}

test('TC-ATT-028: generic upload denies a document owner or assignment the caller cannot edit', async ({ request }) => {
  await withAttachmentOwnerFixture(request, async (fixture) => {
    // `fixture.visible` was shared `viewer` by the fixture setup; a viewer cannot upload.
    const deniedViewer = await attemptUpload(request, fixture.recipient.token, {
      entityId: 'documents:document', recordId: fixture.visible, fileName: `${fixture.prefix}-viewer.txt`,
    })
    expect(deniedViewer.status()).toBe(404)

    // No share at all for `fixture.hidden` — denied the same way.
    const deniedUnshared = await attemptUpload(request, fixture.unshared.token, {
      entityId: 'documents:document', recordId: fixture.hidden, fileName: `${fixture.prefix}-unshared.txt`,
    })
    expect(deniedUnshared.status()).toBe(404)

    // A protected secondary assignment denies the upload even when the primary
    // owner is an unrelated, unprotected entity type (#8891).
    const deniedAssignment = await attemptUpload(request, fixture.recipient.token, {
      entityId: 'attachments:library', recordId: fixture.prefix, fileName: `${fixture.prefix}-assignment.txt`,
      assignments: [{ type: 'documents:document', id: fixture.hidden }],
    })
    expect(deniedAssignment.status()).toBe(404)

    // Upgrading the same caller to an editor share lets the upload through.
    await fixture.share(fixture.visible, 'editor')
    const allowed = await attemptUpload(request, fixture.recipient.token, {
      entityId: 'documents:document', recordId: fixture.visible, fileName: `${fixture.prefix}-editor.txt`,
    })
    expect(allowed.status()).toBe(200)
    const body = await readJsonSafe<{ item?: { id?: string } }>(allowed)
    const attachmentId = body?.item?.id
    expect(attachmentId).toBeTruthy()
    await deleteAttachmentIfExists(request, fixture.admin, attachmentId ?? null)
  })
})
