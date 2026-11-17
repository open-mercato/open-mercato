import { generateDek } from '@open-mercato/shared/lib/encryption/aes'
import type { KmsService, TenantDek } from '@open-mercato/shared/lib/encryption/kms'

export function createInMemoryKms(): KmsService {
  const deks = new Map<string, string>()
  return {
    isHealthy: () => true,
    async getTenantDek(tenantId: string): Promise<TenantDek | null> {
      const key = deks.get(tenantId)
      return key ? { tenantId, key, fetchedAt: Date.now() } : null
    },
    async createTenantDek(tenantId: string): Promise<TenantDek | null> {
      const key = deks.get(tenantId) ?? generateDek()
      deks.set(tenantId, key)
      return { tenantId, key, fetchedAt: Date.now() }
    },
  }
}
