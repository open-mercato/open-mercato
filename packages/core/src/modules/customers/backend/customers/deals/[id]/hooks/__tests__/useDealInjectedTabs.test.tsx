/** @jest-environment jsdom */

type MockWidget = {
  widgetId: string
  placement?: { kind?: string; groupId?: string; groupLabel?: string; priority?: number }
  module: { metadata: { title?: string }; Widget: () => null }
}

const injectedWidgets: { current: MockWidget[] } = { current: [] }

const translations: Record<string, string> = {
  'mymodule.tabs.services': 'Services',
}

jest.mock('@open-mercato/ui/backend/injection/InjectionSpot', () => ({
  useInjectionWidgets: () => ({ widgets: injectedWidgets.current }),
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string) => translations[key] ?? fallback ?? key,
}))

import { renderHook } from '@testing-library/react'
import { useDealInjectedTabs } from '../useDealInjectedTabs'

const EmptyWidget = () => null

function renderTabs(widgets: MockWidget[]) {
  injectedWidgets.current = widgets
  const { result } = renderHook(() =>
    useDealInjectedTabs({ injectionContext: {}, data: null, setData: jest.fn() }),
  )
  return result.current.injectedTabs
}

describe('useDealInjectedTabs', () => {
  it('translates the placement groupLabel i18n key', () => {
    const tabs = renderTabs([
      {
        widgetId: 'mymodule.injection.services',
        placement: { kind: 'tab', groupId: 'services', groupLabel: 'mymodule.tabs.services' },
        module: { metadata: { title: 'Services widget' }, Widget: EmptyWidget },
      },
    ])

    expect(tabs).toEqual([expect.objectContaining({ id: 'services', label: 'Services' })])
  })

  it('falls back to the raw groupLabel when no translation exists', () => {
    const tabs = renderTabs([
      {
        widgetId: 'mymodule.injection.plain',
        placement: { kind: 'tab', groupId: 'plain', groupLabel: 'Plain label' },
        module: { metadata: {}, Widget: EmptyWidget },
      },
    ])

    expect(tabs[0]?.label).toBe('Plain label')
  })

  it('uses the widget metadata title when groupLabel is missing', () => {
    const tabs = renderTabs([
      {
        widgetId: 'mymodule.injection.untitled',
        placement: { kind: 'tab', groupId: 'untitled' },
        module: { metadata: { title: 'Widget title' }, Widget: EmptyWidget },
      },
    ])

    expect(tabs[0]?.label).toBe('Widget title')
  })
})
