import type { AttachmentStorageValidationContext } from '@open-mercato/core/modules/attachments/lib/drivers'
import { s3StorageConfigurationSchema } from '../data/validators'
import { assertStaticallySafeS3Endpoint } from './endpoint-safety'

export function validateS3StorageConfiguration(context: AttachmentStorageValidationContext): boolean {
  const parsed = s3StorageConfigurationSchema.safeParse(context.config)
  if (!parsed.success) return false
  const config = parsed.data
  const hasAccessKey = Boolean(config.accessKeyId)
  const hasSecretKey = Boolean(config.secretAccessKey)
  if (hasAccessKey !== hasSecretKey) return false
  if (config.credentialsEnvPrefix && (hasAccessKey || hasSecretKey || config.sessionToken)) return false
  if (config.authMode === 'ambient' && (hasAccessKey || config.credentialsEnvPrefix || config.sessionToken)) return false
  if (config.sessionToken && !hasAccessKey) return false
  if (Boolean(config.tenantId) !== Boolean(config.organizationId)) return false
  if (context.scope && (
    (config.tenantId != null && config.tenantId !== context.scope.tenantId)
    || (config.organizationId != null && config.organizationId !== context.scope.organizationId)
  )) return false
  try {
    assertStaticallySafeS3Endpoint(config.endpoint)
  } catch {
    return false
  }
  if (config.credentialsEnvPrefix && (
    !process.env[`${config.credentialsEnvPrefix}_ACCESS_KEY_ID`]
    || !process.env[`${config.credentialsEnvPrefix}_SECRET_ACCESS_KEY`]
  )) return false
  if (context.stage === 'resolved') {
    if (!config.bucket) return false
    if (config.authMode === 'access_keys' && !hasAccessKey && !config.credentialsEnvPrefix) return false
  }
  return true
}
