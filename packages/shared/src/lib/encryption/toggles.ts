export function isTenantDataEncryptionEnabled(): boolean {
  const raw = (process.env.TENANT_DATA_ENCRYPTION ?? 'yes').toLowerCase()
  return raw === 'yes' || raw === 'true' || raw === '1' || raw === '' // default on
}

export function isEncryptionDebugEnabled(): boolean {
  const raw = (process.env.TENANT_DATA_ENCRYPTION_DEBUG ?? '').toLowerCase()
  return raw === 'yes' || raw === 'true' || raw === '1'
}
