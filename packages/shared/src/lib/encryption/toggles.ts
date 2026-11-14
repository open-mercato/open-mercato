import { parseBooleanToken } from '../boolean'

export function isTenantDataEncryptionEnabled(): boolean {
  const rawEnv = process.env.TENANT_DATA_ENCRYPTION
  if (rawEnv === undefined) return true
  const trimmed = rawEnv.trim()
  if (!trimmed) return true
  const parsed = parseBooleanToken(trimmed)
  return parsed === null ? true : parsed
}

export function isTenantDataEncryptionRequired(): boolean {
  if (process.env.NODE_ENV === 'production') return true
  const parsed = parseBooleanToken(process.env.TENANT_DATA_ENCRYPTION_REQUIRED ?? '')
  return parsed === true
}

export class TenantDataEncryptionConfigurationError extends Error {
  readonly code = 'TENANT_DATA_ENCRYPTION_CONFIGURATION_INVALID'

  constructor(message: string) {
    super(message)
    this.name = 'TenantDataEncryptionConfigurationError'
  }
}

export function assertTenantDataEncryptionConfiguration(kmsHealthy: boolean): void {
  if (!isTenantDataEncryptionRequired()) return
  if (!isTenantDataEncryptionEnabled()) {
    throw new TenantDataEncryptionConfigurationError(
      'Tenant data encryption is required but TENANT_DATA_ENCRYPTION is disabled',
    )
  }
  if (!kmsHealthy) {
    throw new TenantDataEncryptionConfigurationError(
      'Tenant data encryption is required but no healthy KMS or dedicated fallback key is available',
    )
  }
}

export function isEncryptionDebugEnabled(): boolean {
  const parsed = parseBooleanToken(process.env.TENANT_DATA_ENCRYPTION_DEBUG ?? '')
  return parsed === true
}
