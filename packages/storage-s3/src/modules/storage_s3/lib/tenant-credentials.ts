import { tenantS3CredentialsSchema } from '../data/validators'
import type { S3DriverConfig } from './s3-driver'

export function buildTenantS3DriverConfig(
  credentials: Record<string, unknown>,
  scope: { organizationId: string; tenantId: string },
): S3DriverConfig | null {
  const parsed = tenantS3CredentialsSchema.safeParse(credentials)
  if (!parsed.success) return null
  return { ...parsed.data, ...scope }
}
