/**
 * App-level bootstrap file
 *
 * This file imports all generated registries and calls the registration
 * functions from each package. This must be called before any package
 * code executes to ensure all dependencies are properly initialized.
 *
 * REGISTRATION ORDER MATTERS:
 *
 * 1. Foundation (ORM entities, DI registrars)
 *    - registerOrmEntities: Required by database layer
 *    - registerDiRegistrars: Required by dependency injection container
 *
 * 2. Modules registry (registerModules, registerCliModules)
 *    - Required by: i18n translations, query engine, dashboards, CLI
 *    - Both use the same modules array
 *
 * 3. Entity IDs (registerEntityIds)
 *    - Required by: encryption layer, query indexing, entity link resolution
 *
 * 4. UI Widgets (registerDashboardWidgets, registerInjectionWidgets, etc.)
 *    - Required by: dashboard rendering, widget injection system
 *    - Can be registered after modules since they use module data
 */

// Generated imports
import { modules } from '@/generated/modules.generated'
import { entities } from '@/generated/entities.generated'
import { diRegistrars } from '@/generated/di.generated'
import { E } from '@/generated/entities.ids.generated'
import { dashboardWidgetEntries } from '@/generated/dashboard-widgets.generated'
import { injectionWidgetEntries } from '@/generated/injection-widgets.generated'
import { injectionTables } from '@/generated/injection-tables.generated'

// Registration functions from packages/shared
import { registerOrmEntities } from '@open-mercato/shared/lib/db/mikro'
import { registerDiRegistrars } from '@open-mercato/shared/lib/di/container'
import { registerModules } from '@open-mercato/shared/lib/i18n/server'
import { registerEntityIds } from '@open-mercato/shared/lib/encryption/entityIds'

// Registration functions from packages/ui
import { registerDashboardWidgets } from '@open-mercato/ui/backend/dashboard/widgetRegistry'
import { registerInjectionWidgets } from '@open-mercato/ui/backend/injection/widgetRegistry'

// Registration functions from packages/core
import {
  registerCoreInjectionWidgets,
  registerCoreInjectionTables,
} from '@open-mercato/core/modules/widgets/lib/injection'

// Registration functions from packages/cli
import { registerCliModules } from '@open-mercato/cli/mercato'

let _bootstrapped = false

export function bootstrap() {
  // In development, always re-run registrations to handle HMR
  // (Module state may be reset when Turbopack reloads packages)
  if (_bootstrapped && process.env.NODE_ENV !== 'development') return
  _bootstrapped = true

  // === 1. Foundation: ORM entities and DI registrars ===
  registerOrmEntities(entities)
  registerDiRegistrars(diRegistrars.filter((r): r is NonNullable<typeof r> => r != null))

  // === 2. Modules registry (required by i18n, query engine, dashboards, CLI) ===
  registerModules(modules)
  registerCliModules(modules)

  // === 3. Entity IDs (required by encryption, indexing, entity links) ===
  registerEntityIds(E)

  // === 4. UI Widgets ===
  registerDashboardWidgets(dashboardWidgetEntries)
  registerInjectionWidgets(injectionWidgetEntries)
  registerCoreInjectionWidgets(injectionWidgetEntries)
  registerCoreInjectionTables(injectionTables)

}

export function isBootstrapped(): boolean {
  return _bootstrapped
}
