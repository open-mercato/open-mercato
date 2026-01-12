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
})

export { isBootstrapped }
