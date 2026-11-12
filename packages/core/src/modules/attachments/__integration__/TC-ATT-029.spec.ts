import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  deleteAttachmentIfExists,
  uploadAttachmentFixture,
} from '@open-mercato/core/helpers/integration/attachmentsFixtures'
import { withClient } from '@open-mercato/core/helpers/integration/dbFixtures'
import { getTokenScope } from '@open-mercato/core/helpers/integration/generalFixtures'

test.describe('TC-ATT-029: extracted text with U+0000 does not fail the upload', () => {
  test('should store a text/plain upload without the NUL character', async ({ request }) => {
    expect(process.env.DATABASE_URL?.trim(), 'Native integration runner must provide its database').toBeTruthy()
    const token = await getAuthToken(request)
    const scope = getTokenScope(token)
    const partitionId = randomUUID()
    const partitionCode = `nul_text_${randomUUID().replaceAll('-', '')}`
    let attachmentId: string | null = null

    await withClient((client) => client.query(
      `insert into attachment_partitions
        (id, code, title, storage_driver, config_json, is_public, requires_ocr,
         tenant_id, organization_id, created_at, updated_at)
       values ($1, $2, $3, 'local', '{}'::jsonb, false, true, $4, $5, now(), now())`,
      [partitionId, partitionCode, 'NUL extraction integration fixture', scope.tenantId, scope.organizationId],
    ))

    try {
      const uploaded = await uploadAttachmentFixture(request, token, {
        entityId: 'attachments:library',
        recordId: randomUUID(),
        partitionCode,
        fileName: 'nul-text.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from('AB\u0000C', 'utf8'),
      })
      attachmentId = uploaded.id
      expect(uploaded.partitionCode).toBe(partitionCode)

      const rows = await withClient((client) => client.query<{ content: string | null }>(
        'select content from attachments where id = $1 and partition_code = $2',
        [attachmentId, partitionCode],
      ))
      expect(rows.rows.map((row) => row.content)).toEqual(['ABC'])
    } finally {
      await deleteAttachmentIfExists(request, token, attachmentId)
      await withClient(async (client) => {
        await client.query('delete from attachments where partition_code = $1', [partitionCode])
        await client.query('delete from attachment_partitions where id = $1', [partitionId])
      })
    }
  })
})
