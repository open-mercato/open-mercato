import { createHash } from 'node:crypto'
import path from 'node:path'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import {
  detectAttachmentMimeType,
  hasDangerousExecutableExtension,
  isActiveContentAttachment,
} from '@open-mercato/core/modules/attachments/lib/security'
import type { AttachmentQuotaService } from '@open-mercato/core/modules/attachments/lib/quota-service'
import { S3StorageDriver } from '../../../../../lib/s3-driver'

export const metadata = {
  path: '/storage-providers/s3/signed-upload/:token',
  PUT: { requireAuth: false },
}

type RouteContext = { params?: Promise<{ token?: string }> | { token?: string } }

class UploadBodyTooLargeError extends Error {}

async function readBoundedBody(req: Request, maxBytes: number): Promise<Buffer> {
  if (!req.body) return Buffer.alloc(0)
  const reader = req.body.getReader()
  const chunks: Buffer[] = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > maxBytes) {
        await reader.cancel()
        throw new UploadBodyTooLargeError('Attachment exceeds the reserved upload size.')
      }
      chunks.push(Buffer.from(value))
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks, totalBytes)
}

export async function PUT(req: Request, ctx: RouteContext) {
  const params = ctx.params instanceof Promise ? await ctx.params : ctx.params
  const token = params?.token?.trim()
  if (!token) return NextResponse.json({ error: 'Upload token is required.' }, { status: 400 })

  const { resolve } = await createRequestContainer()
  let quotaService: AttachmentQuotaService | null = null
  try {
    quotaService = resolve('attachmentQuotaService') as AttachmentQuotaService
  } catch {
    // Fail closed below when the attachments quota service is not registered.
  }
  if (!quotaService) return NextResponse.json({ error: 'Storage quota accounting is unavailable.' }, { status: 500 })

  const tokenHash = createHash('sha256').update(token).digest('hex')
  const reservation = await quotaService.claimPendingByUploadTokenHash(tokenHash)
  if (!reservation || reservation.source !== 'storage_s3_signed') {
    return NextResponse.json({ error: 'Upload token is invalid or expired.' }, { status: 410 })
  }

  const declaredLengthHeader = req.headers.get('content-length')
  const declaredLength = declaredLengthHeader == null ? null : Number(declaredLengthHeader)
  if (declaredLength !== null && Number.isFinite(declaredLength) && declaredLength > reservation.reservedBytes) {
    await quotaService.release(reservation.id, reservation.leaseToken).catch(() => {})
    return NextResponse.json({ error: 'Attachment exceeds the reserved upload size.' }, { status: 413 })
  }
  let buffer: Buffer
  try {
    buffer = await readBoundedBody(req, reservation.reservedBytes)
  } catch (error) {
    await quotaService.release(reservation.id, reservation.leaseToken).catch(() => {})
    if (error instanceof UploadBodyTooLargeError) {
      return NextResponse.json({ error: error.message }, { status: 413 })
    }
    return NextResponse.json({ error: 'Failed to read attachment.' }, { status: 400 })
  }
  if (buffer.length > reservation.reservedBytes) {
    await quotaService.release(reservation.id, reservation.leaseToken).catch(() => {})
    return NextResponse.json({ error: 'Attachment exceeds the reserved upload size.' }, { status: 413 })
  }
  const fileName = path.posix.basename(reservation.storagePath)
  if (hasDangerousExecutableExtension(fileName)) {
    await quotaService.release(reservation.id, reservation.leaseToken).catch(() => {})
    return NextResponse.json({ error: 'Executable file types are not allowed as attachments.' }, { status: 400 })
  }
  const contentType = detectAttachmentMimeType(buffer, fileName, req.headers.get('content-type'))
  if (isActiveContentAttachment(buffer, fileName, contentType)) {
    await quotaService.release(reservation.id, reservation.leaseToken).catch(() => {})
    return NextResponse.json({ error: 'Active content uploads are not allowed.' }, { status: 400 })
  }

  const credentialsService = resolve('integrationCredentialsService') as {
    resolve(integrationId: string, scope: { tenantId: string; organizationId: string }): Promise<Record<string, unknown> | null>
  }
  const credentials = await credentialsService.resolve('storage_s3', {
    tenantId: reservation.tenantId,
    organizationId: reservation.organizationId,
  })
  if (!credentials) {
    await quotaService.release(reservation.id, reservation.leaseToken).catch(() => {})
    return NextResponse.json({ error: 'S3 integration is not configured.' }, { status: 400 })
  }

  const driver = new S3StorageDriver(credentials)
  let objectStored = false
  try {
    await driver.putObject(reservation.storagePath, buffer, contentType)
    objectStored = true
    await quotaService.markStored(reservation.id, reservation.leaseToken)
    await quotaService.completeStandalone(reservation.id, reservation.leaseToken, buffer.length)
    return new NextResponse(null, { status: 200 })
  } catch (error) {
    if (objectStored) {
      try {
        await driver.deleteStrict('', reservation.storagePath)
        await quotaService.release(reservation.id, reservation.leaseToken)
      } catch {
        // Retain the reservation when object absence cannot be proven.
      }
    }
    return NextResponse.json({ error: 'Failed to persist attachment.' }, { status: 500 })
  }
}

export default PUT

export const openApi: OpenApiRouteDoc = {
  tag: 'Storage',
  summary: 'Upload through a bounded one-time compatibility URL',
  methods: {
    PUT: {
      summary: 'Upload an object using a bounded one-time token',
      responses: [{ status: 200, description: 'Upload completed', schema: z.any() }],
      errors: [
        { status: 400, description: 'Invalid upload', schema: z.object({ error: z.string() }) },
        { status: 410, description: 'Token invalid or expired', schema: z.object({ error: z.string() }) },
        { status: 413, description: 'Upload exceeds reserved size', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
