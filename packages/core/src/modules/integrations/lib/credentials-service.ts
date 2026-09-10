import type { EntityManager } from '@mikro-orm/postgresql'
import { decryptWithAesGcm, encryptWithAesGcm } from '@open-mercato/shared/lib/encryption/aes'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createKmsService, resolveEncryptionMode } from '@open-mercato/shared/lib/encryption/kms'
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

/**
 * Raised when integration credentials cannot be encrypted or decrypted because
 * no tenant DEK is available — typically a production deployment with neither
 * Vault nor `TENANT_DATA_ENCRYPTION_FALLBACK_KEY` (or equivalent env vars)
 * configured. The credentials path deliberately fails closed instead of using
 * a hardcoded fallback secret; see security tracker finding #7.
 */
export type CredentialsEncryptionUnavailableReason = 'no-dek' | 'sealed-while-disabled'

const CREDENTIALS_ENCRYPTION_REMEDY: Record<CredentialsEncryptionUnavailableReason, string> = {
  'no-dek':
    'no tenant DEK is available. Configure Vault (VAULT_ADDR/VAULT_TOKEN) or ' +
    'set TENANT_DATA_ENCRYPTION_FALLBACK_KEY in the environment.',
  'sealed-while-disabled':
    'they were sealed while TENANT_DATA_ENCRYPTION was on and it is now off, so no key can open ' +
    'them. Re-enable TENANT_DATA_ENCRYPTION, or run `mercato entities decrypt-database` before ' +
    'disabling it.',
}

export class CredentialsEncryptionUnavailableError extends Error {
  readonly code = 'CREDENTIALS_ENCRYPTION_UNAVAILABLE'
  readonly reason: CredentialsEncryptionUnavailableReason
  constructor(tenantId: string, reason: CredentialsEncryptionUnavailableReason = 'no-dek') {
    super(
      `Cannot encrypt or decrypt integration credentials for tenant ${tenantId}: ` +
        CREDENTIALS_ENCRYPTION_REMEDY[reason],
    )
    this.name = 'CredentialsEncryptionUnavailableError'
    this.reason = reason
  }
}

export function isCredentialsEncryptionUnavailableError(error: unknown): error is CredentialsEncryptionUnavailableError {
  return error instanceof CredentialsEncryptionUnavailableError
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function normalizeCredentialsRecord(value: unknown): Record<string, unknown> {
  if (isRecordValue(value)) return value
  if (typeof value !== 'string') return {}

  const parsed = parseDecryptedFieldValue(value)
  return isRecordValue(parsed) ? parsed : {}
}

/**
 * Build the where-filter for credential lookups.
 *
 * Per-user scoping (added 2026-05-26): when `scope.userId` is set, the filter
 * matches the row owned by that user — different users on the same tenant get
 * their OWN row for the same provider. When `scope.userId` is `undefined` /
 * `null`, the filter matches tenant-wide credentials (existing behaviour,
 * e.g. shared Stripe/Akeneo API keys).
 *
 * The partial unique index `integration_credentials_user_lookup_idx` enforces
 * uniqueness across `(integration_id, organization_id, tenant_id, user_id)`
 * when `user_id IS NOT NULL`.
 */
export function buildCredentialsFilter(integrationId: string, scope: IntegrationScope) {
  const base = {
    integrationId,
    organizationId: scope.organizationId,
    tenantId: scope.tenantId,
    deletedAt: null,
  } as Record<string, unknown>
  if (scope.userId) {
    base.userId = scope.userId
  } else {
    base.userId = null
  }
  return base
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

  /**
   * Resolve the DEK this tenant's credentials blob is sealed with, or `null` when the operator
   * has switched tenant data encryption off.
   *
   * The `null` is the whole point of going through {@link resolveEncryptionMode} rather than
   * asking the KMS directly. Under `TENANT_DATA_ENCRYPTION=no` the KMS is a noop and hands back
   * nothing, which is indistinguishable — to `getTenantDek` alone — from Vault being down. Those
   * two need opposite answers: an operator who turned encryption off expects plaintext, whereas a
   * Vault outage must not silently downgrade a secret that is supposed to be sealed. So only
   * `unavailable` throws.
   */
  async function resolveCredentialsDek(scope: IntegrationScope): Promise<string | null> {
    const kms = createKmsService()
    if (resolveEncryptionMode(kms) === 'disabled') return null

    const existing = await kms.getTenantDek(scope.tenantId)
    if (existing?.key) return existing.key

    const created = await kms.createTenantDek(scope.tenantId)
    if (created?.key) return created.key

    throw new CredentialsEncryptionUnavailableError(scope.tenantId)
  }

  async function encryptCredentialsBlob(
    credentials: Record<string, unknown>,
    scope: IntegrationScope,
  ): Promise<Record<string, unknown>> {
    const dek = await resolveCredentialsDek(scope)
    if (!dek) return credentials
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

    // A sealed blob written before encryption was switched off. There is no key to open it with,
    // and returning the envelope as if it were the credentials would hand an adapter a garbage
    // secret, so this stays an error even in `disabled` mode -- the remedy is
    // `mercato entities decrypt-database`, not a silent empty credential set.
    const dek = await resolveCredentialsDek(scope)
    if (!dek) throw new CredentialsEncryptionUnavailableError(scope.tenantId, 'sealed-while-disabled')

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
      let row = await findOneWithDecryption(
        em,
        IntegrationCredentials,
        buildCredentialsFilter(integrationId, scope),
        undefined,
        scope,
      )
      // Spec 2026-05-21 (email-integration-foundation) "Hub credentials store":
      // per-user secrets resolve as `WHERE user_id = currentUser.id OR user_id IS NULL`.
      // A user-scoped read of a TENANT-WIDE integration (sync_excel, Stripe, Akeneo,
      // S3, the channel OAuth *client* config) MUST still find the shared
      // `user_id = NULL` row — the per-user row takes precedence, and we only fall
      // back to the tenant-wide row when the user has none of their own. Writes stay
      // strict (`save` uses the unmodified filter) so a per-user save never clobbers
      // the shared credential.
      if (!row && scope.userId) {
        row = await findOneWithDecryption(
          em,
          IntegrationCredentials,
          buildCredentialsFilter(integrationId, { ...scope, userId: null }),
          undefined,
          scope,
        )
      }
      if (!row) return null
      return decryptCredentialsBlob(row.credentials, scope)
    },

    async getRowUpdatedAt(integrationId: string, scope: IntegrationScope): Promise<Date | null> {
      let row = await findOneWithDecryption(
        em,
        IntegrationCredentials,
        buildCredentialsFilter(integrationId, scope),
        undefined,
        scope,
      )
      if (!row && scope.userId) {
        row = await findOneWithDecryption(
          em,
          IntegrationCredentials,
          buildCredentialsFilter(integrationId, { ...scope, userId: null }),
          undefined,
          scope,
        )
      }
      return row?.updatedAt ?? null
    },

    /**
     * Resolve the persisted `updated_at` version for the credentials a caller
     * would read via {@link resolve} (direct row first, then the bundle
     * fallthrough). Returns `null` when no credentials row exists yet — the
     * optimistic-lock guard treats a missing current version as "no conflict".
     */
    async resolveUpdatedAt(integrationId: string, scope: IntegrationScope): Promise<Date | null> {
      const direct = await this.getRowUpdatedAt(integrationId, scope)
      if (direct) return direct

      const definition = getIntegration(integrationId)
      if (!definition?.bundleId) return null
      return this.getRowUpdatedAt(definition.bundleId, scope)
    },

    async resolve(integrationId: string, scope: IntegrationScope): Promise<Record<string, unknown> | null> {
      const direct = await this.getRaw(integrationId, scope)
      if (direct) return direct

      const definition = getIntegration(integrationId)
      if (!definition?.bundleId) return null
      return this.getRaw(definition.bundleId, scope)
    },

    async save(integrationId: string, credentials: Record<string, unknown>, scope: IntegrationScope): Promise<void> {
      const encryptedCredentials = await encryptCredentialsBlob(credentials, scope)
      await ensureCredentialsEncryptionMap(scope)

      const row = await findOneWithDecryption(
        em,
        IntegrationCredentials,
        buildCredentialsFilter(integrationId, scope),
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
        ...(scope.userId ? { userId: scope.userId } : {}),
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
