import { NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import { getAuthFromRequest } from '@/lib/auth/server'
import { createRequestContainer } from '@/lib/di/container'
import { Attachment, AttachmentPartition } from '@open-mercato/core/modules/attachments/data/entities'
import { resolveAttachmentAbsolutePath } from '@open-mercato/core/modules/attachments/lib/storage'
import type { EntityManager } from '@mikro-orm/postgresql'
import { checkAttachmentAccess } from '@open-mercato/core/modules/attachments/lib/access'

export const metadata = {
  GET: { requireAuth: false },
}

export async function GET(req: Request, context: { params: { id: string } }) {
  const id = context.params.id
  if (!id) {
    return NextResponse.json({ error: 'Attachment id is required' }, { status: 400 })
  }
  const auth = await getAuthFromRequest(req)
  const { resolve } = await createRequestContainer()
  const em = resolve('em') as EntityManager

  const attachment = await em.findOne(Attachment, { id })
  if (!attachment) {
    return NextResponse.json({ error: 'Attachment not found' }, { status: 404 })
  }
  const partition = await em.findOne(AttachmentPartition, { code: attachment.partitionCode })
  if (!partition) {
    return NextResponse.json({ error: 'Partition misconfigured' }, { status: 500 })
  }

  const access = checkAttachmentAccess(auth, attachment, partition)
  if (!access.ok) {
    const message = access.status === 401 ? 'Unauthorized' : 'Forbidden'
    return NextResponse.json({ error: message }, { status: access.status })
  }

  const filePath = resolveAttachmentAbsolutePath(attachment.partitionCode, attachment.storagePath)
  let buffer: Buffer
  try {
    buffer = await fs.readFile(filePath)
  } catch {
    return NextResponse.json({ error: 'File not available' }, { status: 404 })
  }

  const url = new URL(req.url)
  const forceDownload = url.searchParams.get('download') === '1'
  const headers: Record<string, string> = {
    'Content-Type': attachment.mimeType || 'application/octet-stream',
    'Cache-Control': partition.isPublic ? 'public, max-age=86400' : 'private, max-age=60',
  }
  if (attachment.fileSize > 0) {
    headers['Content-Length'] = String(attachment.fileSize)
  }
  if (forceDownload) {
    headers['Content-Disposition'] = `attachment; filename="${encodeURIComponent(attachment.fileName)}"`
  }

  return new NextResponse(buffer, { status: 200, headers })
}
