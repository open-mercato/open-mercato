/**
 * App-level bootstrap file
 *
 * This thin wrapper imports generated files and passes them to the
 * shared bootstrap factory. The actual bootstrap logic lives in
 * @open-mercato/shared/lib/bootstrap.
 *
 * This file is imported by layout.tsx and API routes to initialize
 * the application before any package code executes.
 */

// Register app dictionary loader before bootstrap (required for i18n in standalone packages)
import { registerAppDictionaryLoader } from '@open-mercato/shared/lib/i18n/server'
import type { Locale } from '@open-mercato/shared/lib/i18n/config'

registerAppDictionaryLoader(async (locale: Locale): Promise<Record<string, unknown>> => {
  switch (locale) {
    case 'en':
      return import('./i18n/en.json').then((m) => m.default)
    case 'pl':
      return import('./i18n/pl.json').then((m) => m.default)
    case 'es':
      return import('./i18n/es.json').then((m) => m.default)
    case 'de':
      return import('./i18n/de.json').then((m) => m.default)
    default:
      return import('./i18n/en.json').then((m) => m.default)
  }
})

// Generated imports (static - works with bundlers)
import { modules } from '@/.mercato/generated/modules.generated'
import { entities } from '@/.mercato/generated/entities.generated'
import { diRegistrars } from '@/.mercato/generated/di.generated'
import { E } from '@/.mercato/generated/entities.ids.generated'
import { entityFieldsRegistry } from '@/.mercato/generated/entity-fields-registry'
import { dashboardWidgetEntries } from '@/.mercato/generated/dashboard-widgets.generated'
import { injectionWidgetEntries } from '@/.mercato/generated/injection-widgets.generated'
import { injectionTables } from '@/.mercato/generated/injection-tables.generated'
import { searchModuleConfigs } from '@/.mercato/generated/search.generated'
import { analyticsModuleConfigs } from '@/.mercato/generated/analytics.generated'

// Bootstrap factory from shared package
import { createBootstrap, isBootstrapped } from '@open-mercato/shared/lib/bootstrap'

// Create bootstrap function with app's generated data
export const bootstrap = createBootstrap({
  modules,
  entities,
  diRegistrars,
  entityIds: E,
  entityFieldsRegistry,
  dashboardWidgetEntries,
  injectionWidgetEntries,
  injectionTables,
  searchModuleConfigs,
  analyticsModuleConfigs,
})

export { isBootstrapped }
