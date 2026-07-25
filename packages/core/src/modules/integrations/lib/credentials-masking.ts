import type {
  CredentialFieldType,
  IntegrationCredentialsSchema,
} from '@open-mercato/shared/modules/integrations/types'

/**
 * Credential field types whose stored value is a secret (API keys, OAuth client
 * secrets/tokens, SSH private keys). These MUST never be returned in plaintext
 * from the credentials API — they are masked on read and treated as write-only.
 */
export const SECRET_CREDENTIAL_FIELD_TYPES: ReadonlySet<CredentialFieldType> = new Set<CredentialFieldType>([
  'secret',
  'oauth',
  'ssh_keypair',
])

/**
 * Opaque sentinel returned in place of a configured secret value. The client
 * round-trips this value back on save when the user did not change the field;
 * the PUT handler then preserves the existing stored secret instead of writing
 * the sentinel. Chosen to be extremely unlikely to collide with a real secret.
 */
export const MASKED_SECRET_VALUE = '__om_secret_unchanged__'

function isSecretField(type: CredentialFieldType): boolean {
  return SECRET_CREDENTIAL_FIELD_TYPES.has(type)
}

function redactUrlUserinfo(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try {
    const parsed = new URL(value)
    if (!parsed.username && !parsed.password) return value
    parsed.username = ''
    parsed.password = ''
    return parsed.toString()
  } catch {
    return value
  }
}

function hasPresentValue(value: unknown): boolean {
  if (value === undefined || value === null) return false
  if (typeof value === 'string') return value.length > 0
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0
  return true
}

export type MaskSecretCredentialsResult = {
  credentials: Record<string, unknown>
  secretFieldsConfigured: Record<string, boolean>
}

/**
 * Replace every configured secret-typed field with an opaque sentinel so the
 * decrypted plaintext never reaches the API response (and therefore the
 * browser, devtools, proxies, or editable DOM inputs). Non-secret config fields
 * pass through unchanged. A `secretFieldsConfigured` map reports which secret
 * fields currently hold a value without exposing it.
 */
export function maskSecretCredentials(
  schema: IntegrationCredentialsSchema | undefined,
  values: Record<string, unknown>,
): MaskSecretCredentialsResult {
  const credentials: Record<string, unknown> = { ...values }
  const secretFieldsConfigured: Record<string, boolean> = {}

  for (const field of schema?.fields ?? []) {
    if (field.type === 'url') {
      credentials[field.key] = redactUrlUserinfo(credentials[field.key])
      continue
    }
    if (!isSecretField(field.type)) continue
    const configured = hasPresentValue(credentials[field.key])
    secretFieldsConfigured[field.key] = configured
    if (configured) {
      credentials[field.key] = MASKED_SECRET_VALUE
    } else {
      delete credentials[field.key]
    }
  }

  return { credentials, secretFieldsConfigured }
}

/**
 * Reverse of {@link maskSecretCredentials} for the save path. When the client
 * submits the mask sentinel for a secret field it means "leave it unchanged":
 * restore the existing stored secret, or drop the field entirely when nothing
 * was previously stored (so the literal sentinel is never persisted). Any other
 * value (including an empty string, which clears the secret) is written as-is.
 */
export function mergeMaskedSecretCredentials(
  schema: IntegrationCredentialsSchema | undefined,
  incoming: Record<string, unknown>,
  existing: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...incoming }

  for (const field of schema?.fields ?? []) {
    if (!isSecretField(field.type)) continue
    if (merged[field.key] !== MASKED_SECRET_VALUE) continue

    if (hasPresentValue(existing[field.key])) {
      merged[field.key] = existing[field.key]
    } else {
      delete merged[field.key]
    }
  }

  return merged
}
