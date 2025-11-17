import { NextResponse } from 'next/server'
import { promises as fs } from 'fs'
import path from 'path'
import sharp from 'sharp'
import { z } from 'zod'
import { getAuthFromRequest } from '@/lib/auth/server'
import { createRequestContainer } from '@/lib/di/container'

const querySchema = z.object({
  width: z.coerce.number().int().min(1).max(4000).optional(),
  height: z.coerce.number().int().min(1).max(4000).optional(),
})

export const metadata = {
  GET: { requireAuth: true },
}

export async function GET(
  req: Request,
  context: { params: { id: string; slug?: string[] | undefined } }
) {
  const auth = await getAuthFromRequest(req)
  if (!auth || !auth.orgId || !auth.tenantId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const id = context.params.id
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
  const em = resolve('em') as any
  let AttachmentEntity: any
  try {
    const mod = await import('@open-mercato/core/modules/attachments/data/entities')
    AttachmentEntity = mod.Attachment
  } catch {
    return NextResponse.json({ error: 'Attachment model missing' }, { status: 500 })
  }

  const attachment = await em.findOne(AttachmentEntity, {
    id,
    organizationId: auth.orgId,
    tenantId: auth.tenantId,
  })
  if (!attachment) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  if (typeof attachment.mimeType !== 'string' || !attachment.mimeType.startsWith('image/')) {
    return NextResponse.json({ error: 'Unsupported media type' }, { status: 400 })
  }

  const relativePath = attachment.url.startsWith('/') ? attachment.url.substring(1) : attachment.url
  const safePath = relativePath.replace(/\.\.(\/|\\)/g, '')
  const filePath = path.join(process.cwd(), 'public', safePath)
  try {
    const input = await fs.readFile(filePath)
    let transformer = sharp(input)
    if (width || height) {
      transformer = transformer.resize({
        width: width || undefined,
        height: height || undefined,
        fit: 'cover',
      })
    }
    const buffer = await transformer.toBuffer()
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': attachment.mimeType || 'image/jpeg',
        'Cache-Control': 'public, max-age=3600',
      },
    })
  } catch (error) {
    console.error('attachments.image.read failed', error)
    return NextResponse.json({ error: 'Failed to render image' }, { status: 500 })
  }
}
