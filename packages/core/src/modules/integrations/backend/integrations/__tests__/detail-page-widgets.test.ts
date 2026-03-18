/** @jest-environment node */

import {
  buildIntegrationDetailInjectedTabs,
  filterIntegrationDetailWidgetsByKind,
  resolveIntegrationDetailWidgetSpotId,
  resolveRequestedIntegrationDetailTab,
} from '../detail-page-widgets'
import { LEGACY_INTEGRATION_DETAIL_TABS_SPOT_ID } from '@open-mercato/shared/modules/integrations/types'
import type { LoadedInjectionSpotWidget } from '@open-mercato/ui/backend/injection/InjectionSpot'

function createWidget(input: {
  widgetId: string
  title: string
  kind?: 'tab' | 'group' | 'stack'
  groupId?: string
  groupLabel?: string
  priority?: number
}): LoadedInjectionSpotWidget {
  return {
    widgetId: input.widgetId,
    moduleId: 'test-module',
    key: `test:${input.widgetId}`,
    placement: {
      kind: input.kind,
      groupId: input.groupId,
      groupLabel: input.groupLabel,
      priority: input.priority,
    },
    module: {
      metadata: {
        id: input.widgetId,
        title: input.title,
      },
      Widget: () => null,
    },
  }
}

describe('integration detail widget helpers', () => {
  it('prefers provider-defined widget spot ids and falls back to the legacy integrations tab spot', () => {
    expect(resolveIntegrationDetailWidgetSpotId(
      { detailPage: { widgetSpotId: 'integrations.detail:gateway_stripe' } },
      LEGACY_INTEGRATION_DETAIL_TABS_SPOT_ID,
    )).toBe('integrations.detail:gateway_stripe')

    expect(resolveIntegrationDetailWidgetSpotId(
      { detailPage: {} },
      LEGACY_INTEGRATION_DETAIL_TABS_SPOT_ID,
    )).toBe(LEGACY_INTEGRATION_DETAIL_TABS_SPOT_ID)
  })

  it('groups tab widgets by group id and sorts tabs by priority', () => {
    const tabs = buildIntegrationDetailInjectedTabs(
      [
        createWidget({ widgetId: 'tab-b-1', title: 'Tab B', kind: 'tab', groupId: 'tab-b', priority: 20 }),
        createWidget({ widgetId: 'tab-a-1', title: 'Tab A', kind: 'tab', groupId: 'tab-a', priority: 10 }),
        createWidget({ widgetId: 'tab-b-2', title: 'Tab B second', kind: 'tab', groupId: 'tab-b', priority: 5 }),
      ],
      (widget) => widget.module.metadata.title ?? widget.widgetId,
    )

    expect(tabs.map((tab) => tab.id)).toEqual(['tab-b', 'tab-a'])
    expect(tabs[0]?.widgets).toHaveLength(2)
    expect(tabs[0]?.label).toBe('Tab B')
  })

  it('partitions widgets by placement kind', () => {
    const widgets = [
      createWidget({ widgetId: 'stacked', title: 'Stacked', kind: 'stack', priority: 1 }),
      createWidget({ widgetId: 'grouped', title: 'Grouped', kind: 'group', priority: 3 }),
      createWidget({ widgetId: 'tabbed', title: 'Tabbed', kind: 'tab', priority: 2 }),
    ]

    expect(filterIntegrationDetailWidgetsByKind(widgets, 'group').map((widget) => widget.widgetId)).toEqual(['grouped'])
    expect(filterIntegrationDetailWidgetsByKind(widgets, 'stack').map((widget) => widget.widgetId)).toEqual(['stacked'])
  })

  it('resolves requested tab ids with custom tabs ahead of built-in fallbacks', () => {
    expect(resolveRequestedIntegrationDetailTab('stripe-settings', true, ['stripe-settings'])).toBe('stripe-settings')
    expect(resolveRequestedIntegrationDetailTab('version', false, ['stripe-settings'])).toBe('credentials')
    expect(resolveRequestedIntegrationDetailTab('logs', true, ['stripe-settings'])).toBe('logs')
  })
})
