import type { EntityManager } from '@mikro-orm/postgresql'
import { NextResponse } from 'next/server'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { z } from 'zod'
import { syncExcelPreviewQuerySchema, syncExcelUploadResponseSchema } from '../../data/validators'
import { SyncExcelUpload } from '../../data/entities'
import { buildSuggestedMapping } from '../../lib/mapping'
import { resolveSyncExcelConcreteScope } from '../../lib/scope'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['sync_excel.view'] },
}

const errorSchema = z.object({
  error: z.string(),
})

export const openApi = {
  tags: ['SyncExcel'],
  summary: 'Fetch stored preview for a sync_excel upload',
  methods: {
    GET: {
      summary: 'Fetch upload preview',
      responses: [
        { status: 200, description: 'Stored upload preview', schema: syncExcelUploadResponseSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 422, description: 'Invalid query', schema: errorSchema },
        { status: 404, description: 'Upload preview not found', schema: errorSchema },
      ],
    },
  },
}

export async function GET(request: Request) {
  const auth = await getAuthFromRequest(request)
  if (!auth?.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(request.url)
  const parsedQuery = syncExcelPreviewQuerySchema.safeParse({
    uploadId: url.searchParams.get('uploadId'),
    entityType: url.searchParams.get('entityType') ?? undefined,
  })

  if (!parsedQuery.success) {
    return NextResponse.json({ error: 'Invalid query' }, { status: 422 })
  }

  const container = await createRequestContainer()
  const scopeResult = await resolveSyncExcelConcreteScope({ auth, container, request })
  if (!scopeResult.ok) {
    return NextResponse.json({ error: scopeResult.error }, { status: scopeResult.status })
  }
  const { scope } = scopeResult
  const em = container.resolve('em') as EntityManager
  const upload = await findOneWithDecryption(
    em,
    SyncExcelUpload,
    {
      id: parsedQuery.data.uploadId,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
    },
    undefined,
    scope,
  )

  if (!upload) {
    return NextResponse.json({ error: 'Upload preview not found.' }, { status: 404 })
  }

  const entityType = parsedQuery.data.entityType ?? upload.entityType
  const suggestedMapping = buildSuggestedMapping(entityType, upload.headers)

  return NextResponse.json(syncExcelUploadResponseSchema.parse({
    uploadId: upload.id,
    filename: upload.filename,
    mimeType: upload.mimeType,
    fileSize: upload.fileSize,
    entityType,
    headers: upload.headers,
    sampleRows: upload.sampleRows,
    totalRows: upload.totalRows,
    suggestedMapping,
  }))
}
