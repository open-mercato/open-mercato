import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deleteAttachmentIfExists, uploadAttachmentFixture } from '@open-mercato/core/helpers/integration/attachmentsFixtures'
import { buildWorkbook } from './helpers/xlsxWorkbook'

const XLSX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

type ExtractionPartition = { code: string; createdId: string | null }

async function prepareExtractionPartition(request: APIRequestContext, token: string): Promise<ExtractionPartition | null> {
  const code = `qa_xlsx_${Date.now()}`
  const createResponse = await apiRequest(request, 'POST', '/api/attachments/partitions', {
    token,
    data: { code, title: 'QA XLSX extraction', isPublic: false, requiresOcr: true },
  })
  if (createResponse.status() === 201) {
    const createBody = await readJsonSafe<{ item?: { id?: string } }>(createResponse)
    return { code, createdId: createBody?.item?.id ?? null }
  }
  expect(createResponse.status(), 'partition creation is either allowed or managed by the environment').toBe(403)
  const listResponse = await apiRequest(request, 'GET', '/api/attachments/partitions', { token })
  const listBody = await readJsonSafe<{ items?: Array<{ code: string; requiresOcr?: boolean }> }>(listResponse)
  const fallback = listBody?.items?.find((item) => item.code === 'privateAttachments')
  return fallback?.requiresOcr ? { code: fallback.code, createdId: null } : null
}

async function readAttachmentContent(request: APIRequestContext, token: string, attachmentId: string): Promise<string | null> {
  const response = await apiRequest(request, 'GET', `/api/attachments/library/${encodeURIComponent(attachmentId)}`, {
    token,
  })
  expect(response.status()).toBe(200)
  const body = await readJsonSafe<{ item?: { content?: string | null } }>(response)
  return body?.item?.content ?? null
}

test.describe('TC-ATT-017: XLSX upload stores extracted sheet text', () => {
  test('stores the sheets of an uploaded workbook as text and keeps a corrupt workbook upload working', async ({
    request,
  }) => {
    const token = await getAuthToken(request, 'admin')
    const recordId = `qa-xlsx-record-${Date.now()}`
    const attachmentIds: string[] = []
    let partition: ExtractionPartition | null = null

    try {
      partition = await prepareExtractionPartition(request, token)
      if (!partition) {
        test.skip(true, 'No partition with text extraction (requiresOcr) is available in this environment')
        return
      }
      const partitionCode = partition.code

      const workbook = await buildWorkbook([
        { name: 'Cennik', rows: [['Indeks', 'Cena'], ['CEM-42', 23.5]] },
        { name: 'Uwagi', rows: [['Ceny netto']] },
      ])
      const uploaded = await uploadAttachmentFixture(request, token, {
        entityId: 'attachments:library',
        recordId,
        fileName: 'cennik.xlsx',
        mimeType: XLSX_MIME_TYPE,
        buffer: workbook,
        partitionCode,
      })
      attachmentIds.push(uploaded.id)
      expect(uploaded.partitionCode).toBe(partitionCode)
      expect(await readAttachmentContent(request, token, uploaded.id)).toBe(
        ['## Cennik', 'Indeks\tCena', 'CEM-42\t23.5', '## Uwagi', 'Ceny netto'].join('\n'),
      )

      const corrupt = await uploadAttachmentFixture(request, token, {
        entityId: 'attachments:library',
        recordId,
        fileName: 'uszkodzony.xlsx',
        mimeType: XLSX_MIME_TYPE,
        buffer: Buffer.from('not a zip archive', 'utf8'),
        partitionCode,
      })
      attachmentIds.push(corrupt.id)
      expect(await readAttachmentContent(request, token, corrupt.id)).toBeNull()
    } finally {
      for (const attachmentId of attachmentIds) {
        await deleteAttachmentIfExists(request, token, attachmentId)
      }
      if (partition?.createdId) {
        await apiRequest(request, 'DELETE', `/api/attachments/partitions?id=${encodeURIComponent(partition.createdId)}`, {
          token,
        })
      }
    }
  })
})
