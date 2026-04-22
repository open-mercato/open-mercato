import { NextResponse } from 'next/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { z } from 'zod'
import { sql } from 'kysely'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { buildAttachmentFileUrl, buildAttachmentImageUrl, slugifyAttachmentFileName } from '../lib/imageUrls'
import { ensureDefaultPartitions, resolveDefaultPartitionCode, sanitizePartitionCode } from '../lib/partitions'
import { Attachment, AttachmentPartition } from '../data/entities'
import { storePartitionFile, deletePartitionFile } from '../lib/storage'
import { extractAttachmentContent } from '../lib/textExtraction'
import { requestOcrProcessing } from '../lib/ocrQueue'
import { OcrService, shouldUseLlmOcr } from '../lib/ocrService'
import { clearAttachmentThumbnailCache } from '../lib/thumbnailCache'
import {
  mergeAttachmentMetadata,
  normalizeAttachmentAssignments,
  normalizeAttachmentTags,
  readAttachmentMetadata,
  upsertAssignment,
  type AttachmentAssignment,
} from '../lib/metadata'
import { randomUUID } from 'crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { splitCustomFieldPayload } from '@open-mercato/shared/lib/crud/custom-fields'
import { emitCrudSideEffects, setCustomFieldsIfAny } from '@open-mercato/shared/lib/commands/helpers'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { attachmentCrudEvents, attachmentCrudIndexer } from '../lib/crud'
import { E } from '#generated/entities.ids.generated'
import { resolveDefaultAttachmentOcrEnabled } from '../lib/ocrConfig'
import {
  detectAttachmentMimeType,
  hasDangerousExecutableExtension,
  isActiveContentAttachment,
  sanitizeUploadedFileName,
} from '../lib/security'
import {
  isMultipartRequestWithinUploadLimit,
  resolveAttachmentMaxBytes,
  willExceedAttachmentTenantQuota,
} from '../lib/upload-limits'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['attachments.view'] },
  POST: { requireAuth: true, requireFeatures: ['attachments.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['attachments.manage'] },
}

const attachmentQuerySchema = z.object({
  entityId: z.string().min(1).describe('Entity identifier that owns the attachments'),
  recordId: z.string().min(1).describe('Record identifier within the entity'),
  page: z.coerce.number().min(1).optional(),
  pageSize: z.coerce.number().min(1).max(100).optional(),
})

const attachmentAssignmentSchema = z.object({
  type: z.string().describe('Assignment type identifier'),
  id: z.string().describe('Assignment record identifier'),
  href: z.string().nullable().optional().describe('Optional link to the related record'),
  label: z.string().nullable().optional().describe('Optional label for the assignment'),
})

const attachmentItemSchema = z.object({
  id: z.string().describe('Attachment identifier'),
  url: z.string().describe('Public path to the stored asset'),
  fileName: z.string().describe('Original filename'),
  fileSize: z.number().int().nonnegative().describe('File size in bytes'),
  createdAt: z.string().describe('Upload timestamp (ISO 8601)'),
  mimeType: z.string().nullable().optional().describe('MIME type of the file'),
  thumbnailUrl: z.string().optional().describe('Helper route that renders a thumbnail'),
  partitionCode: z.string().optional().describe('Partition identifier'),
  tags: z.array(z.string()).optional().describe('Tags assigned to the attachment'),
  content: z.string().nullable().optional().describe('Extracted text or markdown content'),
  assignments: z.array(attachmentAssignmentSchema).optional().describe('Records that reference this attachment'),
})

const attachmentListResponseSchema = z.object({
  items: z.array(attachmentItemSchema),
  total: z.number().int().nonnegative().optional(),
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).optional(),
  totalPages: z.number().int().min(1).optional(),
})

const attachmentUploadBodySchema = z.object({
  entityId: z.string().min(1),
  recordId: z.string().min(1),
  fieldKey: z.string().optional(),
  file: z.string().min(1).describe('Binary file payload; supplied as multipart form-data'),
  customFields: z
    .string()
    .optional()
    .describe('JSON encoded map of custom field values collected from the upload form.'),
})

const attachmentDeleteQuerySchema = z.object({
  id: z.string().uuid(),
})

const uploadResponseSchema = z.object({
  ok: z.literal(true),
  item: z.object({
    id: z.string(),
    url: z.string(),
    fileName: z.string(),
    fileSize: z.number().int().nonnegative(),
    thumbnailUrl: z.string().optional(),
    content: z.string().nullable().optional(),
    tags: z.array(z.string()).optional(),
    assignments: z.array(attachmentAssignmentSchema).optional(),
    customFields: z.record(z.string(), z.unknown()).optional(),
  }),
})

const errorSchema = z.object({
  error: z.string(),
})

const LIBRARY_ENTITY_ID = 'attachments:library'

function parseCustomFieldsEntry(value: FormDataEntryValue | null): Record<string, unknown> {
  if (!value) return {}
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return {}
    try {
      const parsed = JSON.parse(trimmed)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      return {}
    }
  }
  if (typeof value === 'object' && !Array.isArray(value) && !(value instanceof File)) {
    return { ...(value as Record<string, unknown>) }
  }
  return {}
}

function buildFormPayload(form: FormData): Record<string, unknown> {
  const payload: Record<string, unknown> = {}
  form.forEach((value, key) => {
    if (key === 'customFields') {
      payload.customFields = parseCustomFieldsEntry(value)
      return
    }
    payload[key] = value
  })
  return payload
}

function parseFormTags(value: FormDataEntryValue | null): string[] {
  if (!value) return []
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return []
    try {
      const parsed = JSON.parse(trimmed)
      return normalizeAttachmentTags(parsed)
    } catch {
      return normalizeAttachmentTags(value)
    }
  }
  return []
}

function parseFormAssignments(value: FormDataEntryValue | null): AttachmentAssignment[] {
  if (!value) return []
  if (typeof value !== 'string') return []
  const trimmed = value.trim()
  if (!trimmed) return []
  try {
    const parsed = JSON.parse(trimmed)
    return normalizeAttachmentAssignments(parsed)
  } catch {
    return []
  }
}

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth || !auth.tenantId || (!auth.orgId && !auth.isSuperAdmin)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const url = new URL(req.url)
  const parsedQuery = attachmentQuerySchema.safeParse({
    entityId: url.searchParams.get('entityId') || '',
    recordId: url.searchParams.get('recordId') || '',
    page: url.searchParams.get('page') ?? undefined,
    pageSize: url.searchParams.get('pageSize') ?? undefined,
  })
  if (!parsedQuery.success) {
    return NextResponse.json({ error: 'entityId and recordId are required' }, { status: 400 })
  }
  const { entityId, recordId, page, pageSize } = parsedQuery.data

  const { resolve } = await createRequestContainer()
  const em = resolve('em') as EntityManager
  const filter: Record<string, unknown> = { entityId, recordId, tenantId: auth.tenantId! }
  if (auth.orgId) filter.organizationId = auth.orgId
  const orderBy: Record<string, 'ASC' | 'DESC'> = { createdAt: 'DESC' }
  const usePaging = typeof page === 'number' && typeof pageSize === 'number'
  const total = usePaging ? await em.count(Attachment, filter) : null
  const currentPage = usePaging ? Math.max(1, page) : null
  const currentPageSize = usePaging ? pageSize : null
  const totalPages = usePaging && total !== null ? Math.max(1, Math.ceil(total / currentPageSize!)) : null
  const pageOffset = usePaging ? (Math.min(currentPage!, totalPages!) - 1) * currentPageSize! : undefined
  const items = await findWithDecryption(
    em,
    Attachment,
    filter,
    {
      orderBy,
      ...(usePaging
        ? {
            limit: currentPageSize!,
            offset: pageOffset,
          }
        : {}),
    },
    {
      tenantId: auth.tenantId ?? null,
      organizationId: auth.orgId ?? null,
    },
  )
  return NextResponse.json({
    items: items.map((a: any) => {
      const metadata = readAttachmentMetadata(a.storageMetadata)
      return {
        id: a.id,
        url: a.url,
        fileName: a.fileName,
        fileSize: a.fileSize,
        createdAt: a.createdAt,
        mimeType: a.mimeType ?? null,
        partitionCode: a.partitionCode,
        content: a.content ?? null,
        thumbnailUrl: buildAttachmentImageUrl(a.id, {
          width: 320,
          height: 320,
          slug: slugifyAttachmentFileName(a.fileName),
        }),
        tags: metadata.tags ?? [],
        assignments: metadata.assignments ?? [],
      }
    }),
    ...(usePaging
      ? {
          total,
          page: Math.min(currentPage!, totalPages!),
          pageSize: currentPageSize,
          totalPages,
        }
      : {}),
  })
}

export async function POST(req: Request) {
  const { t } = await resolveTranslations()
  const auth = await getAuthFromRequest(req)
  if (!auth || !auth.tenantId || !auth.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const tenantId = auth.tenantId
  const orgId = auth.orgId

  const contentType = req.headers.get('content-type') || ''
  if (!contentType.toLowerCase().includes('multipart/form-data')) {
    return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 })
  }
  if (!isMultipartRequestWithinUploadLimit(req.headers.get('content-length'))) {
    return NextResponse.json({ error: 'Attachment exceeds the maximum upload size.' }, { status: 413 })
  }

  const form = await req.formData()
  const formPayload = buildFormPayload(form)
  const customFieldValues = splitCustomFieldPayload(formPayload).custom
  const entityId = String(form.get('entityId') || '')
  const recordId = String(form.get('recordId') || '')
  const fieldKey = String(form.get('fieldKey') || '')
  const file = form.get('file') as unknown as File | null
  if (!entityId || !recordId || !file) return NextResponse.json({ error: 'entityId, recordId and file are required' }, { status: 400 })
  const partitionOverrideRaw = form.get('partitionCode')
  const partitionOverride =
    typeof partitionOverrideRaw === 'string' && partitionOverrideRaw.trim().length > 0
      ? sanitizePartitionCode(partitionOverrideRaw)
      : null
  const tags = parseFormTags(form.get('tags'))
  const assignmentsFromForm = parseFormAssignments(form.get('assignments'))

  const { resolve } = await createRequestContainer()
  const em = resolve('em') as EntityManager
  const dataEngine = resolve('dataEngine')
  await ensureDefaultPartitions(em)
  // Optional per-field validations
  let partitionFromField: string | null = null
  let fieldMaxAttachmentSizeMb: number | null = null
  if (fieldKey) {
    try {
      const { CustomFieldDef } = await import('@open-mercato/core/modules/entities/data/entities')
      const def = await em.findOne(CustomFieldDef, {
        entityId,
        key: fieldKey,
        $and: [
          { $or: [ { tenantId: auth.tenantId }, { tenantId: null } ] },
        ],
        isActive: true,
      })
      const cfg = (def as any)?.configJson || {}
      const ext = (file.name || '').split('.').pop()?.toLowerCase() || ''
      if (Array.isArray(cfg.acceptExtensions) && cfg.acceptExtensions.length) {
        const allowed = new Set((cfg.acceptExtensions as any[]).map((x: any) => String(x).toLowerCase().replace(/^\./, '')))
        if (!allowed.has(ext)) return NextResponse.json({ error: 'File type not allowed' }, { status: 400 })
      }
      if (typeof cfg.maxAttachmentSizeMb === 'number' && cfg.maxAttachmentSizeMb > 0) {
        fieldMaxAttachmentSizeMb = cfg.maxAttachmentSizeMb
      }
      if (typeof cfg.partitionCode === 'string' && cfg.partitionCode.trim().length > 0) {
        partitionFromField = sanitizePartitionCode(cfg.partitionCode)
      }
    } catch {}
  }
  if (hasDangerousExecutableExtension(file.name)) {
    return NextResponse.json({
      error: t('attachments.errors.dangerousExecutable', 'Executable file types are not allowed as attachments.'),
    }, { status: 400 })
  }
  const effectiveMaxBytes = resolveAttachmentMaxBytes(fieldMaxAttachmentSizeMb)
  if (file.size > effectiveMaxBytes) {
    return NextResponse.json({
      error: t('attachments.errors.maxUploadSize', 'Attachment exceeds the maximum upload size.'),
    }, { status: 413 })
  }
  const tenantUsageBytes = await readTenantAttachmentUsageBytes(em, tenantId)
  if (willExceedAttachmentTenantQuota(tenantUsageBytes, file.size)) {
    return NextResponse.json({
      error: t('attachments.errors.quotaExceeded', 'Attachment storage quota exceeded for this tenant.'),
    }, { status: 413 })
  }
  const buf = Buffer.from(await file.arrayBuffer())
  const safeName = sanitizeUploadedFileName(file.name)
  const fileMimeType = detectAttachmentMimeType(buf, safeName, (file as any).type)
  if (isActiveContentAttachment(buf, safeName, fileMimeType)) {
    return NextResponse.json({ error: t('attachments.errors.activeContentBlocked', 'Active content uploads are not allowed.') }, { status: 400 })
  }
  const defaultPartitionCode = resolveDefaultPartitionCode(entityId)
  const resolvedPartitionCode = partitionOverride ?? partitionFromField ?? defaultPartitionCode
  const partitionCodeCandidates = Array.from(
    new Set(
      [partitionOverride, partitionFromField, resolvedPartitionCode].filter(
        (code): code is string => typeof code === 'string' && code.length > 0,
      ),
    ),
  )
  let partition: AttachmentPartition | null = null
  for (const code of partitionCodeCandidates) {
    const record = await em.findOne(AttachmentPartition, { code })
    if (record) {
      partition = record
      break
    }
  }
  if (!partition) {
    partition = await em.findOne(AttachmentPartition, { code: defaultPartitionCode })
  }
  if (!partition) {
    return NextResponse.json({ error: 'Storage partition is not configured.' }, { status: 400 })
  }
  const requestedPublicOverride =
    typeof partitionOverride === 'string' &&
    partitionOverride.length > 0 &&
    partition.code === partitionOverride &&
    partition.isPublic === true &&
    partition.code !== defaultPartitionCode &&
    partition.code !== partitionFromField
  if (requestedPublicOverride) {
    return NextResponse.json({ error: t('attachments.errors.publicPartitionBlocked', 'Public storage partitions cannot be selected explicitly for this upload.') }, { status: 403 })
  }
  let stored
  try {
    stored = await storePartitionFile({
      partitionCode: partition.code,
      orgId,
      tenantId,
      fileName: safeName,
      buffer: buf,
    })
  } catch (error) {
    console.error('[attachments] failed to persist file', error)
    return NextResponse.json({ error: 'Failed to persist attachment.' }, { status: 500 })
  }

  const requiresOcr =
    typeof (partition as any).requiresOcr === 'boolean'
      ? Boolean((partition as any).requiresOcr)
      : resolveDefaultAttachmentOcrEnabled()
  let extractedContent: string | null = null
  const wantsLlmOcr = requiresOcr && shouldUseLlmOcr(fileMimeType, safeName)
  const ocrService = wantsLlmOcr ? new OcrService() : null
  const useLlmOcr = Boolean(wantsLlmOcr && ocrService?.available)

  if (requiresOcr && !useLlmOcr) {
    try {
      extractedContent = await extractAttachmentContent({
        filePath: stored.absolutePath,
        mimeType: fileMimeType,
      })
    } catch (error) {
      console.error('[attachments] failed to extract attachment content', error)
    }
  }

  let assignments = assignmentsFromForm.slice()
  if (entityId !== LIBRARY_ENTITY_ID) {
    assignments = upsertAssignment(assignments, { type: entityId, id: recordId })
  }
  const metadata = mergeAttachmentMetadata(null, { assignments, tags })
  const attachmentId = randomUUID()
  const att = em.create(Attachment, {
    id: attachmentId,
    entityId,
    recordId,
    organizationId: auth.orgId!,
    tenantId: auth.tenantId!,
    fileName: safeName,
    mimeType: fileMimeType,
    fileSize: buf.length,
    partitionCode: partition.code,
    storageDriver: partition.storageDriver || 'local',
    storagePath: stored.storagePath,
    url: buildAttachmentFileUrl(attachmentId),
    content: extractedContent,
    storageMetadata: metadata,
  })
  await em.persist(att).flush()

  if (useLlmOcr) {
    requestOcrProcessing(em, att, stored.absolutePath).catch((error) => {
      console.error('[attachments] failed to queue OCR processing', error)
    })
  } else if (wantsLlmOcr) {
    console.warn('[attachments] OCR requested but OPENAI_API_KEY not configured, falling back to text extraction when available')
  }

  if (dataEngine) {
    try {
      await setCustomFieldsIfAny({
        dataEngine,
        entityId: E.attachments.attachment,
        recordId: attachmentId,
        tenantId,
        organizationId: orgId,
        values: customFieldValues,
      })
    } catch (error) {
      console.error('[attachments] failed to persist custom attributes', error)
      return NextResponse.json({ error: 'Failed to save attachment attributes.' }, { status: 500 })
    }
    await emitCrudSideEffects({
      dataEngine,
      action: 'created',
      entity: att,
      identifiers: {
        id: att.id,
        organizationId: att.organizationId ?? null,
        tenantId: att.tenantId ?? null,
      },
      events: attachmentCrudEvents,
      indexer: attachmentCrudIndexer,
    })
    await dataEngine.flushOrmEntityChanges()
  }

  return NextResponse.json({
    ok: true,
    item: {
      id: attachmentId,
      url: att.url,
      fileName: safeName,
      fileSize: buf.length,
      partitionCode: partition.code,
      thumbnailUrl: buildAttachmentImageUrl(attachmentId, {
        width: 320,
        height: 320,
        slug: slugifyAttachmentFileName(safeName),
      }),
      content: extractedContent ?? null,
      tags: metadata.tags ?? [],
      assignments: metadata.assignments ?? [],
      customFields: Object.keys(customFieldValues).length ? customFieldValues : undefined,
    },
  })
}

async function readTenantAttachmentUsageBytes(em: EntityManager, tenantId: string): Promise<number> {
  try {
    const db = em.getKysely<any>() as any
    const row = await db
      .selectFrom('attachments')
      .select(sql<string>`sum(file_size)`.as('total_size'))
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst() as { total_size: string | number | null } | undefined
    const total = row?.total_size
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

export async function DELETE(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth || !auth.tenantId || !auth.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const url = new URL(req.url)
  const id = url.searchParams.get('id') || ''
  if (!id) return NextResponse.json({ error: 'Attachment id is required' }, { status: 400 })
  const { resolve } = await createRequestContainer()
  const em = resolve('em') as EntityManager
  const dataEngine = resolve('dataEngine')
  const deleteFilter: Record<string, unknown> = { id, tenantId: auth.tenantId!, organizationId: auth.orgId }
  const record = await em.findOne(Attachment, deleteFilter)
  if (!record) return NextResponse.json({ error: 'Attachment not found' }, { status: 404 })
  await em.remove(record).flush()
  await clearAttachmentThumbnailCache(record.partitionCode, record.id).catch((error) => {
    console.error('[attachments] failed to cleanup cached thumbnails', error)
  })
  if (record.storagePath) {
    await deletePartitionFile(record.partitionCode, record.storagePath, record.storageDriver)
  }
  if (dataEngine) {
    await emitCrudSideEffects({
      dataEngine,
      action: 'deleted',
      entity: record,
      identifiers: {
        id: record.id,
        organizationId: record.organizationId ?? null,
        tenantId: record.tenantId ?? null,
      },
      events: attachmentCrudEvents,
      indexer: attachmentCrudIndexer,
    })
    await dataEngine.flushOrmEntityChanges()
  }
  return NextResponse.json({ ok: true })
}

export const openApi: OpenApiRouteDoc = {
  summary: 'Manage entity attachments',
  description: 'Upload and list attachments associated with module entities and records.',
  methods: {
    GET: {
      summary: 'List attachments for a record',
      description: 'Returns uploaded attachments for the given entity record, ordered by newest first.',
      query: attachmentQuerySchema,
      responses: [
        { status: 200, description: 'Attachments found for the record', schema: attachmentListResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Missing entity or record identifiers', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
      ],
    },
    POST: {
      summary: 'Upload attachment',
      description: 'Uploads a new attachment using multipart form-data and stores metadata for later retrieval.',
      requestBody: {
        contentType: 'multipart/form-data',
        schema: attachmentUploadBodySchema,
      },
      responses: [
        { status: 200, description: 'Attachment stored successfully', schema: uploadResponseSchema },
      ],
      errors: [
        { status: 400, description: 'Payload validation error', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 403, description: 'Attachment violates field constraints', schema: errorSchema },
      ],
    },
    DELETE: {
      summary: 'Delete attachment',
      description: 'Removes an uploaded attachment and deletes the stored asset.',
      query: attachmentDeleteQuerySchema,
      responses: [
        { status: 200, description: 'Attachment deleted', schema: z.object({ ok: z.literal(true) }) },
        { status: 404, description: 'Attachment not found', schema: errorSchema },
      ],
      errors: [
        { status: 400, description: 'Missing attachment identifier', schema: errorSchema },
        { status: 401, description: 'Unauthorized', schema: errorSchema },
      ],
    },
  },
}
