import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

/**
 * Integrations module injection table.
 *
 * The external-ids widget auto-appears on entity detail pages via wildcard spot matching.
 * Status badge widgets are registered by individual integration modules (e.g. sync_medusa).
 */
export const injectionTable: ModuleInjectionTable = {
  // External IDs widget appears in detail page sidebars for all entities
  'detail:*:sidebar': {
    widgetId: 'integrations.injection.external-ids',
    priority: -10,
  },
}

export default injectionTable
