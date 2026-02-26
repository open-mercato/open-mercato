import type { BootstrapData, BootstrapOptions } from './types'
import { registerOrmEntities } from '../db/mikro'
import { registerDiRegistrars } from '../di/container'
import { registerModules } from '../modules/registry'
import { registerEntityIds } from '../encryption/entityIds'
import { registerEntityFields } from '../encryption/entityFields'
import { registerSearchModuleConfigs } from '../../modules/search'
import { registerAnalyticsModuleConfigs } from '../../modules/analytics'
import { registerResponseEnrichers } from '../crud/enricher-registry'
import { registerApiInterceptors } from '../crud/interceptor-registry'
import { registerComponentOverrides } from '../../modules/widgets/component-registry'

let _bootstrapped = false

// Store the async registration promise so callers can await it if needed
let _asyncRegistrationPromise: Promise<void> | null = null

/**
 * Creates a bootstrap function that registers all application dependencies.
 *
 * The returned function should be called once at application startup.
 * In development mode, it can be called multiple times (for HMR).
 *
 * @param data - All generated registry data from .mercato/generated/
 * @param options - Optional configuration
 * @returns A bootstrap function to call at app startup
 */
export function createBootstrap(data: BootstrapData, options: BootstrapOptions = {}) {
  return function bootstrap(): void {
    // In development, always re-run registrations to handle HMR
    // (Module state may be reset when Turbopack reloads packages)
    if (_bootstrapped && process.env.NODE_ENV !== 'development') return
    _bootstrapped = true

    // === 1. Foundation: ORM entities and DI registrars ===
    registerOrmEntities(data.entities)
    registerDiRegistrars(data.diRegistrars.filter((r): r is NonNullable<typeof r> => r != null))

    // === 2. Modules registry (required by i18n, query engine, dashboards, CLI) ===
    registerModules(data.modules)

    // === 3. Entity IDs (required by encryption, indexing, entity links) ===
    registerEntityIds(data.entityIds)

    // === 4. Entity fields registry (for encryption manager, Turbopack compatibility) ===
    if (data.entityFieldsRegistry) {
      registerEntityFields(data.entityFieldsRegistry)
    }

    // === 5. Search module configs (for search service registration in DI) ===
    if (data.searchModuleConfigs) {
      registerSearchModuleConfigs(data.searchModuleConfigs)
    }

    // === 6. Analytics module configs (for dashboard widgets and analytics API) ===
    if (data.analyticsModuleConfigs) {
      registerAnalyticsModuleConfigs(data.analyticsModuleConfigs)
    }

    // === 6b. Response enrichers (for CRUD response enrichment) ===
    if (data.enricherEntries) {
      registerResponseEnrichers(data.enricherEntries)
    }

    // === 6c. API interceptors (for CRUD route interception) ===
    if (data.interceptorEntries) {
      registerApiInterceptors(data.interceptorEntries)
    }

    // === 6d. Component overrides (for page/component replacement) ===
    if (data.componentOverrideEntries) {
      const allOverrides = data.componentOverrideEntries.flatMap((entry) => entry.componentOverrides ?? [])
      registerComponentOverrides(allOverrides)
    }

    // === 7-8. UI Widgets and Optional packages (async to avoid circular deps) ===
    // Store the promise so CLI context can await it
    _asyncRegistrationPromise = registerWidgetsAndOptionalPackages(data, options)
    void _asyncRegistrationPromise

    options.onRegistrationComplete?.()
  }
}

/**
 * Wait for async registrations (CLI modules, widgets, etc.) to complete.
 * Call this after bootstrap() in CLI context where you need modules immediately.
 */
export async function waitForAsyncRegistration(): Promise<void> {
  if (_asyncRegistrationPromise) {
    await _asyncRegistrationPromise
  }
}

async function registerWidgetsAndOptionalPackages(data: BootstrapData, options: BootstrapOptions): Promise<void> {
  // Register UI widgets (dynamic imports to avoid circular deps with ui/core packages)
  try {
    const [dashboardRegistry, injectionRegistry, coreInjection] = await Promise.all([
      import('@open-mercato/ui/backend/dashboard/widgetRegistry'),
      import('@open-mercato/ui/backend/injection/widgetRegistry'),
      import('@open-mercato/core/modules/widgets/lib/injection'),
    ])

    dashboardRegistry.registerDashboardWidgets(data.dashboardWidgetEntries)
    injectionRegistry.registerInjectionWidgets(data.injectionWidgetEntries)
    coreInjection.registerCoreInjectionWidgets(data.injectionWidgetEntries)
    coreInjection.registerCoreInjectionTables(data.injectionTables)
  } catch {
    // UI packages may not be available in all contexts
  }

  // Note: Search module configs are registered synchronously in the main bootstrap.
  // The actual registerSearchModule() call happens in core/bootstrap.ts when the
  // DI container is created, using getSearchModuleConfigs() from the global registry.

  // Note: CLI module registration is handled separately in CLI context
  // via bootstrapFromAppRoot in dynamicLoader. We don't import CLI here
  // to avoid Turbopack tracing through the CLI package in Next.js context.
}

/**
 * Check if bootstrap has been called.
 */
export function isBootstrapped(): boolean {
  return _bootstrapped
}

/**
 * Reset bootstrap state. Useful for testing.
 */
export function resetBootstrapState(): void {
  _bootstrapped = false
}
