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
import './lib/i18n/register-dictionary-loader'

// modules.ts inline overrides (replace/disable any contract a module
// presents through the unified modules.ts override surface).
// Importing @open-mercato/ai-assistant here also runs the side-effect
// that registers the AI domain applier with the umbrella dispatcher.
import { enabledModules } from '@/modules'
import { applyModuleOverridesFromEnabledModules } from '@open-mercato/shared/modules/overrides'
import '@open-mercato/ai-assistant'

applyModuleOverridesFromEnabledModules(enabledModules)

// Generated imports (static - works with bundlers)
import { modules } from '@/.mercato/generated/modules.bootstrap.generated'
import { entities } from '@/.mercato/generated/entities.generated'
import { diRegistrars } from '@/.mercato/generated/di.generated'
import { E } from '@/.mercato/generated/entities.ids.generated'
import { entityFieldsRegistry } from '@/.mercato/generated/entity-fields-registry'
import { dashboardWidgetEntries } from '@/.mercato/generated/dashboard-widgets.generated'
import { injectionWidgetEntries } from '@/.mercato/generated/injection-widgets.generated'
// Side-effect: registers translatable fields (must be before injection-tables which reads the registry)
import '@/.mercato/generated/translations-fields.generated'
import { injectionTables } from '@/.mercato/generated/injection-tables.generated'
import { searchModuleConfigs } from '@/.mercato/generated/search.generated'
import { eventModuleConfigs, allEvents } from '@/.mercato/generated/events.generated'
import { registerEventModuleConfigs } from '@open-mercato/shared/modules/events'
import { analyticsModuleConfigs } from '@/.mercato/generated/analytics.generated'
import { enricherEntries } from '@/.mercato/generated/enrichers.generated'
import { interceptorEntries } from '@/.mercato/generated/interceptors.generated'
import { componentOverrideEntries } from '@/.mercato/generated/component-overrides.generated'
import { guardEntries } from '@/.mercato/generated/guards.generated'
import { commandInterceptorEntries } from '@/.mercato/generated/command-interceptors.generated'
import { commandLoaderEntries } from '@/.mercato/generated/command-loaders.generated'
import { notificationHandlerEntries } from '@/.mercato/generated/notification-handlers.generated'
import { messageTypes } from '@/.mercato/generated/message-types.generated'
import { messageObjectTypes } from '@/.mercato/generated/message-objects.generated'
import { registerMessageTypes } from '@open-mercato/core/modules/messages/lib/message-types-registry'
import { registerMessageObjectTypes } from '@open-mercato/core/modules/messages/lib/message-objects-registry'
import { runBootstrapRegistrations } from '@/.mercato/generated/bootstrap-registrations.generated'
import { allCodeWorkflows } from '@/.mercato/generated/workflows.generated'
import { registerCodeWorkflows } from '@open-mercato/core/modules/workflows/lib/code-registry'

// Register event configs globally (similar to search)
registerEventModuleConfigs(eventModuleConfigs)
registerMessageTypes(messageTypes, { replace: true })
registerMessageObjectTypes(messageObjectTypes, { replace: true })
registerCodeWorkflows(allCodeWorkflows)
runBootstrapRegistrations()

import { registerIntrospectionSnapshotLoader } from '@open-mercato/shared/lib/introspection/snapshot-loader'
import type { IntrospectionSnapshot } from '@open-mercato/shared/lib/introspection/types'

registerIntrospectionSnapshotLoader(async (fields) => {
  const result: Partial<IntrospectionSnapshot> = {}
  const wanted = new Set(fields)

  await Promise.all([
    wanted.has('notificationTypes')
      ? import('@/.mercato/generated/notifications.generated').then((mod) => {
          result.notificationTypes = mod.notificationTypes as IntrospectionSnapshot['notificationTypes']
        })
      : Promise.resolve(),
    wanted.has('aiToolConfigEntries')
      ? import('@/.mercato/generated/ai-tools.generated').then((mod) => {
          result.aiToolConfigEntries = mod.aiToolConfigEntries as IntrospectionSnapshot['aiToolConfigEntries']
        })
      : Promise.resolve(),
    wanted.has('messageTypes')
      ? import('@/.mercato/generated/message-types.generated').then((mod) => {
          result.messageTypes = mod.messageTypes as IntrospectionSnapshot['messageTypes']
        })
      : Promise.resolve(),
  ])

  return result
})

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
  enricherEntries,
  interceptorEntries,
  componentOverrideEntries,
  guardEntries,
  commandInterceptorEntries,
  commandLoaderEntries,
  notificationHandlerEntries,
})

export { isBootstrapped }
