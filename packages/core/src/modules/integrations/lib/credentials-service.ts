import type { EntityManager } from '@mikro-orm/postgresql'
import { decryptWithAesGcm, encryptWithAesGcm, isEncryptedPayloadShape } from '@open-mercato/shared/lib/encryption/aes'
import { resolveTenantEncryptionService } from '@open-mercato/shared/lib/encryption/customFieldValues'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createKmsService, resolveEncryptionMode, type KmsService } from '@open-mercato/shared/lib/encryption/kms'
import {
  parseDecryptedFieldValue,
  type TenantDataEncryptionService,
} from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import {
  getBundle,
  getIntegration,
  resolveIntegrationCredentialsSchema,
  type IntegrationScope,
} from '@open-mercato/shared/modules/integrations/types'
import { upsertCanonicalEncryptionMap } from '../../entities/lib/encryption-maps'
import { IntegrationCredentials } from '../data/entities'
import { OAUTH_GRANT_ROW_SUFFIX } from './oauth/grant-blob'

const ENCRYPTED_CREDENTIALS_BLOB_KEY = '__om_encrypted_credentials_blob_v1'
const CREDENTIALS_ENCRYPTION_ENTITY_ID = 'integrations:integration_credentials'
const CREDENTIALS_ENCRYPTION_FIELDS = [{ field: 'credentials' }]

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
    'them. Re-enable TENANT_DATA_ENCRYPTION to read them again, or re-enter the credentials — ' +
    'saving them while the toggle is off stores them in the clear. Note that ' +
    '`mercato entities decrypt-database` does not reach this blob: it decrypts the columns an ' +
    'encryption map covers, and this envelope sits inside the decrypted value.',
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

/**
 * The one unavailable-reason an operator can act on without restoring a key: the blob predates
 * `TENANT_DATA_ENCRYPTION=no` and no key exists to open it, so re-entering the credentials is the
 * only way forward. The admin credentials route degrades to an empty form on this so that the
 * re-entry is possible at all; `no-dek` (encryption on, KMS unreachable) still fails closed.
 */
export function isCredentialsSealedWhileDisabledError(error: unknown): boolean {
  return isCredentialsEncryptionUnavailableError(error) && error.reason === 'sealed-while-disabled'
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

/**
 * @internal True for an id ending in the `__oauth_grant` suffix, which is reserved for OAuth grant
 * rows: no integration or bundle id may end in it.
 */
export function isReservedOAuthGrantId(id: string): boolean {
  return id.endsWith(OAUTH_GRANT_ROW_SUFFIX)
}

/**
 * @internal The bundle whose credentials an integration falls through to, or `null` when it has none
 * or its `bundleId` ends in the reserved `__oauth_grant` suffix, so no child integration reads another
 * owner's OAuth grant row through its bundle.
 */
export function bundleFallthroughId(integrationId: string): string | null {
  const bundleId = getIntegration(integrationId)?.bundleId
  if (!bundleId || isReservedOAuthGrantId(bundleId)) return null
  return bundleId
}

type EncryptionMapCacheInvalidator = Pick<TenantDataEncryptionService, 'invalidateMap'>

export type CredentialsWriteOptions = {
  deferAfterCommit?: (callback: () => void | Promise<void>) => void
  /**
   * @internal `'always'` (default) upserts the scope's credentials encryption map on every write.
   * `'when-not-canonical'` first reads the scope's live exact-scope map with a plain `SELECT` and
   * upserts it, and registers its invalidation, only when it is missing, inactive or differs from
   * the canonical field list, so a write over a canonical map never takes the map row's lock.
   */
  ensureEncryptionMap?: 'always' | 'when-not-canonical'
}

async function isCredentialsEncryptionMapCanonical(em: EntityManager, scope: IntegrationScope): Promise<boolean> {
  const rows = await em.execute<Array<{ id: string }>>(
    `
      select "id"
      from "encryption_maps"
      where "entity_id" = ?
        and "tenant_id" is not distinct from ?
        and "organization_id" is not distinct from ?
        and "deleted_at" is null
        and "is_active" = true
        and "fields_json" = ?::jsonb
      limit 1
    `,
    [
      CREDENTIALS_ENCRYPTION_ENTITY_ID,
      scope.tenantId,
      scope.organizationId,
      JSON.stringify(CREDENTIALS_ENCRYPTION_FIELDS),
    ],
  )
  return rows.length > 0
}

export async function ensureCredentialsEncryptionMap(
  em: EntityManager,
  scope: IntegrationScope,
  encryptionService?: EncryptionMapCacheInvalidator | null,
  options?: CredentialsWriteOptions,
): Promise<void> {
  if (
    options?.ensureEncryptionMap === 'when-not-canonical'
    && await isCredentialsEncryptionMapCanonical(em, scope)
  ) {
    return
  }
  await upsertCanonicalEncryptionMap(em, {
    entityId: CREDENTIALS_ENCRYPTION_ENTITY_ID,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    fields: CREDENTIALS_ENCRYPTION_FIELDS,
    isActive: true,
  })
  const invalidator = encryptionService ?? resolveTenantEncryptionService(em)
  if (!invalidator) return
  const invalidate = () => invalidator.invalidateMap(
    CREDENTIALS_ENCRYPTION_ENTITY_ID, scope.tenantId, scope.organizationId,
  )
  if (options?.deferAfterCommit) options.deferAfterCommit(invalidate)
  else await invalidate()
}

async function resolveTenantDekKey(kms: KmsService, tenantId: string): Promise<string | null> {
  const existing = await kms.getTenantDek(tenantId)
  if (existing?.key) return existing.key
  const created = await kms.createTenantDek(tenantId)
  return created?.key ?? null
}

async function findCredentialRowIdOnly(
  em: EntityManager,
  integrationId: string,
  scope: IntegrationScope,
): Promise<IntegrationCredentials | null> {
  const located = await em.findOne(IntegrationCredentials, buildCredentialsFilter(integrationId, scope), {
    fields: ['id', 'tenantId', 'organizationId'],
  })
  return located ? em.getReference(IntegrationCredentials, located.id) : null
}

/**
 * @internal Erases the strict live row (no bundle or user→tenant fallthrough): sets
 * `credentials = {}` and `deletedAt = now` and flushes on `em`. The row is located by an id-only
 * lookup that loads `id`, `tenantId` and `organizationId`, never `credentials`, so erasure needs
 * no DEK. Returns `false` when no live row exists.
 */
export async function eraseIntegrationCredentials(
  em: EntityManager,
  integrationId: string,
  scope: IntegrationScope,
): Promise<boolean> {
  const row = await findCredentialRowIdOnly(em, integrationId, scope)
  if (!row) return false
  row.credentials = {}
  row.deletedAt = new Date()
  await em.flush()
  return true
}

/** @internal Outcome of {@link readCredentialRowLayered}, one per encryption layer that can fail. */
export type LayeredCredentialRead<T> =
  | { kind: 'none' }
  | { kind: 'field_ciphertext'; rowId: string }
  | { kind: 'no_dek'; rowId: string; reason: CredentialsEncryptionUnavailableReason }
  | { kind: 'envelope_undecryptable'; rowId: string }
  | { kind: 'invalid'; rowId: string; cause: 'parse' | 'schema' }
  | { kind: 'ok'; rowId: string; value: T }

function parseStoredCredentialsRecord(value: unknown): Record<string, unknown> | null {
  if (isRecordValue(value)) return value
  if (typeof value !== 'string') return null
  const parsed = parseDecryptedFieldValue(value)
  return isRecordValue(parsed) ? parsed : null
}

function parseDecryptedCredentialsBlob(decrypted: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(decrypted)
    return isRecordValue(parsed) ? parsed : null
  } catch {
    return null
  }
}

/**
 * @internal Reads the strict live row (no bundle or user→tenant fallthrough) and reports which
 * layer could not be opened instead of degrading to `{}` like `getRaw`: field-level ciphertext the
 * decrypt pass left sealed, a missing DEK for the credentials envelope, an envelope that does not
 * open under that DEK, or a value that is not a JSON object or that `validate` rejects. The
 * envelope DEK comes from `kms` only.
 */
export async function readCredentialRowLayered<T>(
  em: EntityManager,
  integrationId: string,
  scope: IntegrationScope,
  options: { kms: KmsService; validate: (value: Record<string, unknown>) => T | null },
): Promise<LayeredCredentialRead<T>> {
  const row = await findOneWithDecryption(
    em,
    IntegrationCredentials,
    buildCredentialsFilter(integrationId, scope),
    undefined,
    scope,
  )
  if (!row) return { kind: 'none' }
  const rowId = row.id
  const stored: unknown = row.credentials
  if (isEncryptedPayloadShape(stored)) return { kind: 'field_ciphertext', rowId }
  const record = parseStoredCredentialsRecord(stored)
  if (!record) return { kind: 'invalid', rowId, cause: 'parse' }

  const envelope = record[ENCRYPTED_CREDENTIALS_BLOB_KEY]
  let value: Record<string, unknown> = record
  if (typeof envelope === 'string' && envelope) {
    if (resolveEncryptionMode(options.kms) === 'disabled') {
      return { kind: 'no_dek', rowId, reason: 'sealed-while-disabled' }
    }
    const dek = (await options.kms.getTenantDek(scope.tenantId))?.key ?? null
    if (!dek) return { kind: 'no_dek', rowId, reason: 'no-dek' }
    const decrypted = decryptWithAesGcm(envelope, dek)
    if (decrypted === null) return { kind: 'envelope_undecryptable', rowId }
    const opened = parseDecryptedCredentialsBlob(decrypted)
    if (!opened) return { kind: 'invalid', rowId, cause: 'parse' }
    value = opened
  }

  const validated = options.validate(value)
  if (validated === null) return { kind: 'invalid', rowId, cause: 'schema' }
  return { kind: 'ok', rowId, value: validated }
}

/**
 * `encryptionService` is the map invalidator. The third parameter is `@internal` (the OAuth grant
 * service's pinned KMS): its `kms` replaces the per-call `createKmsService()` of the
 * credentials-envelope DEK resolution, for both `save` and `getRaw`.
 */
export function createCredentialsService(
  em: EntityManager,
  encryptionService?: EncryptionMapCacheInvalidator | null,
  options?: { kms?: KmsService },
) {

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
    const kms = options?.kms ?? createKmsService()
    if (resolveEncryptionMode(kms) === 'disabled') return null

    const key = await resolveTenantDekKey(kms, scope.tenantId)
    if (key) return key

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
    // secret, so this stays an error even in `disabled` mode rather than a silent empty credential
    // set. The remedy is re-entering the credentials (see the reason's message); the admin route
    // catches this specific reason so the form can load empty and accept them.
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
     * A `bundleId` ending in the reserved `__oauth_grant` suffix is never followed.
     */
    async resolveUpdatedAt(integrationId: string, scope: IntegrationScope): Promise<Date | null> {
      const direct = await this.getRowUpdatedAt(integrationId, scope)
      if (direct) return direct

      const bundleId = bundleFallthroughId(integrationId)
      if (!bundleId) return null
      return this.getRowUpdatedAt(bundleId, scope)
    },

    /**
     * The integration's own credentials, else its bundle's. A `bundleId` ending in the reserved
     * `__oauth_grant` suffix is never followed.
     */
    async resolve(integrationId: string, scope: IntegrationScope): Promise<Record<string, unknown> | null> {
      const direct = await this.getRaw(integrationId, scope)
      if (direct) return direct

      const bundleId = bundleFallthroughId(integrationId)
      if (!bundleId) return null
      return this.getRaw(bundleId, scope)
    },

    async save(
      integrationId: string,
      credentials: Record<string, unknown>,
      scope: IntegrationScope,
      options?: CredentialsWriteOptions,
    ): Promise<void> {
      const encryptedCredentials = await encryptCredentialsBlob(credentials, scope)
      await ensureCredentialsEncryptionMap(em, scope, encryptionService, options)

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
      options?: CredentialsWriteOptions,
    ): Promise<Record<string, unknown>> {
      const current = (await this.getRaw(integrationId, scope)) ?? {}
      const updated = { ...current, [fieldKey]: value }
      await this.save(integrationId, updated, scope, options)
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
