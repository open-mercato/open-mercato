import type { EntityManager } from '@mikro-orm/postgresql'
import { isTenantDataEncryptionEnabled } from '@open-mercato/shared/lib/encryption/toggles'
import type { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { getModules } from '@open-mercato/shared/lib/modules/registry'
import { upsertEncryptionMaps, invalidateEncryptionMapScopes } from '@open-mercato/core/modules/entities/lib/encryption-maps'
import type { ResolverContext } from './seed-organization-encryption-maps'

const logger = createLogger('entities')

export const metadata = {
  event: 'directory.tenant.created',
  persistent: false,
  id: 'entities:seed-tenant-encryption-maps',
}

export default async function handle(payload: unknown, ctx: ResolverContext): Promise<void> {
  if (!isTenantDataEncryptionEnabled()) return
  if (!payload || typeof payload !== 'object' || !('id' in payload)) return
  const tenantId = typeof payload.id === 'string' ? payload.id : null
  if (!tenantId) return

  const em = ctx.resolve<EntityManager>('em').fork()
  await upsertEncryptionMaps(em, tenantId, null, getModules(), () => {}, async (scope) => {
    try {
      const encryptionService = ctx.resolve<Pick<TenantDataEncryptionService, 'invalidateMap'>>('tenantEncryptionService')
      await invalidateEncryptionMapScopes(encryptionService, [scope])
    } catch (err) {
      logger.warn('Tenant encryption maps seeded but cache invalidation failed', { tenantId, err })
      getTelemetryRuntime()?.reportError(err, {
        module: 'entities',
        code: 'entities.tenant_encryption_map_invalidation_failed',
        attributes: { tenantId },
      })
    }
  })
}
