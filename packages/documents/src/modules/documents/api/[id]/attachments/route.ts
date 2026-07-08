import { NextResponse } from 'next/server'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { EntityManager } from '@mikro-orm/postgresql'
import { Attachment, AttachmentPartition } from '@open-mercato/core/modules/attachments/data/entities'
import { buildAttachmentFileUrl } from '@open-mercato/core/modules/attachments/lib/imageUrls'
import {
  detectAttachmentMimeType,
  hasDangerousExecutableExtension,
  isActiveContentAttachment,
  sanitizeUploadedFileName,
} from '@open-mercato/core/modules/attachments/lib/security'
import { StorageDriverFactory } from '@open-mercato/core/modules/attachments/lib/drivers'
import {
  isMultipartRequestWithinUploadLimit,
  resolveAttachmentMaxBytes,
} from '@open-mercato/core/modules/attachments/lib/upload-limits'
import { resolveDefaultAttachmentOcrEnabled } from '@open-mercato/core/modules/attachments/lib/ocrConfig'
import { DocumentAttachment } from '../../../data/entities'
import { DOCUMENTS_ENTITY_IDS } from '../../../lib/constants'
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

type StorageDriverFactoryLike = Pick<StorageDriverFactory, 'resolveForAttachment'>

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

function resolveStorageDriverFactory(container: { resolve: (name: string) => unknown }, em: EntityManager): StorageDriverFactoryLike {
  try {
    const candidate = container.resolve('storageDriverFactory') as Partial<StorageDriverFactoryLike> | null
    if (candidate && typeof candidate.resolveForAttachment === 'function') return candidate as StorageDriverFactoryLike
  } catch {
    return new StorageDriverFactory(em)
  }
  return new StorageDriverFactory(em)
}

async function resolveDocumentAttachmentPartition(ctx: Awaited<ReturnType<typeof resolveDocumentsContext>>): Promise<AttachmentPartition> {
  let partition = await ctx.em.findOne(AttachmentPartition, { code: DOCUMENT_ATTACHMENT_PARTITION_CODE })
  if (!partition) {
    partition = ctx.em.create(AttachmentPartition, {
      code: DOCUMENT_ATTACHMENT_PARTITION_CODE,
      title: 'Private attachments',
      description: 'Internal attachments scoped to tenants and organizations.',
      storageDriver: 'local',
      isPublic: false,
      requiresOcr: resolveDefaultAttachmentOcrEnabled(),
    })
    ctx.em.persist(partition)
    await ctx.em.flush()
  }
  if (partition.isPublic) {
    throw new CrudHttpError(400, { error: 'Private attachment partition is not configured' })
  }
  return partition
}

function assertMultipartUpload(request: Request): void {
  const contentType = request.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().includes('multipart/form-data')) {
    throw new CrudHttpError(400, { error: 'Expected multipart/form-data' })
  }
  if (!isMultipartRequestWithinUploadLimit(request.headers.get('content-length'))) {
    throw new CrudHttpError(413, { error: 'Attachment exceeds the maximum upload size.' })
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
    const form = await request.formData()
    const file = readUploadFile(form)
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

    if (hasDangerousExecutableExtension(file.name)) {
      throw new CrudHttpError(400, { error: 'Executable file types are not allowed as attachments.' })
    }
    const maxBytes = resolveAttachmentMaxBytes(null)
    if (file.size > maxBytes) {
      throw new CrudHttpError(413, { error: 'Attachment exceeds the maximum upload size.' })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const safeName = sanitizeUploadedFileName(file.name)
    const mimeType = detectAttachmentMimeType(buffer, safeName, file.type)
    if (isActiveContentAttachment(buffer, safeName, mimeType)) {
      throw new CrudHttpError(400, { error: 'Active content uploads are not allowed.' })
    }

    const partition = await resolveDocumentAttachmentPartition(ctx)
    const storageDriverFactory = resolveStorageDriverFactory(ctx.container, ctx.em)
    const uploadDriver = storageDriverFactory.resolveForAttachment(partition.storageDriver || 'local', partition.configJson ?? null)
    const stored = await uploadDriver.store({
      partitionCode: partition.code,
      orgId: ctx.organizationId,
      tenantId: ctx.tenantId,
      fileName: safeName,
      buffer,
    })

    const userId = resolveActorUserId(ctx.auth)
    const attachmentId = randomUUID()
    const attachment = ctx.em.create(Attachment, {
      id: attachmentId,
      entityId: DOCUMENTS_ENTITY_IDS.document,
      recordId: documentId,
      organizationId: ctx.organizationId,
      tenantId: ctx.tenantId,
      partitionCode: partition.code,
      fileName: safeName,
      mimeType,
      fileSize: buffer.length,
      storageDriver: partition.storageDriver || 'local',
      storagePath: stored.storagePath,
      storageMetadata: {
        assignments: [{ type: DOCUMENTS_ENTITY_IDS.document, id: documentId }],
      },
      url: buildAttachmentFileUrl(attachmentId),
      content: null,
    })
    const documentAttachment = ctx.em.create(DocumentAttachment, {
      id: randomUUID(),
      tenantId: ctx.tenantId,
      organizationId: ctx.organizationId,
      documentId,
      attachmentId,
      createdByUserId: userId,
    })
    ctx.em.persist([attachment, documentAttachment])
    await ctx.em.flush()

    await runMutationGuardAfterSuccess(ctx, guardResult, {
      resourceKind: DOCUMENTS_ENTITY_IDS.documentAttachment,
      resourceId: documentId,
      operation: 'create',
    })

    const url = `/api/documents/${encodeURIComponent(documentId)}/attachments/${encodeURIComponent(attachmentId)}`
    return NextResponse.json({ id: attachmentId, attachmentId, url }, { status: 201 })
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
      ],
    },
  },
}

export default { POST }
