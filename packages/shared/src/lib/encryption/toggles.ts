import { parseBooleanToken } from '../boolean'

export function isTenantDataEncryptionEnabled(): boolean {
  const rawEnv = process.env.TENANT_DATA_ENCRYPTION
  if (rawEnv === undefined) return true
  const trimmed = rawEnv.trim()
  if (!trimmed) return true
  const parsed = parseBooleanToken(trimmed)
  return parsed === null ? true : parsed
}

export function isEncryptionDebugEnabled(): boolean {
  const parsed = parseBooleanToken(process.env.TENANT_DATA_ENCRYPTION_DEBUG ?? '')
  return parsed === true
}
