import { NextRequest, NextResponse } from 'next/server'
import sharp from 'sharp'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
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
import { attachmentsTag, imageQuerySchema, attachmentErrorSchema } from '../../../openapi'

const querySchema = z.object({
  width: z.coerce.number().int().min(1).max(4000).optional(),
  height: z.coerce.number().int().min(1).max(4000).optional(),
  cropType: z.enum(['cover', 'contain']).optional(),
})

export const metadata = {
  GET: { requireAuth: false },
}

export async function GET(
  req: NextRequest,
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
  const { width, height, cropType } = parsedQuery.data

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
  const cacheKey = buildThumbnailCacheKey(width, height, cropType)
  try {
    let buffer: Buffer | null = null
    if (cacheKey) {
      buffer = await readThumbnailCache(attachment.partitionCode, attachment.id, cacheKey)
    }
    if (!buffer) {
      const input = await fs.readFile(filePath)
      let transformer = sharp(input)
      if (width || height) {
        const resizeOptions: sharp.ResizeOptions = {
          width: width || undefined,
          height: height || undefined,
          fit: cropType === 'contain' ? 'contain' : 'cover',
        }
        if (cropType === 'contain') {
          resizeOptions.background = { r: 0, g: 0, b: 0, alpha: 0 }
        }
        transformer = transformer.resize(resizeOptions)
      }
      buffer = await transformer.toBuffer()
      if (cacheKey) {
        void writeThumbnailCache(attachment.partitionCode, attachment.id, cacheKey, buffer).catch((cacheError) => {
          console.error('attachments.image.cache.write failed', cacheError)
        })
      }
    }
    if (!buffer) {
      return NextResponse.json({ error: 'Failed to render image' }, { status: 500 })
    }
    const responseBody = new Uint8Array(buffer)

    return new NextResponse(responseBody, {
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

export const openApi: OpenApiRouteDoc = {
  tag: attachmentsTag,
  summary: 'Serve resized images',
  methods: {
    GET: {
      summary: 'Serve image with optional resizing',
      description: 'Returns an image attachment with optional on-the-fly resizing and cropping. Resized images are cached for performance. Only works with image MIME types. Supports width/height constraints and cover/contain crop modes.',
      parameters: [
        {
          name: 'id',
          in: 'path',
          description: 'Attachment UUID',
          required: true,
          schema: z.string().uuid(),
        },
        {
          name: 'width',
          in: 'query',
          description: 'Target width in pixels (1-4000)',
          required: false,
          schema: z.coerce.number().int().min(1).max(4000),
        },
        {
          name: 'height',
          in: 'query',
          description: 'Target height in pixels (1-4000)',
          required: false,
          schema: z.coerce.number().int().min(1).max(4000),
        },
        {
          name: 'cropType',
          in: 'query',
          description: 'Resize behavior: "cover" crops to fill dimensions, "contain" fits within bounds',
          required: false,
          schema: z.enum(['cover', 'contain']),
        },
      ],
      responses: [
        {
          status: 200,
          description: 'Binary image content (Content-Type: image/jpeg, image/png, etc.)',
          schema: z.any().describe('Binary image content - actual Content-Type header set to image MIME type, not application/json'),
        },
      ],
      errors: [
        { status: 400, description: 'Invalid parameters, missing ID, or non-image attachment', schema: attachmentErrorSchema },
        { status: 401, description: 'Unauthorized - authentication required for private partitions', schema: attachmentErrorSchema },
        { status: 403, description: 'Forbidden - insufficient permissions', schema: attachmentErrorSchema },
        { status: 404, description: 'Image not found', schema: attachmentErrorSchema },
        { status: 500, description: 'Partition misconfigured or image rendering failed', schema: attachmentErrorSchema },
      ],
    },
  },
}
