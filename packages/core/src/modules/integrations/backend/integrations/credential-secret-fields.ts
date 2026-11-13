import type { IntegrationCredentialField } from '@open-mercato/shared/modules/integrations/types'
import { SECRET_CREDENTIAL_FIELD_TYPES } from '../../lib/credentials-masking'

export type SecretFieldsConfigured = Record<string, boolean>

export type CredentialSavePayload = {
  credentials: Record<string, unknown>
  unchangedSecretFields?: string[]
}

export function buildCredentialEditValues(
  credentials: Record<string, unknown>,
  secretFieldsConfigured: SecretFieldsConfigured,
): Record<string, unknown> {
  const editValues = { ...credentials }

  for (const [fieldKey, configured] of Object.entries(secretFieldsConfigured)) {
    if (configured) delete editValues[fieldKey]
  }

  return editValues
}

export function buildCredentialSavePayload(
  values: Record<string, unknown>,
  fields: readonly IntegrationCredentialField[],
  secretFieldsConfigured: SecretFieldsConfigured,
  deliberatelyClearedSecretFields: ReadonlySet<string> = new Set(),
): CredentialSavePayload {
  const credentials = { ...values }
  const unchangedSecretFields = new Set<string>()

  for (const field of fields) {
    if (!SECRET_CREDENTIAL_FIELD_TYPES.has(field.type)) continue

    if (deliberatelyClearedSecretFields.has(field.key)) {
      delete credentials[field.key]
      continue
    }

    if (!secretFieldsConfigured[field.key]) continue
    const value = credentials[field.key]
    if (value !== undefined && value !== '') continue

    delete credentials[field.key]
    unchangedSecretFields.add(field.key)
  }

  return unchangedSecretFields.size > 0
    ? { credentials, unchangedSecretFields: [...unchangedSecretFields] }
    : { credentials }
}

export function buildIntegrationCredentialSavePayload(
  integrationId: string,
  values: Record<string, unknown>,
  fields: readonly IntegrationCredentialField[],
  secretFieldsConfigured: SecretFieldsConfigured,
): CredentialSavePayload {
  const normalizedValues = { ...values }
  const deliberatelyClearedSecretFields = new Set<string>()

  if (integrationId === 'storage_s3') {
    const authMode = normalizedValues.authMode
    if (authMode !== 'access_keys' && authMode !== 'ambient') {
      const hasKeys = Boolean(normalizedValues.accessKeyId || normalizedValues.secretAccessKey)
      normalizedValues.authMode = hasKeys ? 'access_keys' : 'ambient'
    }
    if (normalizedValues.authMode === 'ambient') {
      delete normalizedValues.accessKeyId
      delete normalizedValues.secretAccessKey
      delete normalizedValues.sessionToken
      deliberatelyClearedSecretFields.add('secretAccessKey')
      deliberatelyClearedSecretFields.add('sessionToken')
    }
  }

  return buildCredentialSavePayload(
    normalizedValues,
    fields,
    secretFieldsConfigured,
    deliberatelyClearedSecretFields,
  )
}
