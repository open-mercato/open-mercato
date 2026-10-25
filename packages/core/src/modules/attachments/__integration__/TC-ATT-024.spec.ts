import { randomUUID } from 'node:crypto'
import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/modules/core/__integration__/helpers/api'
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/generalFixtures'
import {
  deleteAttachmentIfExists,
  uploadAttachmentFixture,
} from '@open-mercato/core/modules/core/__integration__/helpers/attachmentsFixtures'
import {
  createProductFixture,
  createVariantFixture,
  deleteCatalogProductIfExists,
} from '@open-mercato/core/modules/core/__integration__/helpers/catalogFixtures'
import { withClient } from '@open-mercato/core/modules/core/__integration__/helpers/dbFixtures'
import {
  decodeJwtSubject,
  deleteMessageIfExists,
} from '@open-mercato/core/modules/messages/__integration__/helpers'

export const integrationMeta = {
  dependsOnModules: ['attachments', 'catalog', 'messages'],
}

/**
 * TC-ATT-024: Deleting one attachment row keeps the stored file other rows still reference
 *
 * Catalog copies variant media onto the product, and forwarding a message copies the source
 * message's attachments onto the forward. Both copies reuse the source row's stored file
 * (`storage_path`). Deleting either row must leave the file readable through every other row
 * that still references it; only the last referencing row may remove the stored file.
 */

type ListedAttachment = { id: string; fileName: string }

async function listRecordAttachments(
  request: APIRequestContext,
  token: string,
  entityId: string,
  recordId: string,
): Promise<ListedAttachment[]> {
  const params = new URLSearchParams({ entityId, recordId, pageSize: '100' })
  const response = await apiRequest(request, 'GET', `/api/attachments?${params.toString()}`, { token })
  expect(response.ok(), `record attachments list failed: ${response.status()}`).toBeTruthy()
  const body = await readJsonSafe<{ items?: ListedAttachment[] }>(response)
  return body?.items ?? []
}

async function readStoredPaths(attachmentIds: string[]): Promise<Map<string, string>> {
  return withClient(async (client) => {
    const result = await client.query<{ id: string; storage_path: string }>(
      'select id, storage_path from attachments where id = any($1::uuid[])',
      [attachmentIds],
    )
    return new Map(result.rows.map((row) => [row.id, row.storage_path]))
  })
}

async function expectFileContent(
  request: APIRequestContext,
  token: string,
  attachmentId: string,
  content: string,
): Promise<void> {
  const response = await apiRequest(request, 'GET', `/api/attachments/file/${attachmentId}?download=1`, { token })
  expect(response.status(), `stored file of attachment ${attachmentId} must stay readable`).toBe(200)
  expect((await response.body()).toString('utf8')).toBe(content)
}

async function expectAttachmentDeleted(
  request: APIRequestContext,
  token: string,
  attachmentId: string,
): Promise<void> {
  const response = await apiRequest(request, 'DELETE', `/api/attachments?id=${encodeURIComponent(attachmentId)}`, { token })
  expect(response.status(), `DELETE /api/attachments?id=${attachmentId}`).toBe(200)
}

test.describe('TC-ATT-024: Shared stored files survive deleting one referencing attachment', () => {
  test('deleting the product copy of variant media keeps the variant file readable', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const tag = randomUUID().slice(0, 8)
    const content = `variant media ${tag}\n`
    let productId: string | null = null
    let variantAttachmentId: string | null = null
    let productCopyId: string | null = null

    try {
      productId = await createProductFixture(request, token, { title: `QA TC-ATT-024 ${tag}`, sku: `QA-ATT-024-${tag}` })
      const variantId = await createVariantFixture(request, token, {
        productId,
        name: `QA TC-ATT-024 variant ${tag}`,
        sku: `QA-ATT-024-V-${tag}`,
      })
      const uploaded = await uploadAttachmentFixture(request, token, {
        entityId: 'catalog:catalog_product_variant',
        recordId: variantId,
        fileName: `tc-att-024-${tag}.txt`,
        mimeType: 'text/plain',
        buffer: Buffer.from(content, 'utf8'),
      })
      variantAttachmentId = uploaded.id

      const touchVariant = await apiRequest(request, 'PUT', '/api/catalog/variants', {
        token,
        data: { id: variantId, name: `QA TC-ATT-024 variant ${tag} renamed` },
      })
      expect(touchVariant.ok(), `variant update failed: ${touchVariant.status()}`).toBeTruthy()

      const productItems = await listRecordAttachments(request, token, 'catalog:catalog_product', productId)
      const productCopy = productItems.find((item) => item.fileName === uploaded.fileName)
      expect(productCopy, 'saving the variant copies its media onto the product').toBeTruthy()
      productCopyId = productCopy!.id
      const storedPaths = await readStoredPaths([variantAttachmentId, productCopyId])
      expect(storedPaths.get(productCopyId)).toBe(storedPaths.get(variantAttachmentId))

      await expectAttachmentDeleted(request, token, productCopyId)
      productCopyId = null

      await expectFileContent(request, token, variantAttachmentId, content)
    } finally {
      await deleteAttachmentIfExists(request, token, productCopyId)
      await deleteAttachmentIfExists(request, token, variantAttachmentId)
      await deleteCatalogProductIfExists(request, token, productId)
    }
  })

  test('deleting a forwarded copy keeps the original message attachment readable, and vice versa', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const employeeToken = await getAuthToken(request, 'employee')
    const employeeUserId = decodeJwtSubject(employeeToken)
    const tag = randomUUID().slice(0, 8)
    const content = `message attachment ${tag}\n`
    const fileName = `tc-att-024-msg-${tag}.txt`
    let messageId: string | null = null
    let forwardIds: string[] = []
    let originalAttachmentId: string | null = null
    let forwardCopyIds: string[] = []

    try {
      const uploaded = await uploadAttachmentFixture(request, adminToken, {
        entityId: 'messages:message',
        recordId: randomUUID(),
        fileName,
        mimeType: 'text/plain',
        buffer: Buffer.from(content, 'utf8'),
      })
      originalAttachmentId = uploaded.id

      const compose = await apiRequest(request, 'POST', '/api/messages', {
        token: adminToken,
        data: {
          recipients: [{ userId: employeeUserId, type: 'to' }],
          subject: `QA TC-ATT-024 ${tag}`,
          body: 'Message with an attachment',
          attachmentIds: [originalAttachmentId],
          sendViaEmail: false,
        },
      })
      expect(compose.status(), 'POST /api/messages').toBe(201)
      messageId = (await readJsonSafe<{ id?: string }>(compose))?.id ?? null
      expect(messageId).toBeTruthy()

      for (let index = 0; index < 2; index += 1) {
        const forward = await apiRequest(request, 'POST', `/api/messages/${messageId}/forward`, {
          token: adminToken,
          data: {
            recipients: [{ userId: employeeUserId, type: 'to' }],
            includeAttachments: true,
            sendViaEmail: false,
          },
        })
        expect(forward.status(), 'POST /api/messages/:id/forward').toBe(201)
        const forwardId = (await readJsonSafe<{ id?: string }>(forward))?.id ?? null
        expect(forwardId).toBeTruthy()
        forwardIds.push(forwardId!)
        const forwardItems = await listRecordAttachments(request, adminToken, 'messages:message', forwardId!)
        const copy = forwardItems.find((item) => item.fileName === fileName)
        expect(copy, 'forwarding copies the attachment onto the forward').toBeTruthy()
        forwardCopyIds.push(copy!.id)
      }

      const storedPaths = await readStoredPaths([originalAttachmentId, ...forwardCopyIds])
      for (const copyId of forwardCopyIds) {
        expect(storedPaths.get(copyId)).toBe(storedPaths.get(originalAttachmentId))
      }

      await expectAttachmentDeleted(request, adminToken, forwardCopyIds[0])
      await expectFileContent(request, adminToken, originalAttachmentId, content)
      await expectFileContent(request, adminToken, forwardCopyIds[1], content)

      await expectAttachmentDeleted(request, adminToken, originalAttachmentId)
      originalAttachmentId = null
      await expectFileContent(request, adminToken, forwardCopyIds[1], content)
      forwardCopyIds = forwardCopyIds.slice(1)
    } finally {
      for (const copyId of forwardCopyIds) await deleteAttachmentIfExists(request, adminToken, copyId)
      await deleteAttachmentIfExists(request, adminToken, originalAttachmentId)
      for (const forwardId of forwardIds) await deleteMessageIfExists(request, adminToken, forwardId)
      forwardIds = []
      await deleteMessageIfExists(request, adminToken, messageId)
    }
  })
})
