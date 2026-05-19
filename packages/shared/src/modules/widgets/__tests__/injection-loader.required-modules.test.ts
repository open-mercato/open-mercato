/**
 * @jest-environment jsdom
 *
 * Regression coverage for issue #1849 — widgets that integrate with another
 * module (for example a customers AI trigger that calls
 * `/api/ai_assistant/...`) must be skipped at load time when the dependency
 * module is not enabled in `modules.ts`. Feature gates alone are insufficient
 * because superadmin / wildcard grants pass them even when the dependency
 * module is absent.
 */
import { describe, it, expect, beforeEach } from '@jest/globals'
import type {
  InjectionWidgetModule,
  ModuleInjectionTable,
} from '@open-mercato/shared/modules/widgets/injection'
import type { ModuleInjectionWidgetEntry } from '@open-mercato/shared/modules/registry'
import {
  invalidateInjectionWidgetCache,
  loadInjectionWidgetById,
  loadInjectionWidgetsForSpot,
  registerCoreInjectionTables,
  registerCoreInjectionWidgets,
  registerEnabledModuleIds,
} from '@open-mercato/shared/modules/widgets/injection-loader'

const HOST_SPOT_ID = 'data-table:host.list:search-trailing'
const ALWAYS_AVAILABLE_WIDGET_ID = 'host.injection.always-available'
const REQUIRES_AI_WIDGET_ID = 'host.injection.requires-ai-assistant'

const PlaceholderComponent = () => null

const alwaysAvailableWidget: InjectionWidgetModule<Record<string, unknown>, Record<string, unknown>> = {
  metadata: {
    id: ALWAYS_AVAILABLE_WIDGET_ID,
    title: 'Always Available',
    description: 'Has no module dependencies and must always load.',
    priority: 50,
    enabled: true,
  },
  Widget: PlaceholderComponent,
}

const requiresAiAssistantWidget: InjectionWidgetModule<Record<string, unknown>, Record<string, unknown>> = {
  metadata: {
    id: REQUIRES_AI_WIDGET_ID,
    title: 'Requires AI Assistant',
    description: 'Calls /api/ai_assistant — must be skipped when ai_assistant is disabled.',
    requiredModules: ['ai_assistant'],
    priority: 100,
    enabled: true,
  },
  Widget: PlaceholderComponent,
}

function makeWidgetEntry(
  moduleId: string,
  key: string,
  loader: () => Promise<InjectionWidgetModule<any, any>>,
): ModuleInjectionWidgetEntry {
  return {
    moduleId,
    key,
    source: 'package',
    loader,
  }
}

function registerHostFixtures(includeAiAssistantModule: boolean) {
  invalidateInjectionWidgetCache()
  const widgetEntries: ModuleInjectionWidgetEntry[] = [
    makeWidgetEntry('host', 'host/widgets/injection/always-available/widget.ts', async () => alwaysAvailableWidget),
    makeWidgetEntry('host', 'host/widgets/injection/requires-ai/widget.ts', async () => requiresAiAssistantWidget),
  ]
  registerCoreInjectionWidgets(widgetEntries)

  const tables: Array<{ moduleId: string; table: ModuleInjectionTable }> = [
    {
      moduleId: 'host',
      table: {
        [HOST_SPOT_ID]: [
          { widgetId: ALWAYS_AVAILABLE_WIDGET_ID, priority: 50 },
          { widgetId: REQUIRES_AI_WIDGET_ID, priority: 100 },
        ],
      },
    },
  ]
  if (includeAiAssistantModule) {
    tables.push({ moduleId: 'ai_assistant', table: {} })
  }
  registerCoreInjectionTables(tables)

  const enabledIds = ['host']
  if (includeAiAssistantModule) enabledIds.push('ai_assistant')
  registerEnabledModuleIds(enabledIds)
}

function registerHostFixturesUsingExplicitRegistryOnly(includeAiAssistantModule: boolean) {
  // Simulates the real generator output: a dependency module (ai_assistant)
  // is enabled in modules.ts but ships NO widgets/injection-table.ts, so it
  // does not appear in injectionTables. The explicit enabled-modules registry
  // is the only signal that proves it is enabled.
  invalidateInjectionWidgetCache()
  const widgetEntries: ModuleInjectionWidgetEntry[] = [
    makeWidgetEntry('host', 'host/widgets/injection/always-available/widget.ts', async () => alwaysAvailableWidget),
    makeWidgetEntry('host', 'host/widgets/injection/requires-ai/widget.ts', async () => requiresAiAssistantWidget),
  ]
  registerCoreInjectionWidgets(widgetEntries)

  registerCoreInjectionTables([
    {
      moduleId: 'host',
      table: {
        [HOST_SPOT_ID]: [
          { widgetId: ALWAYS_AVAILABLE_WIDGET_ID, priority: 50 },
          { widgetId: REQUIRES_AI_WIDGET_ID, priority: 100 },
        ],
      },
    },
  ])

  const enabledIds = ['host']
  if (includeAiAssistantModule) enabledIds.push('ai_assistant')
  registerEnabledModuleIds(enabledIds)
}

describe('Injection loader — requiredModules gating (#1849)', () => {
  beforeEach(() => {
    invalidateInjectionWidgetCache()
  })

  it('loads a widget that requires a module that IS enabled', async () => {
    registerHostFixtures(true)
    const loaded = await loadInjectionWidgetsForSpot(HOST_SPOT_ID)
    const ids = loaded.map((widget) => widget.metadata.id).sort()
    expect(ids).toEqual([REQUIRES_AI_WIDGET_ID, ALWAYS_AVAILABLE_WIDGET_ID].sort())
  })

  it('skips a widget whose required module is NOT enabled', async () => {
    registerHostFixtures(false)
    const loaded = await loadInjectionWidgetsForSpot(HOST_SPOT_ID)
    const ids = loaded.map((widget) => widget.metadata.id)
    expect(ids).toContain(ALWAYS_AVAILABLE_WIDGET_ID)
    expect(ids).not.toContain(REQUIRES_AI_WIDGET_ID)
  })

  it('returns null from loadInjectionWidgetById when required module is missing', async () => {
    registerHostFixtures(false)
    const widget = await loadInjectionWidgetById(REQUIRES_AI_WIDGET_ID)
    expect(widget).toBeNull()
  })

  it('returns the widget from loadInjectionWidgetById when required module is enabled', async () => {
    registerHostFixtures(true)
    const widget = await loadInjectionWidgetById(REQUIRES_AI_WIDGET_ID)
    expect(widget).not.toBeNull()
    expect(widget?.metadata.id).toBe(REQUIRES_AI_WIDGET_ID)
  })

  it('loads a widget when its required module ships NO injection table but is in the enabled-modules registry', async () => {
    // Regression: dependency modules without widgets/injection-table.ts
    // (for example `ai_assistant`) must still satisfy `requiredModules`
    // checks once they are registered as enabled at bootstrap.
    registerHostFixturesUsingExplicitRegistryOnly(true)
    const loaded = await loadInjectionWidgetsForSpot(HOST_SPOT_ID)
    const ids = loaded.map((widget) => widget.metadata.id).sort()
    expect(ids).toEqual([REQUIRES_AI_WIDGET_ID, ALWAYS_AVAILABLE_WIDGET_ID].sort())
  })

  it('skips a widget when its required module is absent from the explicit enabled-modules registry', async () => {
    registerHostFixturesUsingExplicitRegistryOnly(false)
    const loaded = await loadInjectionWidgetsForSpot(HOST_SPOT_ID)
    const ids = loaded.map((widget) => widget.metadata.id)
    expect(ids).toContain(ALWAYS_AVAILABLE_WIDGET_ID)
    expect(ids).not.toContain(REQUIRES_AI_WIDGET_ID)
  })
})
