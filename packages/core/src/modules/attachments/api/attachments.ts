import { NextResponse } from 'next/server'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import { promises as fs } from 'fs'
import path from 'path'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { buildAttachmentImageUrl, slugifyAttachmentFileName } from '../lib/imageUrls'

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
  const { Attachment } = await import('../data/entities')
  const items = await em.find(
    Attachment as any,
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
  const em = resolve('em') as any
  // Optional per-field validations
  if (fieldKey) {
    try {
      const { CustomFieldDef } = await import('@open-mercato/core/modules/entities/data/entities')
      const def = await em.findOne(CustomFieldDef as any, {
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
    } catch {}
  }
  const buf = Buffer.from(await file.arrayBuffer())
  const uploadsDir = path.join(process.cwd(), 'public', 'uploads', 'attachments')
  await fs.mkdir(uploadsDir, { recursive: true })
  const safeName = String(file.name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_')
  const fname = `${Date.now()}_${safeName}`
  const outPath = path.join(uploadsDir, fname)
  await fs.writeFile(outPath, buf)
  const urlPath = `/uploads/attachments/${fname}`

  let AttachmentEntity: any
  try {
    const mod = await import('../data/entities')
    AttachmentEntity = (mod as any).Attachment
  } catch (_e) {
    AttachmentEntity = class Attachment {}
  }
  const att = em.create(AttachmentEntity as any, {
    entityId,
    recordId,
    organizationId: auth.orgId!,
    tenantId: auth.tenantId!,
    fileName: safeName,
    mimeType: (file as any).type || 'application/octet-stream',
    fileSize: buf.length,
    url: urlPath,
  })
  await em.persistAndFlush(att)

  const attachmentId = (att as any).id
  return NextResponse.json({
    ok: true,
    item: {
      id: attachmentId,
      url: urlPath,
      fileName: safeName,
      fileSize: buf.length,
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
  const em = resolve('em') as any
  let AttachmentEntity: any
  try {
    const mod = await import('../data/entities')
    AttachmentEntity = (mod as any).Attachment
  } catch (_e) {
    AttachmentEntity = class Attachment {}
  }
  const record = await em.findOne(AttachmentEntity as any, {
    id,
    organizationId: auth.orgId!,
    tenantId: auth.tenantId!,
  })
  if (!record) return NextResponse.json({ error: 'Attachment not found' }, { status: 404 })
  const relativePath = typeof record.url === 'string' ? record.url.replace(/^\//, '') : null
  const safePath = relativePath ? relativePath.replace(/\.\.(\/|\\)/g, '') : null
  const fullPath = safePath ? path.join(process.cwd(), 'public', safePath) : null
  await em.removeAndFlush(record)
  if (fullPath) {
    try {
      await fs.unlink(fullPath)
    } catch {
      // ignore unlink failures
    }
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
