/** @jest-environment jsdom */
import * as React from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import type { InjectionWidgetModule, ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'
import type { ModuleInjectionWidgetEntry } from '@open-mercato/shared/modules/registry'
import { registerCoreInjectionTables, registerCoreInjectionWidgets, registerEnabledModuleIds } from '@open-mercato/shared/modules/widgets/injection-loader'
import { CustomerDetailSidebar } from '../CustomerDetailSidebar'
import { useCustomerInjectedTabs } from '../useCustomerInjectedTabs'
import { PERSON_DETAIL_TAB_IDS, PersonDetailTabs } from '../PersonDetailTabs'

const mockChrome = { grantedFeatures: ['extension.*'] }
const context = { resourceKind: 'customers.person', resourceId: 'person-1' }
const data = { person: { id: 'person-1' }, _integrations: { example: { externalId: 'remote-1' } } }
const SIDEBAR = 'detail:customers.person:sidebar'
const TABS = 'detail:customers.person:tabs'

jest.mock('@open-mercato/ui/backend/BackendChromeProvider', () => ({ useBackendChrome: () => ({ payload: mockChrome, isReady: true }) }))
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => (key: string, fallback?: string) => key === 'extension.group' ? 'Translated group' : fallback ?? key }))

function register(widgets: InjectionWidgetModule[], table: ModuleInjectionTable, enabled = ['customers', 'extension']) {
  const entries: ModuleInjectionWidgetEntry[] = widgets.map((widget) => ({ moduleId: 'extension', key: widget.metadata.id, widgetId: widget.metadata.id, source: 'package', loader: async () => widget }))
  registerCoreInjectionWidgets(entries)
  registerCoreInjectionTables([{ moduleId: 'extension', table }], entries)
  registerEnabledModuleIds(enabled)
}

function widget(id: string, title = id, features = ['extension.view']): InjectionWidgetModule {
  return {
    metadata: { id, title, features, requiredModules: ['customers'] },
    eventHandlers: { onLoad: async (value) => {
      const state = (value as { sharedState: { set: (key: string, value: unknown) => void } }).sharedState
      state.set(id, 'loaded')
    } },
    Widget: ({ context: value, data: record }) => {
      const state = (value as { sharedState: { get: (key: string) => unknown } }).sharedState
      return <div data-testid={id}>{id}:{String(state.get(id))}:{JSON.stringify(record)}</div>
    },
  }
}

function Detail({ initialTab = 'activities', hiddenTabIds = [] }: { initialTab?: string; hiddenTabIds?: string[] }) {
  const [activeTab, setActiveTab] = React.useState(initialTab)
  const { injectedTabs, injectedTabMap, loading } = useCustomerInjectedTabs({ spotId: TABS, context, data, nativeTabIds: PERSON_DETAIL_TAB_IDS })
  return <CustomerDetailSidebar spotId={SIDEBAR} context={context} data={data}>
    <form data-testid="native-form" />
    <PersonDetailTabs activeTab={activeTab} onTabChange={setActiveTab} injectedTabs={injectedTabs} isLoadingInjectedTabs={loading} hiddenTabIds={hiddenTabIds}>
      <div data-testid="selected-tab">{activeTab}</div>
      {activeTab === 'activities' ? <div>Native activities</div> : null}
      {injectedTabMap.get(activeTab)?.()}
    </PersonDetailTabs>
  </CustomerDetailSidebar>
}

beforeEach(() => { mockChrome.grantedFeatures = ['extension.*']; register([], {}) })
afterEach(() => { register([], {}) })

it('renders every grouped widget, translates one label and retains native content on collisions', async () => {
  register([widget('first'), widget('second'), widget('native-extra')], {
    [TABS]: [
      { widgetId: 'first', kind: 'tab', groupId: 'shared', groupLabel: 'extension.group', priority: 30 },
      { widgetId: 'second', kind: 'tab', groupId: 'shared', groupLabel: 'extension.group', priority: 20 },
      { widgetId: 'native-extra', kind: 'tab', groupId: 'activities', priority: 10 },
    ],
  })
  const view = render(<Detail initialTab="shared" />)
  await screen.findByTestId('first')
  expect(screen.getByTestId('second')).toHaveTextContent('second:loaded')
  expect(screen.getAllByRole('tab', { name: 'Translated group' })).toHaveLength(1)
  expect(screen.getAllByRole('tab', { name: 'Activities' })).toHaveLength(1)
  act(() => screen.getByRole('tab', { name: 'Activities' }).click())
  expect(screen.getByText('Native activities')).toBeInTheDocument()
  expect(screen.getByTestId('native-extra')).toBeInTheDocument()
  view.unmount()
})

it('keeps the form mounted and reserves sidebar space only for permitted, enabled widgets', async () => {
  const view = render(<Detail />)
  const form = screen.getByTestId('native-form')
  await waitFor(() => expect(screen.getByTestId('selected-tab')).toHaveTextContent('activities'))
  expect(view.container.querySelector('aside')).toBeNull()
  act(() => register([widget('external-ids')], { [SIDEBAR]: 'external-ids' }))
  await screen.findByTestId('external-ids')
  expect(screen.getByTestId('external-ids')).toHaveTextContent('remote-1')
  expect(screen.getByTestId('native-form')).toBe(form)
  expect(view.container.querySelector('aside')).toHaveClass('w-full', 'lg:w-80')
  mockChrome.grantedFeatures = []
  view.rerender(<Detail />)
  await waitFor(() => expect(view.container.querySelector('aside')).toBeNull())
  mockChrome.grantedFeatures = ['extension.*']
  act(() => register([widget('external-ids')], { [SIDEBAR]: 'external-ids' }, ['customers']))
  view.rerender(<Detail />)
  await waitFor(() => expect(view.container.querySelector('aside')).toBeNull())
})

it('falls back when a selected contributed tab disappears or is hidden', async () => {
  register([widget('selected')], { [TABS]: { widgetId: 'selected', kind: 'tab', groupId: 'selected' } })
  const view = render(<Detail initialTab="selected" />)
  await screen.findByTestId('selected')
  act(() => register([], {}))
  await waitFor(() => expect(screen.getByTestId('selected-tab')).toHaveTextContent('activities'))
  view.rerender(<Detail initialTab="selected" hiddenTabIds={['activities']} />)
  await waitFor(() => expect(screen.getByTestId('selected-tab')).toHaveTextContent('emails'))
})

it('collapses a mounted sidebar when all widget output is empty and reveals it after contributor data changes', async () => {
  const emptyWidget: InjectionWidgetModule = {
    metadata: { id: 'conditional-sidebar', title: 'Conditional sidebar' },
    Widget: ({ data: value }) => {
      const integrations = (value as { _integrations: Record<string, unknown> })._integrations
      return Object.keys(integrations).length ? <div>External ID visible</div> : null
    },
  }
  register([emptyWidget], { [SIDEBAR]: 'conditional-sidebar' })
  const view = render(<CustomerDetailSidebar spotId={SIDEBAR} context={context} data={{ _integrations: {} }}><form data-testid="preserved-form" /></CustomerDetailSidebar>)
  const form = screen.getByTestId('preserved-form')
  await waitFor(() => expect(view.container.querySelector('aside')).toHaveClass('hidden'))
  view.rerender(<CustomerDetailSidebar spotId={SIDEBAR} context={context} data={{ _integrations: { example: 'external-id' } }}><form data-testid="preserved-form" /></CustomerDetailSidebar>)
  await screen.findByText('External ID visible')
  await waitFor(() => expect(view.container.querySelector('aside')).toHaveClass('lg:w-80'))
  expect(screen.getByTestId('preserved-form')).toBe(form)
  view.rerender(<CustomerDetailSidebar spotId={SIDEBAR} context={context} data={{ _integrations: {} }}><form data-testid="preserved-form" /></CustomerDetailSidebar>)
  await waitFor(() => expect(view.container.querySelector('aside')).toHaveClass('hidden'))
})
