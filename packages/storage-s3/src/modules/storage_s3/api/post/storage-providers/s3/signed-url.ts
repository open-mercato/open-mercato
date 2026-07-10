import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { isS3KeyAddressableByScope, isS3KeyScopedToTenant } from '../../../../lib/key-scope'
import { S3StorageDriver } from '../../../../lib/s3-driver'
import { createHash, randomBytes } from 'node:crypto'
import { resolveAttachmentMaxBytes } from '@open-mercato/core/modules/attachments/lib/upload-limits'
import type { AttachmentQuotaService } from '@open-mercato/core/modules/attachments/lib/quota-service'
import { reconcileTenantS3Objects } from '../../../../lib/quota-accounting'

export const metadata = {
  path: '/storage-providers/s3/signed-url',
  POST: { requireAuth: true, requireFeatures: ['storage_providers.manage'] },
}

const requestSchema = z.object({
  key: z.string().min(1),
  operation: z.enum(['upload', 'download']),
  expiresIn: z.number().int().min(60).max(604800).optional().default(3600),
  contentType: z.string().optional(),
  size: z.number().int().nonnegative().optional(),
})

const responseSchema = z.object({
  url: z.string(),
  expiresAt: z.string(),
  reservationId: z.string().optional(),
})

async function resolveDriver(tenantId: string, orgId: string): Promise<S3StorageDriver | null> {
  const { resolve } = await createRequestContainer()
  const credentialsService = resolve('integrationCredentialsService') as {
    resolve(integrationId: string, scope: { tenantId: string; organizationId: string }): Promise<Record<string, unknown> | null>
  }
  const creds = await credentialsService.resolve('storage_s3', { tenantId, organizationId: orgId })
  if (!creds) return null
  return new S3StorageDriver(creds)
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const json = await req.json().catch(() => null)
  const parsed = requestSchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }

  const { key, operation, expiresIn, contentType, size } = parsed.data
  const canAccessKey = operation === 'download'
    ? isS3KeyAddressableByScope(key, auth.orgId, auth.tenantId)
    : isS3KeyScopedToTenant(key, auth.orgId, auth.tenantId)
  if (!canAccessKey) {
    return NextResponse.json({ error: 'Access denied: key is not scoped to this tenant.' }, { status: 403 })
  }

  const driver = await resolveDriver(auth.tenantId, auth.orgId)
  if (!driver) {
    return NextResponse.json({ error: 'S3 integration is not configured.' }, { status: 400 })
  }

  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString()

  if (operation === 'upload') {
    const { resolve } = await createRequestContainer()
    const attachmentQuotaService = resolve('attachmentQuotaService') as AttachmentQuotaService | null
    const recoveryScheduler = resolve('storageS3QuotaRecoveryScheduler') as
      | ((reservationId: string, delayMs: number) => Promise<void>)
      | null
    if (!attachmentQuotaService) {
      return NextResponse.json({ error: 'Storage quota accounting is unavailable.' }, { status: 500 })
    }
    const compatibilityToken = randomBytes(32).toString('base64url')
    const reservedBytes = size ?? resolveAttachmentMaxBytes()
    let reservation: Awaited<ReturnType<AttachmentQuotaService['reserve']>> | null = null
    try {
      await reconcileTenantS3Objects({
        driver,
        quotaService: attachmentQuotaService,
        tenantId: auth.tenantId,
        organizationId: auth.orgId,
      })
      reservation = await attachmentQuotaService.reserve({
        tenantId: auth.tenantId,
        organizationId: auth.orgId,
        bytes: reservedBytes,
        source: 'storage_s3_signed',
        storageDriver: 's3',
        storagePath: key,
        uploadTokenHash: createHash('sha256').update(compatibilityToken).digest('hex'),
        ttlMs: expiresIn * 1000,
      })
      if (recoveryScheduler) {
        await recoveryScheduler(reservation.id, Math.max(1_000, reservation.expiresAt.getTime() - Date.now()))
      }
      const url = new URL(`/api/storage-providers/s3/signed-upload/${compatibilityToken}`, req.url).toString()
      return NextResponse.json({ url, expiresAt, reservationId: reservation.id })
    } catch (error) {
      if (reservation) {
        await attachmentQuotaService.release(reservation.id, reservation.leaseToken).catch(() => {})
      }
      const code = (error as { code?: unknown })?.code
      if (code === 'quota_exceeded') {
        return NextResponse.json({ error: 'Attachment storage quota exceeded for this tenant.' }, { status: 413 })
      }
      if (code === 'quota_target_exists') {
        return NextResponse.json({ error: 'The target storage key already exists.' }, { status: 409 })
      }
      return NextResponse.json({ error: 'Storage quota accounting is unavailable.' }, { status: 500 })
    }
  }

  const url = await driver.getSignedUrl(key, operation, expiresIn, contentType)

  return NextResponse.json({ url, expiresAt })
}

export default POST

export const openApi: OpenApiRouteDoc = {
  tag: 'Storage',
  summary: 'Generate S3 pre-signed URL',
  methods: {
    POST: {
      summary: 'Generate a pre-signed URL for direct browser upload or download',
      description: 'Returns a time-limited URL that allows a browser to directly upload or download a file from S3.',
      requestBody: { contentType: 'application/json', schema: requestSchema },
      responses: [{ status: 200, description: 'Pre-signed URL and expiry', schema: responseSchema }],
      errors: [
        { status: 400, description: 'Invalid payload or S3 not configured', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
        { status: 403, description: 'Key not scoped to this tenant', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
