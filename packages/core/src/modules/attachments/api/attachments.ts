import { NextResponse } from 'next/server'
import { createRequestContainer } from '@/lib/di/container'
import { getAuthFromRequest } from '@/lib/auth/server'
import { promises as fs } from 'fs'
import path from 'path'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['attachments.view'] },
  POST: { requireAuth: true, requireFeatures: ['attachments.manage'] },
}

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
  return NextResponse.json({ items: items.map((a: any) => ({ id: a.id, url: a.url, fileName: a.fileName, fileSize: a.fileSize, createdAt: a.createdAt })) })
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

  return NextResponse.json({ ok: true, item: { id: (att as any).id, url: urlPath, fileName: safeName, fileSize: buf.length } })
}
