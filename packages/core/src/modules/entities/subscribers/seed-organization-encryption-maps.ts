// Organizations created after `mercato init` get no `encryption_maps` row today — only the
// init organization is seeded (packages/cli/src/mercato.ts `seed-encryption`, auth's
// `setupInitialTenant`). Without a map, `TenantDataEncryptionService` finds no active scope
// and silently writes the organization's mapped fields as plaintext. Seed the same default
// maps the init organization gets whenever a new organization is created.
//
// `persistent: false` so this runs INLINE as part of the `directory.organizations.create`
// request (ephemeral subscribers always run inline, even on a persistent emit — see
// packages/events/AGENTS.md § Persistent delivery: single-delivery). A `persistent: true`
// subscriber here would only run in the events worker under single-delivery (the default),
// so every record written to the new organization before the worker drains the job would be
// plaintext forever (#7591's bug, reproduced one layer deeper). The sibling
// `seed-organization-encryption-maps-retry.ts` subscriber is the idempotent, worker-dispatched
// backstop for when this inline run throws — inline handler errors are logged and swallowed,
// with no retry of their own (see the same AGENTS.md section).

import type { EntityManager } from '@mikro-orm/postgresql'
import { isTenantDataEncryptionEnabled } from '@open-mercato/shared/lib/encryption/toggles'
import type { TenantDataEncryptionService } from '@open-mercato/shared/lib/encryption/tenantDataEncryptionService'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'
import { getModules } from '@open-mercato/shared/lib/modules/registry'
import { upsertEncryptionMaps, invalidateEncryptionMapScopes } from '@open-mercato/core/modules/entities/lib/encryption-maps'

const logger = createLogger('entities')

export const metadata = {
  event: 'directory.organization.created',
  persistent: false,
  id: 'entities:seed-organization-encryption-maps',
}

export type ResolverContext = {
  resolve: <T = unknown>(name: string) => T
}

export default async function handle(payload: unknown, ctx: ResolverContext): Promise<void> {
  if (!isTenantDataEncryptionEnabled()) return

  const data = (payload ?? {}) as Record<string, unknown>
  const tenantId = typeof data.tenantId === 'string' ? data.tenantId : null
  const organizationId = typeof data.organizationId === 'string' ? data.organizationId : null
  if (!tenantId || !organizationId) return

  const em = ctx.resolve<EntityManager>('em').fork()
  await upsertEncryptionMaps(em, tenantId, organizationId, getModules(), () => {}, async (scope) => {
    try {
      const encryptionService = ctx.resolve<Pick<TenantDataEncryptionService, 'invalidateMap'>>('tenantEncryptionService')
      await invalidateEncryptionMapScopes(encryptionService, [scope])
    } catch (err) {
      logger.warn('Encryption maps seeded but cache invalidation failed', { tenantId, organizationId, err })
      getTelemetryRuntime()?.reportError(err, {
        module: 'entities',
        code: 'entities.organization_encryption_map_invalidation_failed',
        attributes: { tenantId, organizationId },
      })
    }
  })
}
