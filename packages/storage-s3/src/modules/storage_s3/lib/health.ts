import { S3Client, HeadBucketCommand } from '@aws-sdk/client-s3'
import { assertSafeS3Endpoint, createSafeS3RequestHandler } from './endpoint-safety'
import { tenantS3CredentialsSchema } from '../data/validators'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'

export const s3HealthCheck = {
  async check(credentials: Record<string, unknown>): Promise<{
    status: 'healthy' | 'unhealthy'
    message: string
    details: Record<string, unknown>
    checkedAt: Date
  }> {
    const checkedAt = new Date()
    const parsed = tenantS3CredentialsSchema.safeParse(credentials)
    if (!parsed.success) {
      const { t } = await resolveTranslations()
      return {
        status: 'unhealthy',
        message: t('storage_s3.errors.explicitCredentialsRequired'),
        details: {},
        checkedAt,
      }
    }
    const cfg = parsed.data
    const credentialConfig = {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
      ...(cfg.sessionToken ? { sessionToken: cfg.sessionToken } : {}),
    }

    try {
      await assertSafeS3Endpoint(cfg.endpoint)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unsafe S3 endpoint'
      const reason = err && typeof err === 'object' && 'reason' in err ? (err as { reason?: unknown }).reason : undefined
      return {
        status: 'unhealthy',
        message,
        details: {
          ...(typeof reason === 'string' ? { reason } : {}),
        },
        checkedAt,
      }
    }

    const requestHandler = createSafeS3RequestHandler(cfg.endpoint)
    const client = new S3Client({
      region: cfg.region ?? 'us-east-1',
      endpoint: cfg.endpoint,
      forcePathStyle: cfg.forcePathStyle ?? false,
      credentials: credentialConfig,
      ...(requestHandler ? { requestHandler } : {}),
    })

    try {
      await client.send(new HeadBucketCommand({ Bucket: cfg.bucket }))
      return {
        status: 'healthy',
        message: `Connected to bucket "${cfg.bucket}" in region "${cfg.region}".`,
        details: {
          bucket: cfg.bucket,
          region: cfg.region,
          endpoint: cfg.endpoint ?? '(AWS default)',
        },
        checkedAt,
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error'
      return {
        status: 'unhealthy',
        message: `S3 connection failed: ${message}`,
        details: { bucket: cfg.bucket, region: cfg.region, error: message },
        checkedAt,
      }
    }
  },
}
