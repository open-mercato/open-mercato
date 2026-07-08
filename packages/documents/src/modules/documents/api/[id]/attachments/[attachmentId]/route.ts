import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { EntityManager } from '@mikro-orm/postgresql'
import { Attachment, AttachmentPartition } from '@open-mercato/core/modules/attachments/data/entities'
import { StorageDriverFactory } from '@open-mercato/core/modules/attachments/lib/drivers'
import {
  buildAttachmentContentDisposition,
  canRenderInlineAttachment,
} from '@open-mercato/core/modules/attachments/lib/security'
import { DocumentAttachment } from '../../../../data/entities'
import { assertTier } from '../../../../lib/permissions'
import {
  handleDocumentsRouteError,
  resolveDocumentsContext,
  routeErrorSchema,
} from '../../../_shared'

type RouteContext = {
  params: Promise<{ id: string; attachmentId: string }> | { id: string; attachmentId: string }
}

type StorageDriverFactoryLike = Pick<StorageDriverFactory, 'resolveForAttachment'>

const attachmentBinaryResponseSchema = z.unknown().describe('Binary file content')

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['documents.view'] },
}

async function resolveParams(context: RouteContext): Promise<{ documentId: string; attachmentId: string }> {
  const params = await context.params
  return { documentId: params.id, attachmentId: params.attachmentId }
}

function resolveStorageDriverFactory(container: { resolve: (name: string) => unknown }, em: EntityManager): StorageDriverFactoryLike {
  try {
    const candidate = container.resolve('storageDriverFactory') as Partial<StorageDriverFactoryLike> | null
    if (candidate && typeof candidate.resolveForAttachment === 'function') return candidate as StorageDriverFactoryLike
  } catch {
    return new StorageDriverFactory(em)
  }
  return new StorageDriverFactory(em)
}

async function loadDocumentAttachment(
  ctx: Awaited<ReturnType<typeof resolveDocumentsContext>>,
  documentId: string,
  attachmentId: string,
): Promise<DocumentAttachment> {
  const documentAttachment = await ctx.em.findOne(DocumentAttachment, {
    documentId,
    attachmentId,
    tenantId: ctx.tenantId,
    organizationId: ctx.organizationId,
    deletedAt: null,
  })
  if (!documentAttachment) throw new CrudHttpError(404, { error: 'Attachment not found' })
  return documentAttachment
}

async function loadAttachment(
  ctx: Awaited<ReturnType<typeof resolveDocumentsContext>>,
  attachmentId: string,
): Promise<Attachment> {
  const attachment = await ctx.em.findOne(Attachment, {
    id: attachmentId,
    tenantId: ctx.tenantId,
    organizationId: ctx.organizationId,
  })
  if (!attachment) throw new CrudHttpError(404, { error: 'Attachment not found' })
  return attachment
}

async function loadPartition(ctx: Awaited<ReturnType<typeof resolveDocumentsContext>>, attachment: Attachment): Promise<AttachmentPartition> {
  const partition = await ctx.em.findOne(AttachmentPartition, { code: attachment.partitionCode })
  if (!partition) throw new CrudHttpError(500, { error: 'Partition misconfigured' })
  return partition
}

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  try {
    const { documentId, attachmentId } = await resolveParams(context)
    const ctx = await resolveDocumentsContext(request, ['documents.view'])
    await assertTier(ctx.em, documentId, ctx.auth, 'viewer')
    await loadDocumentAttachment(ctx, documentId, attachmentId)
    const attachment = await loadAttachment(ctx, attachmentId)
    const partition = await loadPartition(ctx, attachment)
    const storageDriverFactory = resolveStorageDriverFactory(ctx.container, ctx.em)
    const driver = storageDriverFactory.resolveForAttachment(
      attachment.storageDriver || partition.storageDriver || 'local',
      partition.configJson ?? null,
    )

    let buffer: Buffer
    let contentType: string | undefined
    try {
      const result = await driver.read(attachment.partitionCode, attachment.storagePath)
      buffer = result.buffer
      contentType = result.contentType
    } catch {
      throw new CrudHttpError(404, { error: 'File not available' })
    }

    const forceDownload = new URL(request.url).searchParams.get('download') === '1'
    const renderInline = !forceDownload && canRenderInlineAttachment(attachment.mimeType)
    const headers: Record<string, string> = {
      'Cache-Control': 'private, max-age=60',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Content-Type': renderInline
        ? contentType ?? (attachment.mimeType || 'application/octet-stream')
        : 'application/octet-stream',
      'Content-Disposition': buildAttachmentContentDisposition(
        attachment.fileName,
        renderInline ? 'inline' : 'attachment',
      ),
      'Content-Length': String(buffer.length),
      'X-Content-Type-Options': 'nosniff',
    }

    return new NextResponse(new Uint8Array(buffer), { status: 200, headers })
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
      ],
    },
  },
}

export default { GET }
