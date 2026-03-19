import { type IntegrationDefinition, LEGACY_INTEGRATION_DETAIL_TABS_SPOT_ID } from '@open-mercato/shared/modules/integrations/types'
import type { LoadedInjectionSpotWidget } from '@open-mercato/ui/backend/injection/InjectionSpot'

type IntegrationDetailPlacementKind = 'tab' | 'group' | 'stack'

export type IntegrationDetailInjectedTab = {
  id: string
  label: string
  priority: number
  widgets: LoadedInjectionSpotWidget[]
}

export function resolveIntegrationDetailWidgetSpotId(
  integration: Pick<IntegrationDefinition, 'detailPage'> | null | undefined,
  legacySpotId: typeof LEGACY_INTEGRATION_DETAIL_TABS_SPOT_ID,
): string {
  const widgetSpotId = integration?.detailPage?.widgetSpotId?.trim()
  return widgetSpotId && widgetSpotId.length > 0 ? widgetSpotId : legacySpotId
}

export function resolveRequestedIntegrationDetailTab(
  value: string | null | undefined,
  hasVersions: boolean,
  customTabIds: readonly string[],
): string {
  if (value && customTabIds.includes(value)) return value
  if (value === 'health' || value === 'logs') return value
  if (value === 'version' && hasVersions) return 'version'
  return 'credentials'
}

export function filterIntegrationDetailWidgetsByKind(
  widgets: readonly LoadedInjectionSpotWidget[],
  kind: IntegrationDetailPlacementKind,
): LoadedInjectionSpotWidget[] {
  return widgets
    .filter((widget) => (widget.placement?.kind ?? 'stack') === kind)
    .sort((left, right) => {
      const leftPriority = typeof left.placement?.priority === 'number' ? left.placement.priority : 0
      const rightPriority = typeof right.placement?.priority === 'number' ? right.placement.priority : 0
      return rightPriority - leftPriority
    })
}

export function buildIntegrationDetailInjectedTabs(
  widgets: readonly LoadedInjectionSpotWidget[],
  resolveLabel: (widget: LoadedInjectionSpotWidget) => string,
): IntegrationDetailInjectedTab[] {
  const groupedTabs = new Map<string, IntegrationDetailInjectedTab>()

  for (const widget of widgets) {
    if ((widget.placement?.kind ?? 'stack') !== 'tab') continue

    const id = widget.placement?.groupId ?? widget.widgetId
    const label = resolveLabel(widget)
    const priority = typeof widget.placement?.priority === 'number' ? widget.placement.priority : 0
    const existing = groupedTabs.get(id)

    if (existing) {
      existing.widgets.push(widget)
      existing.priority = Math.max(existing.priority, priority)
      continue
    }

    groupedTabs.set(id, {
      id,
      label,
      priority,
      widgets: [widget],
    })
  }

  return Array.from(groupedTabs.values()).sort((left, right) => right.priority - left.priority)
}
