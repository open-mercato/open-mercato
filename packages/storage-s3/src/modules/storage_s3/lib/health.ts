import { S3Client, HeadBucketCommand } from '@aws-sdk/client-s3'
import type { S3DriverConfig } from './s3-driver'

export const s3HealthCheck = {
  async check(credentials: Record<string, unknown>): Promise<{
    status: 'healthy' | 'unhealthy'
    message: string
    details: Record<string, unknown>
    checkedAt: Date
  }> {
    const cfg = credentials as S3DriverConfig
    const checkedAt = new Date()

    if (!cfg.bucket || !cfg.region) {
      return {
        status: 'unhealthy',
        message: 'Missing required credentials: bucket and region are required.',
        details: { bucket: cfg.bucket, region: cfg.region },
        checkedAt,
      }
    }

    let credentialConfig: { accessKeyId: string; secretAccessKey: string } | undefined
    if (cfg.credentialsEnvPrefix) {
      const prefix = cfg.credentialsEnvPrefix
      const accessKeyId = process.env[`${prefix}_ACCESS_KEY_ID`]
      const secretAccessKey = process.env[`${prefix}_SECRET_ACCESS_KEY`]
      if (accessKeyId && secretAccessKey) credentialConfig = { accessKeyId, secretAccessKey }
    } else if (cfg.accessKeyId && cfg.secretAccessKey) {
      credentialConfig = { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey }
    }

    const client = new S3Client({
      region: cfg.region ?? 'us-east-1',
      endpoint: cfg.endpoint,
      forcePathStyle: cfg.forcePathStyle ?? false,
      credentials: credentialConfig,
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
