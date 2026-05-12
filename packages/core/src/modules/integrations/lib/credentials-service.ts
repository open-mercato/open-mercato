import crypto from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { decryptWithAesGcm, encryptWithAesGcm } from '@open-mercato/shared/lib/encryption/aes'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createKmsService } from '@open-mercato/shared/lib/encryption/kms'
import { parseDecryptedFieldValue } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import {
  getBundle,
  getIntegration,
  resolveIntegrationCredentialsSchema,
  type IntegrationScope,
} from '@open-mercato/shared/modules/integrations/types'
import { EncryptionMap } from '../../entities/data/entities'
import { IntegrationCredentials } from '../data/entities'

const ENCRYPTED_CREDENTIALS_BLOB_KEY = '__om_encrypted_credentials_blob_v1'
const DERIVED_KEY_CONTEXT = 'integrations.credentials'

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function normalizeCredentialsRecord(value: unknown): Record<string, unknown> {
  if (isRecordValue(value)) return value
  if (typeof value !== 'string') return {}

  const parsed = parseDecryptedFieldValue(value)
  return isRecordValue(parsed) ? parsed : {}
}

function resolveFallbackEncryptionSecret(): string {
  const candidates = [
    process.env.TENANT_DATA_ENCRYPTION_FALLBACK_KEY,
    process.env.TENANT_DATA_ENCRYPTION_KEY,
    process.env.AUTH_SECRET,
    process.env.NEXTAUTH_SECRET,
  ]

  for (const value of candidates) {
    const normalized = value?.trim()
    if (normalized) return normalized
  }

  if (process.env.NODE_ENV !== 'production') return 'om-dev-tenant-encryption'

  console.warn(
    '[integrations.credentials] No encryption secret configured; using emergency fallback secret. Configure TENANT_DATA_ENCRYPTION_FALLBACK_KEY immediately.',
  )
  return 'om-emergency-fallback-rotate-me'
}

function deriveDekFromSecret(secret: string, tenantId: string): string {
  return crypto
    .createHash('sha256')
    .update(`${DERIVED_KEY_CONTEXT}:${tenantId}:${secret}`)
    .digest()
    .toString('base64')
}

export function createCredentialsService(em: EntityManager) {
  const credentialsEncryptionSpec = [{ field: 'credentials' }]

  async function ensureCredentialsEncryptionMap(scope: IntegrationScope): Promise<void> {
    const existing = await findOneWithDecryption(
      em,
      EncryptionMap,
      {
        entityId: 'integrations:integration_credentials',
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        deletedAt: null,
      },
      undefined,
      scope,
    )

    if (!existing) {
      const created = em.create(EncryptionMap, {
        entityId: 'integrations:integration_credentials',
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        fieldsJson: credentialsEncryptionSpec,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      em.persist(created)
      return
    }

    existing.fieldsJson = credentialsEncryptionSpec
    existing.isActive = true
  }

  async function resolveCredentialsDek(scope: IntegrationScope): Promise<string> {
    const kms = createKmsService()
    const existing = await kms.getTenantDek(scope.tenantId)
    if (existing?.key) return existing.key

    const created = await kms.createTenantDek(scope.tenantId)
    if (created?.key) return created.key

    return deriveDekFromSecret(resolveFallbackEncryptionSecret(), scope.tenantId)
  }

  async function encryptCredentialsBlob(
    credentials: Record<string, unknown>,
    scope: IntegrationScope,
  ): Promise<Record<string, unknown>> {
    const dek = await resolveCredentialsDek(scope)
    const payload = encryptWithAesGcm(JSON.stringify(credentials), dek)
    return { [ENCRYPTED_CREDENTIALS_BLOB_KEY]: payload.value }
  }

  async function decryptCredentialsBlob(
    credentialsInput: unknown,
    scope: IntegrationScope,
  ): Promise<Record<string, unknown>> {
    const credentials = normalizeCredentialsRecord(credentialsInput)
    const encrypted = credentials[ENCRYPTED_CREDENTIALS_BLOB_KEY]
    if (typeof encrypted !== 'string' || !encrypted) return credentials

    const dek = await resolveCredentialsDek(scope)
    const decryptedRaw = decryptWithAesGcm(encrypted, dek)
    if (!decryptedRaw) return {}

    try {
      const parsed = JSON.parse(decryptedRaw) as unknown
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {}
    } catch {
      return {}
    }
  }

  return {
    async getRaw(integrationId: string, scope: IntegrationScope): Promise<Record<string, unknown> | null> {
      const row = await findOneWithDecryption(
        em,
        IntegrationCredentials,
        {
          integrationId,
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          deletedAt: null,
        },
        undefined,
        scope,
      )
      if (!row) return null
      return decryptCredentialsBlob(row.credentials, scope)
    },

    async resolve(integrationId: string, scope: IntegrationScope): Promise<Record<string, unknown> | null> {
      const direct = await this.getRaw(integrationId, scope)
      if (direct) return direct

      const definition = getIntegration(integrationId)
      if (!definition?.bundleId) return null
      return this.getRaw(definition.bundleId, scope)
    },

    async save(integrationId: string, credentials: Record<string, unknown>, scope: IntegrationScope): Promise<void> {
      await ensureCredentialsEncryptionMap(scope)
      const encryptedCredentials = await encryptCredentialsBlob(credentials, scope)

      const row = await findOneWithDecryption(
        em,
        IntegrationCredentials,
        {
          integrationId,
          organizationId: scope.organizationId,
          tenantId: scope.tenantId,
          deletedAt: null,
        },
        undefined,
        scope,
      )

      if (row) {
        row.credentials = encryptedCredentials
        await em.flush()
        return
      }

      const created = em.create(IntegrationCredentials, {
        integrationId,
        credentials: encryptedCredentials,
        organizationId: scope.organizationId,
        tenantId: scope.tenantId,
      })
      await em.persist(created).flush()
    },

    async saveField(
      integrationId: string,
      fieldKey: string,
      value: unknown,
      scope: IntegrationScope,
    ): Promise<Record<string, unknown>> {
      const current = (await this.getRaw(integrationId, scope)) ?? {}
      const updated = { ...current, [fieldKey]: value }
      await this.save(integrationId, updated, scope)
      return updated
    },

    getSchema(integrationId: string) {
      const definition = getIntegration(integrationId)
      if (!definition) return undefined

      if (definition.bundleId) {
        const bundle = getBundle(definition.bundleId)
        return bundle?.credentials ?? resolveIntegrationCredentialsSchema(integrationId)
      }

      return definition.credentials ?? resolveIntegrationCredentialsSchema(integrationId)
    },
  }
}

export type CredentialsService = ReturnType<typeof createCredentialsService>
