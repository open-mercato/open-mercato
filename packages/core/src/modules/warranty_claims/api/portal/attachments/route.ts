import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { runRouteMutationGuards, type RouteMutationGuardResult } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { CustomerAuthContext } from '@open-mercato/core/modules/customer_accounts/lib/customerAuth'
import { Attachment, AttachmentPartition } from '@open-mercato/core/modules/attachments/data/entities'
import { buildAttachmentImageUrl, slugifyAttachmentFileName } from '@open-mercato/core/modules/attachments/lib/imageUrls'
import { StorageDriverFactory } from '@open-mercato/core/modules/attachments/lib/drivers'
import { checkAttachmentAccess } from '@open-mercato/core/modules/attachments/lib/access'
import { attachmentCrudEvents, attachmentCrudIndexer } from '@open-mercato/core/modules/attachments/lib/crud'
import { readAttachmentMetadata } from '@open-mercato/core/modules/attachments/lib/metadata'
import { clearAttachmentThumbnailCache } from '@open-mercato/core/modules/attachments/lib/thumbnailCache'
import { isMultipartRequestWithinUploadLimit } from '@open-mercato/core/modules/attachments/lib/upload-limits'
import {
  isScopedAttachmentUploadError,
  type ScopedAttachmentUploadErrorCode,
} from '@open-mercato/core/modules/attachments/lib/scoped-upload-service'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { WarrantyClaim } from '../../../data/entities'
import { WARRANTY_CLAIM_RESOURCE_KIND } from '../../../commands/shared'
import { CUSTOMER_VISIBLE_ATTACHMENT_TAG, isCustomerVisibleAttachment } from '../../../lib/attachmentVisibility'
import { loadPortalOwnedClaim } from '../../../lib/portalClaimAccess'
import { resolvePortalAttachmentUploadService } from '../../../lib/portalAttachmentUpload'
import { resolveLinkedCustomerAuth } from '../../../lib/portalAuthGuard'

const CLAIM_ATTACHMENT_ENTITY_ID = 'warranty_claims:warranty_claim'
const logger = createLogger('warranty_claims').child({ route: 'portal-attachments' })
const ATTACHMENT_ERROR_TRANSLATIONS: Partial<Record<ScopedAttachmentUploadErrorCode, readonly [string, string]>> = {
  dangerous_executable: ['attachments.errors.dangerousExecutable', 'Executable file types are not allowed as attachments.'],
  max_upload_size: ['attachments.errors.maxUploadSize', 'Attachment exceeds the maximum upload size.'],
  active_content: ['attachments.errors.activeContentBlocked', 'Active content uploads are not allowed.'],
}

export const metadata = {
  GET: { requireAuth: false },
  POST: { requireAuth: false },
  PUT: { requireAuth: false },
  DELETE: { requireAuth: false },
}

const attachmentQuerySchema = z.object({
  claimId: z.string().uuid(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
})

const uploadBodySchema = z.object({
  claimId: z.string().uuid(),
  file: z.string().min(1).describe('Binary file payload; supplied as multipart form-data'),
})

const replaceBodySchema = uploadBodySchema.extend({
  attachmentId: z.string().uuid(),
})

const deleteQuerySchema = z.object({
  attachmentId: z.string().uuid(),
})

type PortalContext = {
  auth: CustomerAuthContext
  customerId: string
  tenantId: string
  organizationId: string
  em: EntityManager
  container: Awaited<ReturnType<typeof createRequestContainer>>
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null
  if (value instanceof Date) return value.toISOString()
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toISOString()
}

async function resolvePortalContext(req: Request): Promise<PortalContext | Response> {
  const authOrResponse = await resolveLinkedCustomerAuth(req)
  if (authOrResponse instanceof Response) return authOrResponse
  const auth = authOrResponse
  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager
  return {
    auth,
    customerId: auth.customerEntityId,
    tenantId: auth.tenantId,
    organizationId: auth.orgId,
    em,
    container,
  }
}

function attachmentAuth(context: PortalContext): NonNullable<AuthContext> {
  return {
    sub: context.auth.sub,
    tenantId: context.tenantId,
    orgId: context.organizationId,
    email: context.auth.email,
  }
}

async function loadOwnedClaim(context: PortalContext, claimId: string): Promise<WarrantyClaim | null> {
  return loadPortalOwnedClaim(
    context.em,
    {
      tenantId: context.tenantId,
      organizationId: context.organizationId,
      customerId: context.customerId,
    },
    claimId,
  )
}

async function runPortalAttachmentGuard(
  req: Request,
  context: PortalContext,
  claimId: string,
  operation: 'create' | 'update' | 'delete',
  mutationPayload: Record<string, unknown>,
): Promise<RouteMutationGuardResult> {
  return runRouteMutationGuards({
    container: context.container,
    req,
    auth: {
      userId: context.auth.sub,
      tenantId: context.tenantId,
      organizationId: context.organizationId,
      userFeatures: [],
    },
    input: {
      resourceKind: WARRANTY_CLAIM_RESOURCE_KIND,
      resourceId: claimId,
      operation,
      mutationPayload,
    },
  })
}

function serializeAttachment(attachment: Attachment) {
  const metadata = readAttachmentMetadata(attachment.storageMetadata)
  return {
    id: attachment.id,
    url: attachment.url,
    downloadUrl: `/api/warranty_claims/portal/attachments?attachmentId=${encodeURIComponent(attachment.id)}`,
    fileName: attachment.fileName,
    fileSize: attachment.fileSize,
    mimeType: attachment.mimeType ?? null,
    partitionCode: attachment.partitionCode,
    content: attachment.content ?? null,
    thumbnailUrl: buildAttachmentImageUrl(attachment.id, {
      width: 320,
      height: 320,
      slug: slugifyAttachmentFileName(attachment.fileName),
    }),
    tags: metadata.tags ?? [],
    assignments: metadata.assignments ?? [],
    createdAt: toIso(attachment.createdAt),
  }
}

async function resolveStorageDriverFactory(context: PortalContext): Promise<StorageDriverFactory> {
  try {
    const resolved = context.container.resolve('storageDriverFactory') as StorageDriverFactory | null
    return resolved ?? new StorageDriverFactory(context.em)
  } catch {
    return new StorageDriverFactory(context.em)
  }
}

async function loadOwnedVisibleAttachment(
  context: PortalContext,
  attachmentId: string,
): Promise<{ attachment: Attachment; claim: WarrantyClaim } | null> {
  const scope = { tenantId: context.tenantId, organizationId: context.organizationId }
  const attachment = await findOneWithDecryption(
    context.em,
    Attachment,
    {
      id: attachmentId,
      entityId: CLAIM_ATTACHMENT_ENTITY_ID,
      tenantId: context.tenantId,
      organizationId: context.organizationId,
    },
    {},
    scope,
  )
  if (!attachment) return null
  const claim = await loadOwnedClaim(context, attachment.recordId)
  if (!claim) return null
  if (!isCustomerVisibleAttachment(readAttachmentMetadata(attachment.storageMetadata).tags)) return null
  return { attachment, claim }
}

async function deletePortalAttachment(context: PortalContext, attachment: Attachment): Promise<void> {
  await context.em.remove(attachment).flush()
  await clearAttachmentThumbnailCache(attachment.partitionCode, attachment.id).catch((error) => {
    logger.error('Failed to clean portal attachment thumbnails', { err: error, attachmentId: attachment.id })
  })
  if (attachment.storagePath) {
    try {
      const driver = await (await resolveStorageDriverFactory(context)).resolveForPartition(attachment.partitionCode, {
        tenantId: attachment.tenantId ?? context.tenantId,
        organizationId: attachment.organizationId ?? context.organizationId,
      })
      await driver.delete(attachment.partitionCode, attachment.storagePath)
    } catch (error) {
      logger.error('Failed to remove portal attachment storage', { err: error, attachmentId: attachment.id })
    }
  }

  let dataEngine: DataEngine | null = null
  try {
    dataEngine = context.container.resolve<DataEngine>('dataEngine') ?? null
  } catch {
    dataEngine = null
  }
  if (dataEngine) {
    await emitCrudSideEffects({
      dataEngine,
      action: 'deleted',
      entity: attachment,
      identifiers: {
        id: attachment.id,
        organizationId: attachment.organizationId ?? null,
        tenantId: attachment.tenantId ?? null,
      },
      events: attachmentCrudEvents,
      indexer: attachmentCrudIndexer,
    })
    await dataEngine.flushOrmEntityChanges()
  }
}

async function streamOwnedAttachment(
  context: PortalContext,
  attachmentId: string,
  translate: (key: string, fallback?: string) => string,
): Promise<Response> {
  const owned = await loadOwnedVisibleAttachment(context, attachmentId)
  if (!owned) {
    return NextResponse.json({ ok: false, error: translate('warranty_claims.errors.notFound', 'Claim not found.') }, { status: 404 })
  }
  const { attachment } = owned
  const partition = await context.em.findOne(AttachmentPartition, { code: attachment.partitionCode })
  if (!partition) {
    return NextResponse.json({ ok: false, error: translate('warranty_claims.errors.load_failed', 'Failed to load warranty claim data.') }, { status: 500 })
  }
  const access = checkAttachmentAccess(attachmentAuth(context), attachment, partition, { requireAuthForPublic: true })
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: translate('warranty_claims.errors.notFound', 'Claim not found.') }, { status: 404 })
  }
  const driver = await (await resolveStorageDriverFactory(context)).resolveForPartition(attachment.partitionCode, {
    tenantId: attachment.tenantId ?? '',
    organizationId: attachment.organizationId ?? '',
  })
  let buffer: Buffer
  try {
    buffer = (await driver.read(attachment.partitionCode, attachment.storagePath)).buffer
  } catch {
    return NextResponse.json({ ok: false, error: translate('warranty_claims.errors.notFound', 'Claim not found.') }, { status: 404 })
  }
  const headers: Record<string, string> = {
    'Cache-Control': 'private, max-age=60',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Content-Type': 'application/octet-stream',
    'Content-Disposition': `attachment; filename="${slugifyAttachmentFileName(attachment.fileName)}"`,
    'X-Content-Type-Options': 'nosniff',
  }
  if (attachment.fileSize > 0) headers['Content-Length'] = String(attachment.fileSize)
  return new NextResponse(new Uint8Array(buffer), { status: 200, headers })
}

export async function GET(req: Request) {
  const contextOrResponse = await resolvePortalContext(req)
  if (contextOrResponse instanceof Response) return contextOrResponse
  const context = contextOrResponse
  const { translate } = await resolveTranslations()
  const url = new URL(req.url)
  const attachmentId = url.searchParams.get('attachmentId')
  if (attachmentId) {
    const attachmentIdParsed = z.string().uuid().safeParse(attachmentId)
    if (!attachmentIdParsed.success) {
      return NextResponse.json({ ok: false, error: translate('warranty_claims.errors.invalidInput', 'Invalid input') }, { status: 400 })
    }
    return streamOwnedAttachment(context, attachmentIdParsed.data, translate)
  }
  const parsed = attachmentQuerySchema.safeParse({
    claimId: url.searchParams.get('claimId') ?? undefined,
    page: url.searchParams.get('page') ?? undefined,
    pageSize: url.searchParams.get('pageSize') ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: translate('warranty_claims.errors.invalidInput', 'Invalid input') }, { status: 400 })
  }
  const claim = await loadOwnedClaim(context, parsed.data.claimId)
  if (!claim) {
    return NextResponse.json({ ok: false, error: translate('warranty_claims.errors.notFound', 'Claim not found.') }, { status: 404 })
  }
  const filter = {
    entityId: CLAIM_ATTACHMENT_ENTITY_ID,
    recordId: claim.id,
    tenantId: context.tenantId,
    organizationId: context.organizationId,
  }
  const page = parsed.data.page ?? 1
  const pageSize = parsed.data.pageSize ?? 100
  const attachments = await findWithDecryption(
    context.em,
    Attachment,
    filter,
    { orderBy: { createdAt: 'DESC' } },
    { tenantId: context.tenantId, organizationId: context.organizationId },
  )
  const partitionCodes = Array.from(new Set(attachments.map((attachment) => attachment.partitionCode)))
  const partitions = partitionCodes.length
    ? await context.em.find(AttachmentPartition, { code: { $in: partitionCodes } })
    : []
  const partitionsByCode = new Map(partitions.map((partition) => [partition.code, partition]))
  const auth = attachmentAuth(context)
  const visible = attachments.filter((attachment) => {
    const partition = partitionsByCode.get(attachment.partitionCode)
    if (!partition) return false
    if (!isCustomerVisibleAttachment(readAttachmentMetadata(attachment.storageMetadata).tags)) return false
    return checkAttachmentAccess(auth, attachment, partition, { requireAuthForPublic: true }).ok
  })

  const pagedVisible = visible.slice((page - 1) * pageSize, page * pageSize)

  return NextResponse.json({
    items: pagedVisible.map(serializeAttachment),
    total: visible.length,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(visible.length / pageSize)),
  })
}

async function handleUpload(req: Request, replacement: boolean): Promise<Response> {
  const contextOrResponse = await resolvePortalContext(req)
  if (contextOrResponse instanceof Response) return contextOrResponse
  const context = contextOrResponse
  const { t, translate } = await resolveTranslations()
  const contentType = req.headers.get('content-type') || ''
  if (!contentType.toLowerCase().includes('multipart/form-data')) {
    return NextResponse.json({ ok: false, error: translate('warranty_claims.errors.invalidInput', 'Invalid input') }, { status: 400 })
  }
  if (!isMultipartRequestWithinUploadLimit(req.headers.get('content-length'))) {
    return NextResponse.json({
      ok: false,
      error: t('attachments.errors.maxUploadSize', 'Attachment exceeds the maximum upload size.'),
    }, { status: 413 })
  }

  const form = await req.formData()
  const parsed = uploadBodySchema.safeParse({
    claimId: form.get('claimId') ?? undefined,
    file: form.get('file') instanceof File ? (form.get('file') as File).name : '',
  })
  const parsedAttachmentId = replacement
    ? z.string().uuid().safeParse(form.get('attachmentId') ?? undefined)
    : null
  if (!parsed.success || (replacement && !parsedAttachmentId?.success)) {
    return NextResponse.json({ ok: false, error: translate('warranty_claims.errors.invalidInput', 'Invalid input') }, { status: 400 })
  }
  const claim = await loadOwnedClaim(context, parsed.data.claimId)
  if (!claim) {
    return NextResponse.json({ ok: false, error: translate('warranty_claims.errors.notFound', 'Claim not found.') }, { status: 404 })
  }
  const file = form.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: translate('warranty_claims.portal.detail.fileRequired', 'Choose a file before uploading.') }, { status: 400 })
  }
  const buffer = Buffer.from(await file.arrayBuffer())

  const attachmentId = replacement && parsedAttachmentId?.success ? parsedAttachmentId.data : null
  const replacementTarget = attachmentId
    ? await loadOwnedVisibleAttachment(context, attachmentId)
    : null
  if (replacement && (!replacementTarget || replacementTarget.claim.id !== claim.id)) {
    return NextResponse.json({ ok: false, error: translate('warranty_claims.errors.notFound', 'Claim not found.') }, { status: 404 })
  }

  const guarded = await runPortalAttachmentGuard(req, context, claim.id, replacement ? 'update' : 'create', {
    claimId: claim.id,
    attachmentId,
    fileName: file.name,
    fileSize: file.size,
    mimeType: file.type,
  })
  if (!guarded.ok) {
    return guarded.response
  }

  const uploadService = resolvePortalAttachmentUploadService(context.container)
  if (!uploadService) {
    return NextResponse.json({ ok: false, error: translate('warranty_claims.portal.detail.attachmentError', 'Attachment upload failed.') }, { status: 503 })
  }

  let attachment: Attachment
  try {
    attachment = await uploadService.upload({
      tenantId: context.tenantId,
      organizationId: context.organizationId,
      entityId: CLAIM_ATTACHMENT_ENTITY_ID,
      recordId: claim.id,
      fileName: file.name,
      buffer,
      declaredMimeType: file.type,
      tags: [CUSTOMER_VISIBLE_ATTACHMENT_TAG],
    })
  } catch (error) {
    if (isScopedAttachmentUploadError(error)) {
      const [key, fallback] = ATTACHMENT_ERROR_TRANSLATIONS[error.code]
        ?? ['warranty_claims.portal.detail.attachmentError', 'Attachment upload failed.']
      return NextResponse.json(
        { ok: false, error: t(key, fallback), code: error.code },
        { status: error.status },
      )
    }
    throw error
  }

  if (replacementTarget) {
    await deletePortalAttachment(context, replacementTarget.attachment)
  }
  await guarded.runAfterSuccess()

  return NextResponse.json({
    ok: true,
    item: {
      ...serializeAttachment(attachment),
      entityType: 'attachments:attachment',
    },
  })
}

export async function POST(req: Request) {
  return handleUpload(req, false)
}

export async function PUT(req: Request) {
  return handleUpload(req, true)
}

export async function DELETE(req: Request) {
  const contextOrResponse = await resolvePortalContext(req)
  if (contextOrResponse instanceof Response) return contextOrResponse
  const context = contextOrResponse
  const { translate } = await resolveTranslations()
  const url = new URL(req.url)
  const parsed = deleteQuerySchema.safeParse({
    attachmentId: url.searchParams.get('attachmentId') ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: translate('warranty_claims.errors.invalidInput', 'Invalid input') }, { status: 400 })
  }
  const owned = await loadOwnedVisibleAttachment(context, parsed.data.attachmentId)
  if (!owned) {
    return NextResponse.json({ ok: false, error: translate('warranty_claims.errors.notFound', 'Claim not found.') }, { status: 404 })
  }
  const guarded = await runPortalAttachmentGuard(req, context, owned.claim.id, 'delete', {
    claimId: owned.claim.id,
    attachmentId: owned.attachment.id,
  })
  if (!guarded.ok) return guarded.response

  await deletePortalAttachment(context, owned.attachment)
  await guarded.runAfterSuccess()
  return NextResponse.json({ ok: true })
}

const assignmentSchema = z.object({
  type: z.string(),
  id: z.string(),
  href: z.string().nullable().optional(),
  label: z.string().nullable().optional(),
})

const attachmentItemSchema = z.object({
  id: z.string(),
  url: z.string(),
  downloadUrl: z.string(),
  fileName: z.string(),
  fileSize: z.number().int().nonnegative(),
  mimeType: z.string().nullable(),
  partitionCode: z.string(),
  content: z.string().nullable(),
  thumbnailUrl: z.string(),
  tags: z.array(z.string()),
  assignments: z.array(assignmentSchema),
  createdAt: z.string().nullable(),
})

export const openApi: OpenApiRouteDoc = {
  tag: 'Warranty Claims Portal',
  summary: 'Customer portal warranty claim attachments',
  methods: {
    GET: {
      summary: 'List attachments for an owned claim',
      query: attachmentQuerySchema,
      responses: [
        {
          status: 200,
          description: 'Claim attachments',
          schema: z.object({ items: z.array(attachmentItemSchema) }),
        },
      ],
    },
    POST: {
      summary: 'Upload an attachment for an owned claim',
      requestBody: { contentType: 'multipart/form-data', schema: uploadBodySchema },
      responses: [
        {
          status: 200,
          description: 'Attachment uploaded',
          schema: z.object({ ok: z.boolean(), item: attachmentItemSchema.extend({ entityType: z.string() }) }),
        },
      ],
    },
    PUT: {
      summary: 'Replace an attachment on an owned claim',
      requestBody: { contentType: 'multipart/form-data', schema: replaceBodySchema },
      responses: [
        {
          status: 200,
          description: 'Attachment replaced',
          schema: z.object({ ok: z.boolean(), item: attachmentItemSchema.extend({ entityType: z.string() }) }),
        },
      ],
    },
    DELETE: {
      summary: 'Delete an attachment from an owned claim',
      query: deleteQuerySchema,
      responses: [
        {
          status: 200,
          description: 'Attachment deleted',
          schema: z.object({ ok: z.literal(true) }),
        },
      ],
    },
  },
}
