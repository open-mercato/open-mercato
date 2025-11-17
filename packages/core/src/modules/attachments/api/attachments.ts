import { NextResponse } from 'next/server'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { buildAttachmentFileUrl, buildAttachmentImageUrl, slugifyAttachmentFileName } from '../lib/imageUrls'
import { ensureDefaultPartitions, resolveDefaultPartitionCode, sanitizePartitionCode } from '../lib/partitions'
import { Attachment, AttachmentPartition } from '../data/entities'
import { storePartitionFile, deletePartitionFile } from '../lib/storage'
import { randomUUID } from 'crypto'
import type { EntityManager } from '@mikro-orm/postgresql'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['attachments.view'] },
  POST: { requireAuth: true, requireFeatures: ['attachments.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['attachments.manage'] },
}

const attachmentQuerySchema = z.object({
  entityId: z.string().min(1).describe('Entity identifier that owns the attachments'),
  recordId: z.string().min(1).describe('Record identifier within the entity'),
})

const attachmentItemSchema = z.object({
  id: z.string().describe('Attachment identifier'),
  url: z.string().describe('Public path to the stored asset'),
  fileName: z.string().describe('Original filename'),
  fileSize: z.number().int().nonnegative().describe('File size in bytes'),
  createdAt: z.string().describe('Upload timestamp (ISO 8601)'),
  thumbnailUrl: z.string().optional().describe('Helper route that renders a thumbnail'),
  partitionCode: z.string().optional().describe('Partition identifier'),
})

const attachmentListResponseSchema = z.object({
  items: z.array(attachmentItemSchema),
})

const attachmentUploadBodySchema = z.object({
  entityId: z.string().min(1),
  recordId: z.string().min(1),
  fieldKey: z.string().optional(),
  file: z.string().min(1).describe('Binary file payload; supplied as multipart form-data'),
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
  }),
})

const errorSchema = z.object({
  error: z.string(),
})

export async function GET(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth || !auth.orgId || !auth.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const url = new URL(req.url)
  const entityId = url.searchParams.get('entityId') || ''
  const recordId = url.searchParams.get('recordId') || ''
  if (!entityId || !recordId) return NextResponse.json({ error: 'entityId and recordId are required' }, { status: 400 })

  const { resolve } = await createRequestContainer()
  const em = resolve('em') as any
  const items = await em.find(
    Attachment,
    { entityId, recordId, organizationId: auth.orgId!, tenantId: auth.tenantId! },
    { orderBy: { createdAt: 'desc' } as any }
  )
  return NextResponse.json({
    items: items.map((a: any) => ({
      id: a.id,
      url: a.url,
      fileName: a.fileName,
      fileSize: a.fileSize,
      createdAt: a.createdAt,
      partitionCode: a.partitionCode,
      thumbnailUrl: buildAttachmentImageUrl(a.id, {
        width: 320,
        height: 320,
        slug: slugifyAttachmentFileName(a.fileName),
      }),
    })),
  })
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth || !auth.orgId || !auth.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const tenantId = auth.tenantId
  const orgId = auth.orgId

  const contentType = req.headers.get('content-type') || ''
  if (!contentType.toLowerCase().includes('multipart/form-data')) {
    return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 })
  }

  const form = await req.formData()
  const entityId = String(form.get('entityId') || '')
  const recordId = String(form.get('recordId') || '')
  const fieldKey = String(form.get('fieldKey') || '')
  const file = form.get('file') as unknown as File | null
  if (!entityId || !recordId || !file) return NextResponse.json({ error: 'entityId, recordId and file are required' }, { status: 400 })

  const { resolve } = await createRequestContainer()
  const em = resolve('em') as EntityManager
  await ensureDefaultPartitions(em)
  // Optional per-field validations
  let partitionFromField: string | null = null
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
        const maxBytes = Math.floor(cfg.maxAttachmentSizeMb * 1024 * 1024)
        const size = (await file.arrayBuffer()).byteLength
        if (size > maxBytes) return NextResponse.json({ error: `File exceeds ${cfg.maxAttachmentSizeMb} MB limit` }, { status: 400 })
      }
      if (typeof cfg.partitionCode === 'string' && cfg.partitionCode.trim().length > 0) {
        partitionFromField = sanitizePartitionCode(cfg.partitionCode)
      }
    } catch {}
  }
  const buf = Buffer.from(await file.arrayBuffer())
  const safeName = String(file.name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_')
  const resolvedPartitionCode = partitionFromField ?? resolveDefaultPartitionCode(entityId)
  const partition =
    (await em.findOne(AttachmentPartition, { code: partitionFromField ?? '' })) ??
    (await em.findOne(AttachmentPartition, { code: resolvedPartitionCode }))
  if (!partition) {
    return NextResponse.json({ error: 'Storage partition is not configured.' }, { status: 400 })
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

  const attachmentId = randomUUID()
  const att = em.create(Attachment, {
    id: attachmentId,
    entityId,
    recordId,
    organizationId: auth.orgId!,
    tenantId: auth.tenantId!,
    fileName: safeName,
    mimeType: (file as any).type || 'application/octet-stream',
    fileSize: buf.length,
    partitionCode: partition.code,
    storageDriver: partition.storageDriver || 'local',
    storagePath: stored.storagePath,
    url: buildAttachmentFileUrl(attachmentId),
  })
  await em.persistAndFlush(att)

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
    },
  })
}

export async function DELETE(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth || !auth.orgId || !auth.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const url = new URL(req.url)
  const id = url.searchParams.get('id') || ''
  if (!id) return NextResponse.json({ error: 'Attachment id is required' }, { status: 400 })
  const { resolve } = await createRequestContainer()
  const em = resolve('em') as EntityManager
  const record = await em.findOne(Attachment, {
    id,
    organizationId: auth.orgId!,
    tenantId: auth.tenantId!,
  })
  if (!record) return NextResponse.json({ error: 'Attachment not found' }, { status: 404 })
  await em.removeAndFlush(record)
  if (record.storagePath) {
    await deletePartitionFile(record.partitionCode, record.storagePath, record.storageDriver)
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
