export function isTenantDataEncryptionEnabled(): boolean {
  const rawEnv = process.env.TENANT_DATA_ENCRYPTION
  if (rawEnv === undefined) return true
  const raw = rawEnv.toLowerCase()
  const explicitOff = ['no', 'false', '0', 'off', 'disabled']
  if (explicitOff.includes(raw)) return false
  const explicitOn = ['yes', 'true', '1', 'on', 'enabled', '']
  return explicitOn.includes(raw) || raw.length > 0 // treat any other set value as “on”
}

export function isEncryptionDebugEnabled(): boolean {
  const raw = (process.env.TENANT_DATA_ENCRYPTION_DEBUG ?? '').toLowerCase()
  return raw === 'yes' || raw === 'true' || raw === '1'
}
