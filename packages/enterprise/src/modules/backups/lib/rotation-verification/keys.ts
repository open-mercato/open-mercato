import { timingSafeEqual } from 'node:crypto'
import type { KmsService, TenantDek } from '@open-mercato/shared/lib/encryption/kms'
import type { RotationKeyProviders } from '@open-mercato/shared/lib/encryption/rotationProtection'

export type ExplicitKeyProvider = { identity: string; service: KmsService }
export type PinnedRotationProviders = RotationKeyProviders & { provider: string; refresh(): Promise<void> }

function keyBytes(key: string): Buffer {
  const bytes = Buffer.from(key, 'base64')
  if (bytes.length !== 32 || bytes.toString('base64') !== key) throw new Error('[internal] ROTATION_KEY_UNAVAILABLE')
  return bytes
}

async function readKey(provider: ExplicitKeyProvider, tenantId: string): Promise<TenantDek> {
  provider.service.invalidateDek?.(tenantId)
  if (!provider.service.isHealthy()) throw new Error('[internal] ROTATION_KEY_UNAVAILABLE')
  const dek = await provider.service.getTenantDek(tenantId)
  if (!dek || dek.tenantId !== tenantId) throw new Error('[internal] ROTATION_KEY_UNAVAILABLE')
  keyBytes(dek.key)
  return { ...dek }
}

function pinnedService(entries: Map<string, TenantDek>): KmsService {
  return {
    isHealthy: () => entries.size > 0,
    async getTenantDek(tenantId) {
      const key = entries.get(tenantId)
      if (!key) throw new Error('[internal] ROTATION_COVERAGE_UNSUPPORTED')
      return { ...key }
    },
    async createTenantDek() { throw new Error('[internal] ROTATION_KEY_PROVISIONING_FORBIDDEN') },
    invalidateDek() {},
  }
}

export async function pinRotationProviders(
  tenantIds: string[], source: ExplicitKeyProvider, target: ExplicitKeyProvider,
): Promise<PinnedRotationProviders> {
  if (!tenantIds.length || tenantIds.length > 10000 || !source.identity || !target.identity) throw new Error('[internal] ROTATION_COVERAGE_UNSUPPORTED')
  const sourceIdentity = source.identity; const targetIdentity = target.identity
  const sourceKeys = new Map<string, TenantDek>(); const targetKeys = new Map<string, TenantDek>()
  for (const tenantId of [...new Set(tenantIds)].sort()) {
    const old = await readKey(source, tenantId); const next = await readKey(target, tenantId)
    if (timingSafeEqual(keyBytes(old.key), keyBytes(next.key))) throw new Error('[internal] ROTATION_UNCHANGED_KEY')
    sourceKeys.set(tenantId, old); targetKeys.set(tenantId, next)
  }
  return {
    provider: JSON.stringify([source.identity, target.identity]),
    kms: pinnedService(targetKeys), previousKms: pinnedService(sourceKeys),
    async refresh() {
      if (source.identity !== sourceIdentity || target.identity !== targetIdentity) throw new Error('[internal] ROTATION_PROVIDER_CHANGED')
      for (const [tenantId, baseline] of sourceKeys) {
        const old = await readKey(source, tenantId); const next = await readKey(target, tenantId)
        if (!timingSafeEqual(keyBytes(old.key), keyBytes(baseline.key)) || !timingSafeEqual(keyBytes(next.key), keyBytes(targetKeys.get(tenantId)!.key))) throw new Error('[internal] ROTATION_KEY_CHANGED')
      }
    },
  }
}
