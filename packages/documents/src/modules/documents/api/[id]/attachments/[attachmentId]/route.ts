import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { DocumentAttachment } from '../../../../data/entities'
import { DOCUMENTS_ENTITY_IDS } from '../../../../lib/constants'
import { resolveAttachmentServicePort } from '../../../../lib/attachmentServicePort'
import { assertTier } from '../../../../lib/permissions'
import {
  handleDocumentsRouteError,
  resolveDocumentsContext,
  routeErrorSchema,
} from '../../../_shared'

type RouteContext = {
  params: Promise<{ id: string; attachmentId: string }> | { id: string; attachmentId: string }
}

const attachmentBinaryResponseSchema = z.unknown().describe('Binary file content')
const DOCUMENT_ATTACHMENT_PARTITION_CODE = 'privateAttachments'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['documents.view'] },
}

async function resolveParams(context: RouteContext): Promise<{ documentId: string; attachmentId: string }> {
  const params = await context.params
  return { documentId: params.id, attachmentId: params.attachmentId }
}

async function loadDocumentAttachment(
  ctx: Awaited<ReturnType<typeof resolveDocumentsContext>>,
  documentId: string,
  attachmentId: string,
): Promise<DocumentAttachment> {
  const documentAttachment = await findOneWithDecryption(
    ctx.em,
    DocumentAttachment,
    {
      documentId,
      attachmentId,
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      deletedAt: null,
    },
    undefined,
    { tenantId: ctx.tenantId, organizationId: ctx.organizationId },
  )
  if (!documentAttachment) throw new CrudHttpError(404, { error: 'Attachment not found' })
  return documentAttachment
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { documentId, attachmentId } = await resolveParams(context)
    const ctx = await resolveDocumentsContext(request, ['documents.view'])
    await assertTier(ctx.em, documentId, ctx.auth, 'viewer')
    await loadDocumentAttachment(ctx, documentId, attachmentId)
    const forceDownload = new URL(request.url).searchParams.get('download') === '1'
    const attachmentService = resolveAttachmentServicePort(ctx.container)
    const result = await attachmentService.readScoped({
      attachmentId,
      auth: ctx.auth,
      expectedOwner: { entityId: DOCUMENTS_ENTITY_IDS.document, recordId: documentId },
      expectedAssignment: { type: DOCUMENTS_ENTITY_IDS.document, id: documentId },
      expectedPartitionCode: DOCUMENT_ATTACHMENT_PARTITION_CODE,
      requirePrivatePartition: true,
      forceDownload,
    })
    const headers: Record<string, string> = {
      'Cache-Control': 'private, max-age=60',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Content-Type': result.contentType,
      'Content-Disposition': result.contentDisposition,
      'Content-Length': String(result.buffer.length),
      'X-Content-Type-Options': 'nosniff',
    }

    return new NextResponse(new Uint8Array(result.buffer), { status: 200, headers })
  } catch (error) {
    return handleDocumentsRouteError(error, 'documents.attachments.read')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Documents',
  summary: 'Read document attachment',
  pathParams: z.object({
    id: z.string().uuid(),
    attachmentId: z.string().uuid(),
  }),
  methods: {
    GET: {
      summary: 'Read a document-scoped attachment',
      responses: [{ status: 200, description: 'Attachment bytes', schema: attachmentBinaryResponseSchema }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: routeErrorSchema },
        { status: 403, description: 'Forbidden', schema: routeErrorSchema },
        { status: 404, description: 'Attachment not found', schema: routeErrorSchema },
        { status: 500, description: 'Partition misconfigured', schema: routeErrorSchema },
        { status: 503, description: 'Attachment service unavailable', schema: routeErrorSchema },
      ],
    },
  },
}

export default { GET }
