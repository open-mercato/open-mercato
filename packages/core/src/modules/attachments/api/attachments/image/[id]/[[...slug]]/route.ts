import { NextResponse } from 'next/server'
import sharp from 'sharp'
import { z } from 'zod'
import { getAuthFromRequest } from '@/lib/auth/server'
import { createRequestContainer } from '@/lib/di/container'
import { Attachment, AttachmentPartition } from '@open-mercato/core/modules/attachments/data/entities'
import { resolveAttachmentAbsolutePath } from '@open-mercato/core/modules/attachments/lib/storage'
import {
  buildThumbnailCacheKey,
  readThumbnailCache,
  writeThumbnailCache,
} from '@open-mercato/core/modules/attachments/lib/thumbnailCache'
import { checkAttachmentAccess } from '@open-mercato/core/modules/attachments/lib/access'
import type { EntityManager } from '@mikro-orm/postgresql'
import { promises as fs } from 'fs'

const querySchema = z.object({
  width: z.coerce.number().int().min(1).max(4000).optional(),
  height: z.coerce.number().int().min(1).max(4000).optional(),
})

export const metadata = {
  GET: { requireAuth: false },
}

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string; slug?: string[] | undefined }> }
) {
  const auth = await getAuthFromRequest(req)
  const { id } = await context.params
  if (!id) {
    return NextResponse.json({ error: 'Attachment id is required' }, { status: 400 })
  }
  const parsedQuery = querySchema.safeParse(
    Object.fromEntries(new URL(req.url).searchParams.entries())
  )
  if (!parsedQuery.success) {
    return NextResponse.json({ error: 'Invalid size parameters' }, { status: 400 })
  }
  const { width, height } = parsedQuery.data

  const { resolve } = await createRequestContainer()
  const em = resolve('em') as EntityManager

  const attachment = await em.findOne(Attachment, {
    id,
  })
  if (!attachment) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  if (typeof attachment.mimeType !== 'string' || !attachment.mimeType.startsWith('image/')) {
    return NextResponse.json({ error: 'Unsupported media type' }, { status: 400 })
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

  const filePath = resolveAttachmentAbsolutePath(
    attachment.partitionCode,
    attachment.storagePath,
    attachment.storageDriver
  )
  const cacheKey = buildThumbnailCacheKey(width, height)
  try {
    let buffer: Buffer | null = null
    if (cacheKey) {
      buffer = await readThumbnailCache(attachment.partitionCode, attachment.id, cacheKey)
    }
    if (!buffer) {
      const input = await fs.readFile(filePath)
      let transformer = sharp(input)
      if (width || height) {
        transformer = transformer.resize({
          width: width || undefined,
          height: height || undefined,
          fit: 'cover',
        })
      }
      buffer = await transformer.toBuffer()
      if (cacheKey) {
        void writeThumbnailCache(attachment.partitionCode, attachment.id, cacheKey, buffer).catch((cacheError) => {
          console.error('attachments.image.cache.write failed', cacheError)
        })
      }
    }
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': attachment.mimeType || 'image/jpeg',
        'Cache-Control': partition.isPublic ? 'public, max-age=3600' : 'private, max-age=60',
      },
    })
  } catch (error) {
    console.error('attachments.image.read failed', error)
    return NextResponse.json({ error: 'Failed to render image' }, { status: 500 })
  }
}
