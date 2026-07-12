import { NextResponse } from 'next/server'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { DocumentAttachment } from '../../../data/entities'
import { DOCUMENTS_ENTITY_IDS } from '../../../lib/constants'
import { resolveAttachmentServicePort } from '../../../lib/attachmentServicePort'
import { assertTier } from '../../../lib/permissions'
import {
  handleDocumentsRouteError,
  loadScopedDocument,
  resolveActorUserId,
  resolveDocumentsContext,
  routeErrorSchema,
  runMutationGuardAfterSuccess,
  validateMutationGuard,
} from '../../_shared'

type RouteContext = {
  params: Promise<{ id: string }> | { id: string }
}

const DOCUMENT_ATTACHMENT_PARTITION_CODE = 'privateAttachments'

const attachmentUploadBodySchema = z.object({
  file: z.string().min(1).describe('Binary file payload supplied as multipart form-data'),
})

const attachmentUploadResponseSchema = z.object({
  id: z.string().uuid(),
  attachmentId: z.string().uuid(),
  url: z.string(),
})

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['documents.edit'] },
}

async function resolveId(context: RouteContext): Promise<string> {
  const params = await context.params
  return params.id
}

function assertMultipartUpload(request: Request): void {
  const contentType = request.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().includes('multipart/form-data')) {
    throw new CrudHttpError(400, { error: 'Expected multipart/form-data' })
  }
}

function readUploadFile(form: FormData): File {
  const file = form.get('file')
  if (!(file instanceof File)) {
    throw new CrudHttpError(400, { error: 'File is required' })
  }
  return file
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  try {
    const documentId = await resolveId(context)
    const ctx = await resolveDocumentsContext(request, ['documents.edit'])
    await assertTier(ctx.em, documentId, ctx.auth, 'editor')
    await loadScopedDocument(ctx, documentId)
    assertMultipartUpload(request)
    const attachmentService = resolveAttachmentServicePort(ctx.container)
    attachmentService.validateUpload({ contentLength: request.headers.get('content-length') })
    const form = await request.formData()
    const file = readUploadFile(form)
    attachmentService.validateUpload({ fileName: file.name, fileSize: file.size })
    const guardResult = await validateMutationGuard(ctx, {
      resourceKind: DOCUMENTS_ENTITY_IDS.documentAttachment,
      resourceId: documentId,
      operation: 'create',
      mutationPayload: {
        fileName: file.name,
        fileType: file.type,
        fileSize: file.size,
      },
    })

    const buffer = Buffer.from(await file.arrayBuffer())
    const userId = resolveActorUserId(ctx.auth)
    const created = await attachmentService.createScoped({
      entityId: DOCUMENTS_ENTITY_IDS.document,
      recordId: documentId,
      organizationId: ctx.organizationId,
      tenantId: ctx.tenantId,
      partitionCode: DOCUMENT_ATTACHMENT_PARTITION_CODE,
      fileName: file.name,
      declaredMimeType: file.type,
      buffer,
      assignments: [{ type: DOCUMENTS_ENTITY_IDS.document, id: documentId }],
      persistLink: async (tx, attachmentId) => {
        tx.persist(tx.create(DocumentAttachment, {
          id: randomUUID(),
          tenantId: ctx.tenantId,
          organizationId: ctx.organizationId,
          documentId,
          attachmentId,
          createdByUserId: userId,
        }))
      },
    })

    await runMutationGuardAfterSuccess(ctx, guardResult, {
      resourceKind: DOCUMENTS_ENTITY_IDS.documentAttachment,
      resourceId: documentId,
      operation: 'create',
    })

    const url = `/api/documents/${encodeURIComponent(documentId)}/attachments/${encodeURIComponent(created.id)}`
    return NextResponse.json({ id: created.id, attachmentId: created.id, url }, { status: 201 })
  } catch (error) {
    return handleDocumentsRouteError(error, 'documents.attachments.create')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Documents',
  summary: 'Document attachments',
  pathParams: z.object({ id: z.string().uuid() }),
  methods: {
    POST: {
      summary: 'Upload document attachment',
      requestBody: { contentType: 'multipart/form-data', schema: attachmentUploadBodySchema },
      responses: [{ status: 201, description: 'Document-scoped attachment uploaded', schema: attachmentUploadResponseSchema }],
      errors: [
        { status: 400, description: 'Payload validation error', schema: routeErrorSchema },
        { status: 401, description: 'Unauthorized', schema: routeErrorSchema },
        { status: 403, description: 'Forbidden', schema: routeErrorSchema },
        { status: 413, description: 'Attachment too large', schema: routeErrorSchema },
        { status: 503, description: 'Attachment service unavailable', schema: routeErrorSchema },
      ],
    },
  },
}

export default { POST }
