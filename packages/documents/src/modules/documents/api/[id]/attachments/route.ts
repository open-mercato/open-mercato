import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import {
  DOCUMENT_ATTACHMENT_UPLOAD_CONTEXT,
  type DocumentAttachmentCreateCommandInput,
  type DocumentAttachmentCreateCommandResult,
} from '../../../commands/attachments'
import { DOCUMENTS_ENTITY_IDS } from '../../../lib/constants'
import { readAttachmentUploadForm, resolveAttachmentServicePort } from '../../../lib/attachmentServicePort'
import { assertTier } from '../../../lib/permissions'
import {
  assertDocumentNotArchived,
  handleDocumentsRouteError,
  loadScopedDocument,
  resolveDocumentsContext,
  routeErrorSchema,
  runMutationGuardAfterSuccess,
  validateMutationGuard,
  withDocumentsContextErrors,
} from '../../_shared'
import {
  attachDocumentsOperationMetadata,
  buildDocumentsCommandRuntimeContext,
  resolveDocumentsCommandBus,
} from '../../_commands'

type RouteContext = {
  params: Promise<{ id: string }> | { id: string }
}

const attachmentUploadBodySchema = z.object({
  file: z.string().min(1).describe('Binary file payload supplied as multipart form-data'),
})

// The guard sees exactly the fields the command consumes. `fileSize` is pinned
// to the real byte length: a guard may rename or retype a file, but it must not
// be able to talk the route past the upload-size validation below.
const attachmentGuardPayloadSchema = z.object({
  fileName: z.string().trim().min(1),
  fileType: z.string(),
  fileSize: z.number().int().nonnegative(),
})

const attachmentUploadResponseSchema = z.object({
  id: z.string().uuid(),
  attachmentId: z.string().uuid(),
  updatedAt: z.string().datetime(),
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
    await assertDocumentNotArchived(ctx, documentId)
    await loadScopedDocument(ctx, documentId)
    const attachmentService = resolveAttachmentServicePort(ctx.container)
    assertMultipartUpload(request)
    const form = await readAttachmentUploadForm(attachmentService, request)
    const file = readUploadFile(form)
    attachmentService.validateUpload({ fileName: file.name, fileSize: file.size })
    const guardPayload = attachmentGuardPayloadSchema.parse({
      fileName: file.name,
      fileType: file.type,
      fileSize: file.size,
    })
    const guardResult = await validateMutationGuard(ctx, {
      resourceKind: DOCUMENTS_ENTITY_IDS.documentAttachment,
      resourceId: documentId,
      operation: 'create',
      mutationPayload: guardPayload,
      mutationPayloadSchema: attachmentGuardPayloadSchema.refine(
        (payload) => payload.fileSize === file.size,
        { path: ['fileSize'], message: '[internal] mutation guard changed the file size' },
      ),
    })
    // Re-validate against the possibly rewritten name before the bytes are read.
    attachmentService.validateUpload({
      fileName: guardPayload.fileName,
      fileSize: guardPayload.fileSize,
    })

    const buffer = Buffer.from(await file.arrayBuffer())
    const commandInput: DocumentAttachmentCreateCommandInput = {
      documentId,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      fileName: guardPayload.fileName,
      fileType: guardPayload.fileType || null,
      fileSize: guardPayload.fileSize,
    }
    const commandContext = {
      ...buildDocumentsCommandRuntimeContext(ctx),
      [DOCUMENT_ATTACHMENT_UPLOAD_CONTEXT]: { buffer },
    }
    const { result, logEntry } = await resolveDocumentsCommandBus(ctx).execute<
      DocumentAttachmentCreateCommandInput,
      DocumentAttachmentCreateCommandResult
    >('documents.attachment.create', {
      input: commandInput,
      ctx: commandContext,
    })

    await runMutationGuardAfterSuccess(ctx, guardResult, {
      resourceKind: DOCUMENTS_ENTITY_IDS.documentAttachment,
      resourceId: result.linkId,
      operation: 'create',
    })

    const url = `/api/documents/${encodeURIComponent(documentId)}/attachments/${encodeURIComponent(result.attachmentId)}`
    const response = NextResponse.json({
      id: result.id,
      attachmentId: result.attachmentId,
      updatedAt: result.updatedAt,
      url,
    }, { status: 201 })
    return attachDocumentsOperationMetadata(response, logEntry, {
      resourceKind: DOCUMENTS_ENTITY_IDS.documentAttachment,
      resourceId: result.linkId,
    })
  } catch (error) {
    return handleDocumentsRouteError(error, 'documents.attachments.create')
  }
}

export const openApi: OpenApiRouteDoc = withDocumentsContextErrors({
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
})

export default { POST }
