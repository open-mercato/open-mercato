import { randomUUID } from 'crypto'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { AuthContext } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { emitCrudSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { runRouteMutationGuards, type RouteMutationGuardResult } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { getCustomerAuthFromRequest, type CustomerAuthContext } from '@open-mercato/core/modules/customer_accounts/lib/customerAuth'
import { Attachment, AttachmentPartition } from '@open-mercato/core/modules/attachments/data/entities'
import { buildAttachmentFileUrl, buildAttachmentImageUrl, slugifyAttachmentFileName } from '@open-mercato/core/modules/attachments/lib/imageUrls'
import { ensureDefaultPartitions, resolveDefaultPartitionCode } from '@open-mercato/core/modules/attachments/lib/partitions'
import { extractAttachmentContent } from '@open-mercato/core/modules/attachments/lib/textExtraction'
import { requestOcrProcessing } from '@open-mercato/core/modules/attachments/lib/ocrQueue'
import { OcrService, shouldUseLlmOcr } from '@open-mercato/core/modules/attachments/lib/ocrService'
import { StorageDriverFactory } from '@open-mercato/core/modules/attachments/lib/drivers'
import { assertAttachmentScopeInvariant, checkAttachmentAccess } from '@open-mercato/core/modules/attachments/lib/access'
import { mergeAttachmentMetadata, readAttachmentMetadata, upsertAssignment } from '@open-mercato/core/modules/attachments/lib/metadata'
import {
  detectAttachmentMimeType,
  hasDangerousExecutableExtension,
  isActiveContentAttachment,
  sanitizeUploadedFileName,
} from '@open-mercato/core/modules/attachments/lib/security'
import {
  isMultipartRequestWithinUploadLimit,
  resolveAttachmentMaxBytes,
  willExceedAttachmentTenantQuota,
} from '@open-mercato/core/modules/attachments/lib/upload-limits'
import { attachmentCrudEvents, attachmentCrudIndexer } from '@open-mercato/core/modules/attachments/lib/crud'
import { E } from '#generated/entities.ids.generated'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { WarrantyClaim } from '../../../data/entities'
import { WARRANTY_CLAIM_RESOURCE_KIND } from '../../../commands/shared'
import { CUSTOMER_VISIBLE_ATTACHMENT_TAG, isCustomerVisibleAttachment } from '../../../lib/attachmentVisibility'

const CLAIM_ATTACHMENT_ENTITY_ID = 'warranty_claims:warranty_claim'

export const metadata = {
  GET: { requireAuth: false },
  POST: { requireAuth: false },
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
  const auth = await getCustomerAuthFromRequest(req)
  if (!auth) {
    return NextResponse.json({ ok: false, error: 'Authentication required' }, { status: 401 })
  }
  if (!auth.customerEntityId) {
    return NextResponse.json({ ok: false, error: 'Customer account is not linked to a customer record' }, { status: 403 })
  }
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
  return findOneWithDecryption(
    context.em,
    WarrantyClaim,
    {
      id: claimId,
      tenantId: context.tenantId,
      organizationId: context.organizationId,
      customerId: context.customerId,
      deletedAt: null,
    },
    {},
    { tenantId: context.tenantId, organizationId: context.organizationId },
  )
}

async function runPortalAttachmentGuard(
  req: Request,
  context: PortalContext,
  claimId: string,
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
      operation: 'create',
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

async function resolveDataEngine(context: PortalContext): Promise<DataEngine | null> {
  try {
    return context.container.resolve('dataEngine') as DataEngine
  } catch {
    return null
  }
}

async function readTenantAttachmentUsageBytes(em: EntityManager, tenantId: string): Promise<number> {
  try {
    const rows = await em.getConnection().execute<Array<{ total_size: string | number | null }>>(
      'select sum(file_size) as total_size from attachments where tenant_id = ?',
      [tenantId],
    )
    const total = rows[0]?.total_size
    if (typeof total === 'number') return Number.isFinite(total) ? total : 0
    if (typeof total === 'string') {
      const parsed = Number(total)
      return Number.isFinite(parsed) ? parsed : 0
    }
    return 0
  } catch {
    return 0
  }
}

async function streamOwnedAttachment(context: PortalContext, attachmentId: string): Promise<Response> {
  const scope = { tenantId: context.tenantId, organizationId: context.organizationId }
  const attachment = await findOneWithDecryption(
    context.em,
    Attachment,
    { id: attachmentId, entityId: CLAIM_ATTACHMENT_ENTITY_ID, tenantId: context.tenantId, organizationId: context.organizationId },
    {},
    scope,
  )
  if (!attachment) {
    return NextResponse.json({ ok: false, error: 'Attachment not found' }, { status: 404 })
  }
  const claim = await loadOwnedClaim(context, attachment.recordId)
  if (!claim) {
    return NextResponse.json({ ok: false, error: 'Attachment not found' }, { status: 404 })
  }
  if (!isCustomerVisibleAttachment(readAttachmentMetadata(attachment.storageMetadata).tags)) {
    return NextResponse.json({ ok: false, error: 'Attachment not found' }, { status: 404 })
  }
  const partition = await context.em.findOne(AttachmentPartition, { code: attachment.partitionCode })
  if (!partition) {
    return NextResponse.json({ ok: false, error: 'Partition misconfigured' }, { status: 500 })
  }
  const access = checkAttachmentAccess(attachmentAuth(context), attachment, partition, { requireAuthForPublic: true })
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: 'Attachment not found' }, { status: 404 })
  }
  const driver = await (await resolveStorageDriverFactory(context)).resolveForPartition(attachment.partitionCode, {
    tenantId: attachment.tenantId ?? '',
    organizationId: attachment.organizationId ?? '',
  })
  let buffer: Buffer
  try {
    buffer = (await driver.read(attachment.partitionCode, attachment.storagePath)).buffer
  } catch {
    return NextResponse.json({ ok: false, error: 'File not available' }, { status: 404 })
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
  const url = new URL(req.url)
  const attachmentId = url.searchParams.get('attachmentId')
  if (attachmentId) {
    const attachmentIdParsed = z.string().uuid().safeParse(attachmentId)
    if (!attachmentIdParsed.success) {
      return NextResponse.json({ ok: false, error: 'Invalid input' }, { status: 400 })
    }
    return streamOwnedAttachment(context, attachmentIdParsed.data)
  }
  const parsed = attachmentQuerySchema.safeParse({
    claimId: url.searchParams.get('claimId') ?? undefined,
    page: url.searchParams.get('page') ?? undefined,
    pageSize: url.searchParams.get('pageSize') ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Invalid input' }, { status: 400 })
  }
  const claim = await loadOwnedClaim(context, parsed.data.claimId)
  if (!claim) {
    return NextResponse.json({ ok: false, error: 'Claim not found' }, { status: 404 })
  }
  const filter = {
    entityId: CLAIM_ATTACHMENT_ENTITY_ID,
    recordId: claim.id,
    tenantId: context.tenantId,
    organizationId: context.organizationId,
  }
  const usePaging = typeof parsed.data.page === 'number' && typeof parsed.data.pageSize === 'number'
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

  const pagedVisible = usePaging ? visible.slice((page - 1) * pageSize, page * pageSize) : visible

  return NextResponse.json({
    items: pagedVisible.map(serializeAttachment),
    ...(usePaging
      ? {
          total: visible.length,
          page,
          pageSize,
          totalPages: Math.max(1, Math.ceil(visible.length / pageSize)),
        }
      : {}),
  })
}

export async function POST(req: Request) {
  const contextOrResponse = await resolvePortalContext(req)
  if (contextOrResponse instanceof Response) return contextOrResponse
  const context = contextOrResponse
  const contentType = req.headers.get('content-type') || ''
  if (!contentType.toLowerCase().includes('multipart/form-data')) {
    return NextResponse.json({ ok: false, error: 'Expected multipart/form-data' }, { status: 400 })
  }
  if (!isMultipartRequestWithinUploadLimit(req.headers.get('content-length'))) {
    return NextResponse.json({ ok: false, error: 'Attachment exceeds the maximum upload size.' }, { status: 413 })
  }

  const form = await req.formData()
  const parsed = attachmentQuerySchema.safeParse({ claimId: form.get('claimId') ?? undefined })
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: 'Invalid input' }, { status: 400 })
  }
  const claim = await loadOwnedClaim(context, parsed.data.claimId)
  if (!claim) {
    return NextResponse.json({ ok: false, error: 'Claim not found' }, { status: 404 })
  }
  const file = form.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: 'File is required' }, { status: 400 })
  }
  if (hasDangerousExecutableExtension(file.name)) {
    return NextResponse.json({ ok: false, error: 'Executable file types are not allowed as attachments.' }, { status: 400 })
  }
  const maxBytes = resolveAttachmentMaxBytes()
  if (file.size > maxBytes) {
    return NextResponse.json({ ok: false, error: 'Attachment exceeds the maximum upload size.' }, { status: 413 })
  }
  const tenantUsageBytes = await readTenantAttachmentUsageBytes(context.em, context.tenantId)
  if (willExceedAttachmentTenantQuota(tenantUsageBytes, file.size)) {
    return NextResponse.json({ ok: false, error: 'Attachment storage quota exceeded for this tenant.' }, { status: 413 })
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const safeName = sanitizeUploadedFileName(file.name)
  const mimeType = detectAttachmentMimeType(buffer, safeName, file.type)
  if (isActiveContentAttachment(buffer, safeName, mimeType)) {
    return NextResponse.json({ ok: false, error: 'Active content uploads are not allowed.' }, { status: 400 })
  }

  const guarded = await runPortalAttachmentGuard(req, context, claim.id, {
    claimId: claim.id,
    fileName: safeName,
    fileSize: file.size,
    mimeType,
  })
  if (!guarded.ok) {
    return guarded.response
  }

  await ensureDefaultPartitions(context.em)
  const partitionCode = resolveDefaultPartitionCode(CLAIM_ATTACHMENT_ENTITY_ID)
  const partition = await context.em.findOne(AttachmentPartition, { code: partitionCode })
  if (!partition) {
    return NextResponse.json({ ok: false, error: 'Storage partition is not configured.' }, { status: 400 })
  }
  const storageDriverFactory = await resolveStorageDriverFactory(context)
  const uploadDriver = await storageDriverFactory.resolveForPartition(partition.code, {
    tenantId: context.tenantId,
    organizationId: context.organizationId,
  })
  let storedPath: string
  try {
    const stored = await uploadDriver.store({
      partitionCode: partition.code,
      orgId: context.organizationId,
      tenantId: context.tenantId,
      fileName: safeName,
      buffer,
    })
    storedPath = stored.storagePath
  } catch (error) {
    console.error('[warranty_claims.portal.attachments] failed to persist file', error)
    return NextResponse.json({ ok: false, error: 'Failed to persist attachment.' }, { status: 500 })
  }

  let extractedContent: string | null = null
  const wantsLlmOcr = partition.requiresOcr && shouldUseLlmOcr(mimeType, safeName)
  const ocrService = wantsLlmOcr ? new OcrService() : null
  const useLlmOcr = Boolean(wantsLlmOcr && ocrService?.available)
  if (partition.requiresOcr && !useLlmOcr) {
    const { filePath, cleanup } = await uploadDriver.toLocalPath(partition.code, storedPath)
    try {
      extractedContent = await extractAttachmentContent({ filePath, mimeType })
    } catch (error) {
      console.error('[warranty_claims.portal.attachments] failed to extract attachment content', error)
    } finally {
      await cleanup().catch(() => undefined)
    }
  }

  const metadata = mergeAttachmentMetadata(null, {
    assignments: upsertAssignment([], { type: CLAIM_ATTACHMENT_ENTITY_ID, id: claim.id }),
    tags: [CUSTOMER_VISIBLE_ATTACHMENT_TAG],
  })
  const attachmentId = randomUUID()
  assertAttachmentScopeInvariant({ tenantId: context.tenantId, organizationId: context.organizationId })
  const attachment = context.em.create(Attachment, {
    id: attachmentId,
    entityId: CLAIM_ATTACHMENT_ENTITY_ID,
    recordId: claim.id,
    organizationId: context.organizationId,
    tenantId: context.tenantId,
    fileName: safeName,
    mimeType,
    fileSize: buffer.length,
    partitionCode: partition.code,
    storageDriver: partition.storageDriver || 'local',
    storagePath: storedPath,
    url: buildAttachmentFileUrl(attachmentId),
    content: extractedContent,
    storageMetadata: metadata,
  })
  try {
    await context.em.transactional(async (tx) => {
      await tx.persist(attachment).flush()
    })
  } catch (error) {
    console.error('[warranty_claims.portal.attachments] failed to persist attachment', error)
    return NextResponse.json({ ok: false, error: 'Failed to save attachment.' }, { status: 500 })
  }

  if (useLlmOcr) {
    requestOcrProcessing(context.em, attachment, uploadDriver, storedPath).catch((error) => {
      console.error('[warranty_claims.portal.attachments] failed to queue OCR processing', error)
    })
  }

  const dataEngine = await resolveDataEngine(context)
  if (dataEngine) {
    await emitCrudSideEffects({
      dataEngine,
      action: 'created',
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

  await guarded.runAfterSuccess()

  return NextResponse.json({
    ok: true,
    item: {
      id: attachment.id,
      url: attachment.url,
      downloadUrl: `/api/warranty_claims/portal/attachments?attachmentId=${encodeURIComponent(attachment.id)}`,
      fileName: attachment.fileName,
      fileSize: attachment.fileSize,
      mimeType: attachment.mimeType,
      partitionCode: attachment.partitionCode,
      thumbnailUrl: buildAttachmentImageUrl(attachment.id, {
        width: 320,
        height: 320,
        slug: slugifyAttachmentFileName(attachment.fileName),
      }),
      content: extractedContent,
      tags: metadata.tags ?? [],
      assignments: metadata.assignments ?? [],
      createdAt: toIso(attachment.createdAt),
      entityType: E.attachments.attachment,
    },
  })
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
  },
}
