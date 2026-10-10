import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { Attachment, AttachmentPartition } from '@open-mercato/core/modules/attachments/data/entities'
import { renderImageRendition } from '@open-mercato/core/modules/attachments/lib/imageRendition'
import { canRenderInlineAttachment } from '@open-mercato/core/modules/attachments/lib/security'
import { checkAttachmentAccess, isSuperAdminAuth } from '@open-mercato/core/modules/attachments/lib/access'
import type { EntityManager } from '@mikro-orm/postgresql'
import { attachmentsTag, imageQuerySchema, attachmentErrorSchema } from '../../../openapi'
import { StorageDriverFactory } from '../../../../lib/drivers'
import { resolveAttachmentRequestScope } from '@open-mercato/core/modules/attachments/lib/requestScope'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('attachments').child({ component: 'image' })

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

  const container = await createRequestContainer()
  const em = container.resolve('em') as EntityManager
  const storageDriverFactory =
    (container.resolve('storageDriverFactory') as StorageDriverFactory | null) ?? new StorageDriverFactory(em)

  const requestScope = await resolveAttachmentRequestScope(container, auth, req)
  if (requestScope.denied) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  const scopedAuth = auth ? { ...auth, orgId: requestScope.organizationId } : auth
  const findFilter: Record<string, unknown> = { id }
  if (scopedAuth && !isSuperAdminAuth(scopedAuth)) {
    if (scopedAuth.tenantId) findFilter.tenantId = scopedAuth.tenantId
    if (scopedAuth.orgId) findFilter.organizationId = scopedAuth.orgId
  }
  const attachment = await em.findOne(Attachment, findFilter)
  if (!attachment) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  if (!canRenderInlineAttachment(attachment.mimeType)) {
    return NextResponse.json({ error: 'Unsupported media type' }, { status: 400 })
  }
  const partition = await em.findOne(AttachmentPartition, { code: attachment.partitionCode })
  if (!partition) {
    return NextResponse.json({ error: 'Partition misconfigured' }, { status: 500 })
  }
  const access = checkAttachmentAccess(scopedAuth, attachment, partition)
  if (!access.ok) {
    const message = access.status === 401 ? 'Unauthorized' : 'Forbidden'
    return NextResponse.json({ error: message }, { status: access.status })
  }

  const driver = await storageDriverFactory.resolveForPartition(attachment.partitionCode, {
    tenantId: attachment.tenantId ?? '',
    organizationId: attachment.organizationId ?? '',
  })
  try {
    const rendition = await renderImageRendition({
      attachment,
      readSource: async () => (await driver.read(attachment.partitionCode, attachment.storagePath)).buffer,
      size: { width, height, cropType },
    })
    if (!rendition.ok) {
      return NextResponse.json({ error: rendition.error }, { status: rendition.status })
    }
    const responseBody = new Uint8Array(rendition.buffer)

    return new NextResponse(responseBody, {
      headers: {
        'Content-Type': attachment.mimeType || 'image/jpeg',
        'Cache-Control': partition.isPublic ? 'public, max-age=3600' : 'private, max-age=60',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    logger.error('Image read failed', { err: error })
    return NextResponse.json({ error: 'Failed to render image' }, { status: 500 })
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: attachmentsTag,
  summary: 'Serve resized images',
  methods: {
    GET: {
      summary: 'Serve image with optional resizing',
      description: 'Returns an image attachment with optional on-the-fly resizing and cropping. Resized images are cached for performance. Only works with image MIME types. Path parameter: {id} - Attachment UUID. Query parameters: ?width=N (1-4000 pixels), ?height=N (1-4000 pixels), ?cropType=cover|contain (resize behavior).',
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
        { status: 422, description: 'Stored image cannot be decoded', schema: attachmentErrorSchema },
        { status: 500, description: 'Partition misconfigured or image rendering failed', schema: attachmentErrorSchema },
      ],
    },
  },
}
