import type { GeneratorExtension } from '../extension'
import { createAgentFilesExtension, type AgentFilesResolver } from './agent-files'
import { createAiAgentsExtension } from './ai-agents'
import { createAiToolsExtension } from './ai-tools'
import { createAnalyticsExtension } from './analytics'
import { createCommandInterceptorsExtension } from './command-interceptors'
import { createComponentOverridesExtension } from './component-overrides'
import { createDashboardWidgetsExtension } from './dashboard-widgets'
import { createEnrichersExtension } from './enrichers'
import { createEventsExtension } from './events'
import { createGuardsExtension } from './guards'
import { createInboxActionsExtension } from './inbox-actions'
import { createInjectionWidgetsExtension } from './injection-widgets'
import { createInterceptorsExtension } from './interceptors'
import { createMessagesExtension } from './messages'
import { createNotificationsExtension } from './notifications'
import { createPageMiddlewareExtension } from './page-middleware'
import { createSearchExtension } from './search'
import { createTranslatableFieldsExtension } from './translatable-fields'
import { createWorkflowsExtension } from './workflows'

/**
 * `resolver` is optional so existing callers and unit tests keep working; the
 * agent-files extension uses it to tell a monorepo checkout from a standalone
 * app when choosing where to write its artifacts.
 */
export function loadGeneratorExtensions(resolver?: AgentFilesResolver): GeneratorExtension[] {
  return [
    createSearchExtension(),
    createNotificationsExtension(),
    createMessagesExtension(),
    createAiToolsExtension(),
    createAiAgentsExtension(),
    createAgentFilesExtension(resolver),
    createEventsExtension(),
    createAnalyticsExtension(),
    createTranslatableFieldsExtension(),
    createEnrichersExtension(),
    createInterceptorsExtension(),
    createComponentOverridesExtension(),
    createInboxActionsExtension(),
    createGuardsExtension(),
    createCommandInterceptorsExtension(),
    createPageMiddlewareExtension(),
    createDashboardWidgetsExtension(),
    createInjectionWidgetsExtension(),
    createWorkflowsExtension(),
  ]
}
