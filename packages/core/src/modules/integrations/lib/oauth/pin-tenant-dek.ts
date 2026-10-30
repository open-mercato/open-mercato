import { resolveEncryptionMode, type KmsService, type TenantDek } from '@open-mercato/shared/lib/encryption/kms'

/**
 * @internal Outcome of {@link TenantDekPin.resolve}: `disabled` with `TENANT_DATA_ENCRYPTION=no`
 * (nothing is resolved), `pinned` once a key is memoized, `unavailable` when the KMS supplied no key
 * or threw (`error`, without key material).
 */
export type TenantDekPinOutcome =
  | { status: 'pinned' }
  | { status: 'disabled' }
  | { status: 'unavailable'; error: unknown }

/**
 * @internal A `KmsService` that answers every tenant DEK request of one operation with the first key
 * it resolved, so the decrypt and the encrypt under the Grant Lock use the same DEK (App Spec I6).
 */
export type TenantDekPin = KmsService & {
  resolve(tenantId: string): Promise<TenantDekPinOutcome>
}

type PinnedEntry = { dek: TenantDek | null; error: unknown }

/**
 * @internal Wraps one `KmsService` for one operation. `resolve(tenantId)` calls `getTenantDek`, then
 * `createTenantDek` when that returns `null`, and memoizes the first key; `getTenantDek` and
 * `createTenantDek` answer from that memo. After a failed resolution the pin answers `null` with no
 * further KMS call. `kms.isHealthy()` decides nothing: only the encryption toggle is checked first.
 */
export function pinTenantDek(kms: KmsService): TenantDekPin {
  const pinned = new Map<string, Promise<PinnedEntry>>()

  async function fetchTenantDek(tenantId: string): Promise<PinnedEntry> {
    try {
      const existing = await kms.getTenantDek(tenantId)
      if (existing?.key) return { dek: existing, error: null }
      const created = await kms.createTenantDek(tenantId)
      return { dek: created?.key ? created : null, error: null }
    } catch (error) {
      return { dek: null, error }
    }
  }

  function entryFor(tenantId: string): Promise<PinnedEntry> {
    const existing = pinned.get(tenantId)
    if (existing) return existing
    const resolving = fetchTenantDek(tenantId)
    pinned.set(tenantId, resolving)
    return resolving
  }

  async function pinnedDek(tenantId: string): Promise<TenantDek | null> {
    if (resolveEncryptionMode(kms) === 'disabled') return null
    return (await entryFor(tenantId)).dek
  }

  return {
    async resolve(tenantId: string): Promise<TenantDekPinOutcome> {
      if (resolveEncryptionMode(kms) === 'disabled') return { status: 'disabled' }
      const entry = await entryFor(tenantId)
      if (entry.dek) return { status: 'pinned' }
      return { status: 'unavailable', error: entry.error }
    },
    getTenantDek: pinnedDek,
    createTenantDek: pinnedDek,
    isHealthy: () => kms.isHealthy(),
    invalidateDek: (tenantId: string) => kms.invalidateDek?.(tenantId),
  }
}
