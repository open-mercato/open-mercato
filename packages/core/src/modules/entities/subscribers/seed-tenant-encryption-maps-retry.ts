import type { ResolverContext } from './seed-organization-encryption-maps'
import seedTenantEncryptionMaps from './seed-tenant-encryption-maps'

export const metadata = {
  event: 'directory.tenant.created',
  persistent: true,
  id: 'entities:seed-tenant-encryption-maps-retry',
}

export default function retryHandle(payload: unknown, ctx: ResolverContext): Promise<void> {
  return seedTenantEncryptionMaps(payload, ctx)
}
