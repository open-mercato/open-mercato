import type { ModuleConfigService } from '@open-mercato/core/modules/configs/lib/module-config-service'

/**
 * Tenant-scoped opt-in for the `sales.order.created` MTO subscriber (spec §
 * Sales integration — soft coupling). OFF by default: a tenant must
 * explicitly turn this on before the subscriber drafts any production order
 * on their behalf. Uses the platform `ModuleConfigService` (same mechanism
 * as `notifications`' delivery config) rather than a bespoke settings table.
 */
export const MTO_AUTO_DRAFT_CONFIG_KEY = 'mto_auto_draft'

type Resolver = {
  resolve: <T = unknown>(name: string) => T
}

/**
 * Resolves the opt-in for a tenant. Defensive by design: a missing/broken
 * `moduleConfigService` (module absent, DI misconfiguration) resolves to
 * `false` rather than throwing — the subscriber must degrade to a no-op,
 * never crash the event pipeline.
 */
export async function isMtoAutoDraftEnabled(resolver: Resolver, tenantId: string | null | undefined): Promise<boolean> {
  if (!tenantId) return false
  try {
    const service = resolver.resolve<ModuleConfigService>('moduleConfigService')
    const value = await service.getValue<boolean>('production', MTO_AUTO_DRAFT_CONFIG_KEY, {
      defaultValue: false,
      scope: { tenantId },
    })
    return value === true
  } catch {
    return false
  }
}
