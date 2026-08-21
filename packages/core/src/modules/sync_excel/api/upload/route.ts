import { randomUUID } from 'crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { z } from 'zod'
import { syncExcelUploadResponseSchema, syncExcelEntityTypeSchema } from '../../data/validators'
import { SyncExcelUpload } from '../../data/entities'
import { buildSuggestedMapping } from '../../lib/mapping'
import { parseCsvPreview } from '../../lib/parser'
import { createSyncExcelUploadAttachment } from '../../lib/upload-storage'
import { resolveSyncExcelConcreteScope } from '../../lib/scope'
import {
  isMultipartRequestWithinUploadLimit,
  isMultipartUploadLimitError,
  parseMultipartFormDataWithinUploadLimit,
  resolveDefaultAttachmentMaxUploadBytes,
} from '../../../attachments/lib/upload-limits'
import {
  ensureAttachmentScanReceipt,
  resolveAttachmentScanGate,
  resolveAttachmentScanHttpError,
  type AttachmentScanReceipt,
} from '../../../attachments/lib/scanning'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('sync_excel').child({ component: 'upload' })

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['sync_excel.run'] },
}

const multipartSchema = z.object({
  entityType: syncExcelEntityTypeSchema.default('customers.person'),
})

const errorSchema = z.object({
  error: z.string(),
})

export const openApi = {
  tags: ['SyncExcel'],
  summary: 'Upload CSV file for sync_excel preview',
  methods: {
    POST: {
      summary: 'Upload CSV file',
      requestBody: {
        contentType: 'multipart/form-data',
      },
      responses: [
        { status: 200, description: 'CSV uploaded and preview parsed', schema: syncExcelUploadResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Invalid multipart payload', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 413, description: 'CSV upload exceeds the maximum upload size', schema: errorSchema },
        { status: 422, description: 'Unsupported input or attachment rejected by the security scanner', schema: errorSchema },
        { status: 503, description: 'Required attachment scanning is unavailable', schema: errorSchema },
      ],
    },
  },
}

export async function POST(request: Request) {
  const { t } = await resolveTranslations()
  const auth = await getAuthFromRequest(request)
  if (!auth?.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const container = await createRequestContainer()
  const scopeResult = await resolveSyncExcelConcreteScope({ auth, container, request })
  if (!scopeResult.ok) {
    return NextResponse.json({ error: scopeResult.error }, { status: scopeResult.status })
  }
  const { scope } = scopeResult

  const contentType = request.headers.get('content-type') || ''
  if (!contentType.toLowerCase().includes('multipart/form-data')) {
    return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 })
  }
  if (!isMultipartRequestWithinUploadLimit(request.headers.get('content-length'))) {
    return NextResponse.json({ error: 'CSV upload exceeds the maximum upload size.' }, { status: 413 })
  }

  let formData: FormData
  try {
    formData = await parseMultipartFormDataWithinUploadLimit(request)
  } catch (error) {
    if (isMultipartUploadLimitError(error)) {
      return NextResponse.json({ error: 'CSV upload exceeds the maximum upload size.' }, { status: 413 })
    }
    throw error
  }
  const parsedPayload = multipartSchema.safeParse({
    entityType: typeof formData.get('entityType') === 'string' ? formData.get('entityType') : undefined,
  })

  if (!parsedPayload.success) {
    return NextResponse.json({ error: 'Invalid upload payload.' }, { status: 422 })
  }

  const file = formData.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Select a CSV file to upload.' }, { status: 400 })
  }

  const supportedMimeTypes = new Set(['text/csv', 'application/vnd.ms-excel', 'application/csv'])
  const isCsvByMime = supportedMimeTypes.has(file.type)
  const isCsvByName = file.name.toLowerCase().endsWith('.csv')

  if (!isCsvByMime && !isCsvByName) {
    return NextResponse.json({ error: 'Only CSV uploads are supported in this foundation slice.' }, { status: 422 })
  }

  const maxUploadBytes = resolveDefaultAttachmentMaxUploadBytes()
  if (file.size > maxUploadBytes) {
    return NextResponse.json({ error: 'CSV upload exceeds the maximum upload size.' }, { status: 413 })
  }

  const fileBuffer = Buffer.from(await file.arrayBuffer())
  const attachmentScanGate = resolveAttachmentScanGate(container)
  let securityScanReceipt: AttachmentScanReceipt
  try {
    securityScanReceipt = await ensureAttachmentScanReceipt({
      gate: attachmentScanGate,
      request: {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        fileName: file.name,
        mimeType: file.type || 'text/csv',
        source: 'sync_excel',
        buffer: fileBuffer,
      },
    })
  } catch (error) {
    const mapped = resolveAttachmentScanHttpError(error) ?? {
      status: 503 as const,
      translationKey: 'attachments.errors.scanUnavailable',
      fallback: 'Attachment scanning is temporarily unavailable.',
    }
    logger.error('Attachment scan gate failed', {
      errorType: error instanceof Error ? error.name : typeof error,
    })
    return NextResponse.json({ error: t(mapped.translationKey, mapped.fallback) }, { status: mapped.status })
  }
  const preview = parseCsvPreview(fileBuffer, { maxRows: 5 })
  const suggestedMapping = buildSuggestedMapping(parsedPayload.data.entityType, preview.headers)

  const em = container.resolve('em') as EntityManager
  const uploadId = randomUUID()
  const attachment = await createSyncExcelUploadAttachment({
    em,
    uploadId,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    fileName: file.name,
    mimeType: file.type || 'text/csv',
    buffer: fileBuffer,
    attachmentScanGate,
    securityScanReceipt,
  })

  const upload = em.create(SyncExcelUpload, {
    id: uploadId,
    attachmentId: attachment.id,
    filename: file.name,
    mimeType: file.type || 'text/csv',
    fileSize: fileBuffer.length,
    entityType: parsedPayload.data.entityType,
    delimiter: preview.delimiter,
    encoding: preview.encoding,
    headers: preview.headers,
    sampleRows: preview.sampleRows,
    totalRows: preview.totalRows,
    status: 'uploaded',
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
  })

  em.persist(upload)
  await em.flush()

  return NextResponse.json(syncExcelUploadResponseSchema.parse({
    uploadId: upload.id,
    filename: upload.filename,
    mimeType: upload.mimeType,
    fileSize: upload.fileSize,
    entityType: upload.entityType,
    headers: upload.headers,
    sampleRows: upload.sampleRows,
    totalRows: upload.totalRows,
    suggestedMapping,
  }))
}
