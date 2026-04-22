import type { GeneratorExtension } from '../extension'
import { createAiToolsExtension } from './ai-tools'
import { createAnalyticsExtension } from './analytics'
import { createCommandInterceptorsExtension } from './command-interceptors'
import { createComponentOverridesExtension } from './component-overrides'
import { createDashboardWidgetsExtension } from './dashboard-widgets'
import { createEnrichersExtension } from './enrichers'
import { createEventsExtension } from './events'
import { createGuardsExtension } from './guards'
import { createInboxActionsExtension } from './inbox-actions'
import { createInboxOpsSourcesExtension } from './inbox-ops-sources'
import { createInjectionWidgetsExtension } from './injection-widgets'
import { createInterceptorsExtension } from './interceptors'
import { createMessagesExtension } from './messages'
import { createNotificationsExtension } from './notifications'
import { createPageMiddlewareExtension } from './page-middleware'
import { createSearchExtension } from './search'
import { createTranslatableFieldsExtension } from './translatable-fields'

export function loadGeneratorExtensions(): GeneratorExtension[] {
  return [
    createSearchExtension(),
    createNotificationsExtension(),
    createMessagesExtension(),
    createAiToolsExtension(),
    createEventsExtension(),
    createAnalyticsExtension(),
    createTranslatableFieldsExtension(),
    createEnrichersExtension(),
    createInterceptorsExtension(),
    createComponentOverridesExtension(),
    createInboxActionsExtension(),
    createInboxOpsSourcesExtension(),
    createGuardsExtension(),
    createCommandInterceptorsExtension(),
    createPageMiddlewareExtension(),
    createDashboardWidgetsExtension(),
    createInjectionWidgetsExtension(),
  ]
}
