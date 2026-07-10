import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import {
  detectAttachmentMimeType,
  hasDangerousExecutableExtension,
  isActiveContentAttachment,
} from '@open-mercato/core/modules/attachments/lib/security'
import {
  isMultipartRequestWithinUploadLimit,
  resolveAttachmentMaxBytes,
  willExceedAttachmentTenantQuota,
} from '@open-mercato/core/modules/attachments/lib/upload-limits'
import { isS3KeyScopedToTenant } from '../../../../lib/key-scope'
import { S3StorageDriver } from '../../../../lib/s3-driver'
import type { AttachmentQuotaService } from '@open-mercato/core/modules/attachments/lib/quota-service'
import { reconcileTenantS3Objects } from '../../../../lib/quota-accounting'
import { randomUUID } from 'crypto'

export const metadata = {
  path: '/storage-providers/s3/upload',
  POST: { requireAuth: true, requireFeatures: ['storage_providers.manage'] },
}

const responseSchema = z.object({
  key: z.string(),
  bucket: z.string(),
  size: z.number().int(),
  contentType: z.string().optional(),
})

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_') || 'upload'
}

async function resolveDriver(
  tenantId: string,
  orgId: string,
): Promise<S3StorageDriver | null> {
  const { resolve } = await createRequestContainer()
  const credentialsService = resolve('integrationCredentialsService') as {
    resolve(integrationId: string, scope: { tenantId: string; organizationId: string }): Promise<Record<string, unknown> | null>
  }
  const creds = await credentialsService.resolve('storage_s3', { tenantId, organizationId: orgId })
  if (!creds) return null
  return new S3StorageDriver(creds)
}

async function readTenantStorageUsageBytes(
  driver: S3StorageDriver,
  tenantId: string,
  orgId: string,
): Promise<number> {
  let totalBytes = 0
  let continuationToken: string | undefined

  do {
    const page = await driver.listObjects('', 1000, continuationToken)
    for (const file of page.files) {
      if (file.key.startsWith('uploads/') && isS3KeyScopedToTenant(file.key, orgId, tenantId)) {
        totalBytes += file.size
      }
    }
    continuationToken = page.truncated ? page.nextContinuationToken : undefined
  } while (continuationToken)

  return totalBytes
}

export async function POST(req: Request) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId || !auth.orgId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  if (!isMultipartRequestWithinUploadLimit(req.headers.get('content-length'))) {
    return NextResponse.json({ error: 'Attachment exceeds the maximum upload size.' }, { status: 413 })
  }

  const contentType = req.headers.get('content-type') ?? ''
  if (!contentType.includes('multipart/form-data')) {
    return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 })
  }

  const form = await req.formData()
  const file = form.get('file') as File | null
  if (!file) {
    return NextResponse.json({ error: 'file field is required' }, { status: 400 })
  }

  const keyOverride = form.get('key') ? String(form.get('key')) : null

  if (keyOverride !== null && !isS3KeyScopedToTenant(keyOverride, auth.orgId, auth.tenantId)) {
    return NextResponse.json(
      { error: 'Access denied: key override is not scoped to this tenant.' },
      { status: 403 },
    )
  }

  if (hasDangerousExecutableExtension(file.name)) {
    return NextResponse.json({ error: 'Executable file types are not allowed as attachments.' }, { status: 400 })
  }

  const effectiveMaxBytes = resolveAttachmentMaxBytes()
  if (file.size > effectiveMaxBytes) {
    return NextResponse.json({ error: 'Attachment exceeds the maximum upload size.' }, { status: 413 })
  }

  const driver = await resolveDriver(auth.tenantId, auth.orgId)
  if (!driver) {
    return NextResponse.json({ error: 'S3 integration is not configured.' }, { status: 400 })
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const safeName = sanitizeFileName(file.name)
  const trustedMimeType = detectAttachmentMimeType(buffer, safeName, file.type || null)
  if (isActiveContentAttachment(buffer, safeName, trustedMimeType)) {
    return NextResponse.json({ error: 'Active content uploads are not allowed.' }, { status: 400 })
  }

  const key =
    keyOverride ??
    `uploads/org_${auth.orgId}/tenant_${auth.tenantId}/${Date.now()}_${randomUUID().slice(0, 8)}_${safeName}`

  const { resolve } = await createRequestContainer()
  let attachmentQuotaService: AttachmentQuotaService | null = null
  let recoveryScheduler: ((reservationId: string, delayMs: number) => Promise<void>) | null = null
  try {
    attachmentQuotaService = resolve('attachmentQuotaService') as AttachmentQuotaService
    recoveryScheduler = resolve('storageS3QuotaRecoveryScheduler') as (
      reservationId: string,
      delayMs: number,
    ) => Promise<void>
  } catch {
    // Backward-compatible fallback below when the attachments quota service is not registered.
  }
  let reservation: { id: string; leaseToken: string; expiresAt: Date } | null = null
  if (attachmentQuotaService) {
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
        bytes: buffer.length,
        source: 'storage_s3_upload',
        storageDriver: 's3',
        storagePath: key,
      })
      if (recoveryScheduler) {
        await recoveryScheduler(reservation.id, Math.max(1_000, reservation.expiresAt.getTime() - Date.now()))
      }
      await attachmentQuotaService.beginStorage(reservation.id, reservation.leaseToken)
    } catch (error) {
      if (reservation) {
        await attachmentQuotaService.release(reservation.id, reservation.leaseToken).catch(() => {})
        reservation = null
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
  } else {
    const tenantUsageBytes = await readTenantStorageUsageBytes(driver, auth.tenantId, auth.orgId)
    if (willExceedAttachmentTenantQuota(tenantUsageBytes, buffer.length)) {
      return NextResponse.json({ error: 'Attachment storage quota exceeded for this tenant.' }, { status: 413 })
    }
  }

  try {
    await driver.putObject(key, buffer, trustedMimeType)
    if (reservation) {
      await attachmentQuotaService!.markStored(reservation.id, reservation.leaseToken)
      await attachmentQuotaService!.completeStandalone(reservation.id, reservation.leaseToken, buffer.length)
    }
  } catch (error) {
    if (reservation) {
      try {
        await driver.deleteStrict('', key)
        await attachmentQuotaService!.release(reservation.id, reservation.leaseToken)
      } catch {
        // Retain the reservation when object absence cannot be proven.
      }
    }
    return NextResponse.json({ error: 'Failed to persist attachment.' }, { status: 500 })
  }

  return NextResponse.json({
    key,
    bucket: driver.getBucket(),
    size: buffer.length,
    contentType: trustedMimeType,
  })
}

export default POST

export const openApi: OpenApiRouteDoc = {
  tag: 'Storage',
  summary: 'Upload file to S3',
  methods: {
    POST: {
      summary: 'Upload a file directly to S3',
      description: 'Uploads a file to the configured S3 bucket. Requires storage_providers.manage feature.',
      requestBody: {
        contentType: 'multipart/form-data',
        schema: z.object({
          file: z.any().describe('File to upload'),
          key: z.string().optional().describe('Optional S3 key override (must be scoped to org/tenant)'),
          contentType: z.string().optional().describe('Optional client-provided content-type hint; the server derives the trusted MIME type.'),
        }),
      },
      responses: [{ status: 200, description: 'Upload result', schema: responseSchema }],
      errors: [
        { status: 400, description: 'Missing file, blocked file type, or S3 not configured', schema: z.object({ error: z.string() }) },
        { status: 401, description: 'Unauthorized', schema: z.object({ error: z.string() }) },
        { status: 403, description: 'Key override not scoped to this tenant', schema: z.object({ error: z.string() }) },
        { status: 413, description: 'Upload too large or tenant storage quota exceeded', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
