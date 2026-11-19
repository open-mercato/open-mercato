/** @jest-environment jsdom */
jest.setTimeout(15000)

// Regression coverage for the `legacyInjectionSpotId` bridge added for issue #6017 /
// PR #6063 (see BACKWARD_COMPATIBILITY.md "Customers Quick-Create Injection Spot
// Bridge"). When a caller renames/narrows its declared `injectionSpotId`, passing
// the prior id as `legacyInjectionSpotId` must keep every widget still targeting
// that prior id rendering — header, body/group/stack, and `:fields` — without
// double-rendering a widget registered under the same `widgetId` on both spots.
let widgetsBySpot: Record<string, unknown[]> = {}
let fieldWidgetsBySpot: Record<string, unknown[]> = {}

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {} }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))
jest.mock('remark-gfm', () => ({ __esModule: true, default: {} }))
jest.mock('../injection/InjectionSpot', () => ({
  __esModule: true,
  InjectionSpot: (props: any) => {
    const widgets = (props.widgetsOverride ?? widgetsBySpot[props.spotId] ?? []) as any[]
    return (
      <div data-testid={`injection-spot-${props.spotId}`}>
        {widgets.map((w) => (
          <w.module.Widget key={w.widgetId} context={props.context} data={props.data} onDataChange={() => {}} disabled={false} />
        ))}
      </div>
    )
  },
  useInjectionWidgets: (spotId: string | undefined) => ({
    widgets: spotId ? (widgetsBySpot[spotId] ?? []) : [],
    loading: false,
    error: null,
  }),
  useInjectionSpotEvents: () => ({ triggerEvent: jest.fn(async () => ({ ok: true, data: {} })) }),
}))
jest.mock('../injection/useInjectionDataWidgets', () => ({
  __esModule: true,
  useInjectionDataWidgets: (spotId: string) => ({
    widgets: fieldWidgetsBySpot[spotId] ?? [],
    isLoading: false,
    error: null,
  }),
}))

import * as React from 'react'
import { waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { CrudForm, type CrudField, type CrudFormGroup } from '../CrudForm'

const PRIMARY_SPOT = 'crud-form:test.declared'
const LEGACY_SPOT = 'crud-form:test.legacy'

const fields: CrudField[] = [{ id: 'name', label: 'Name', type: 'text' }]
const groups: CrudFormGroup[] = [{ id: 'main', label: 'Main', fields: ['name'] }]

function makeWidget(widgetId: string, testId: string) {
  return {
    widgetId,
    moduleId: 'test-module',
    key: widgetId,
    placement: { kind: 'stack' },
    module: {
      metadata: { id: widgetId, title: widgetId, description: '' },
      Widget: () => <div data-testid={testId}>{testId}</div>,
    },
  }
}

function makeFieldWidget(fieldId: string) {
  return {
    metadata: { id: fieldId, title: fieldId, description: '' },
    fields: [{ id: fieldId, label: fieldId, type: 'text', group: 'main' }],
  }
}

function renderForm() {
  return renderWithProviders(
    React.createElement(CrudForm as never, {
      title: 'Form',
      injectionSpotId: PRIMARY_SPOT,
      legacyInjectionSpotId: LEGACY_SPOT,
      fields,
      groups,
      onSubmit: () => {},
    }),
  )
}

describe('CrudForm legacyInjectionSpotId bridge (#6017 / #6063)', () => {
  afterEach(() => {
    widgetsBySpot = {}
    fieldWidgetsBySpot = {}
  })

  it('renders a widget registered only on the primary spot', async () => {
    widgetsBySpot[PRIMARY_SPOT] = [makeWidget('primary-only', 'primary-only-widget')]

    const { container } = renderForm()

    await waitFor(() => {
      expect(container.querySelector('[data-testid="primary-only-widget"]')).toBeTruthy()
    })
  })

  it('renders a widget registered only on the legacy spot', async () => {
    widgetsBySpot[LEGACY_SPOT] = [makeWidget('legacy-only', 'legacy-only-widget')]

    const { container } = renderForm()

    await waitFor(() => {
      expect(container.querySelector('[data-testid="legacy-only-widget"]')).toBeTruthy()
    })
  })

  it('renders a widget with the same widgetId on both spots exactly once', async () => {
    widgetsBySpot[PRIMARY_SPOT] = [makeWidget('shared-widget', 'shared-widget')]
    widgetsBySpot[LEGACY_SPOT] = [makeWidget('shared-widget', 'shared-widget')]

    const { container } = renderForm()

    await waitFor(() => {
      expect(container.querySelectorAll('[data-testid="shared-widget"]')).toHaveLength(1)
    })
  })

  it('bridges the header injection spot for a widget still targeting the legacy id', async () => {
    widgetsBySpot[`${LEGACY_SPOT}:header`] = [makeWidget('legacy-header', 'legacy-header-widget')]

    const { container } = renderForm()

    await waitFor(() => {
      expect(container.querySelector(`[data-testid="injection-spot-${LEGACY_SPOT}:header"]`)).toBeTruthy()
    })
    expect(container.querySelector('[data-testid="legacy-header-widget"]')).toBeTruthy()
  })

  it('renders a widget with the same widgetId on both header spots twice (header is not deduped)', async () => {
    widgetsBySpot[`${PRIMARY_SPOT}:header`] = [makeWidget('shared-header-widget', 'shared-header-widget')]
    widgetsBySpot[`${LEGACY_SPOT}:header`] = [makeWidget('shared-header-widget', 'shared-header-widget')]

    const { container } = renderForm()

    await waitFor(() => {
      expect(container.querySelectorAll('[data-testid="shared-header-widget"]')).toHaveLength(2)
    })
  })

  it('merges :fields widgets from both spots and dedupes a shared field id', async () => {
    fieldWidgetsBySpot[`${PRIMARY_SPOT}:fields`] = [makeFieldWidget('cf:primary_field')]
    fieldWidgetsBySpot[`${LEGACY_SPOT}:fields`] = [
      makeFieldWidget('cf:legacy_field'),
      makeFieldWidget('cf:primary_field'),
    ]

    const { container } = renderForm()

    await waitFor(() => {
      expect(container.querySelector('[data-crud-field-id="cf:legacy_field"]')).toBeTruthy()
    })
    // `[data-crud-field-id]` is nested onto both a field's wrapper and its inner
    // control, so count distinct labels (one per rendered field) rather than nodes.
    const primaryFieldLabels = Array.from(container.querySelectorAll('label')).filter(
      (node) => node.textContent?.trim() === 'cf:primary_field',
    )
    expect(primaryFieldLabels).toHaveLength(1)
  })

  it('renders unchanged when legacyInjectionSpotId is omitted (every other CrudForm caller)', async () => {
    widgetsBySpot[PRIMARY_SPOT] = [makeWidget('primary-only', 'primary-only-widget')]

    const { container } = renderWithProviders(
      React.createElement(CrudForm as never, {
        title: 'Form',
        injectionSpotId: PRIMARY_SPOT,
        fields,
        groups,
        onSubmit: () => {},
      }),
    )

    await waitFor(() => {
      expect(container.querySelector('[data-testid="primary-only-widget"]')).toBeTruthy()
    })
    expect(container.querySelector(`[data-testid="injection-spot-${LEGACY_SPOT}:header"]`)).toBeNull()
  })
})
