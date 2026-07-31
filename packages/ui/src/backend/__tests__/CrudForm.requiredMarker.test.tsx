/** @jest-environment jsdom */
jest.setTimeout(15000)

const pushMock = jest.fn()
const triggerEventMock = jest.fn(async () => ({ ok: true }))

const requiredWidget = {
  widgetId: 'catalog.injection.product-seo',
  moduleId: 'catalog',
  module: {
    metadata: {
      id: 'catalog.injection.product-seo',
      title: 'Product SEO Helper',
      enabled: true,
      requiredFields: ['description'],
    },
    Widget: () => null,
  },
}

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))
jest.mock('remark-gfm', () => ({ __esModule: true, default: {} }))
jest.mock('../confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: jest.fn(), ConfirmDialogElement: null }),
}))
jest.mock('../injection/InjectionSpot', () => ({
  __esModule: true,
  InjectionSpot: () => null,
  useInjectionWidgets: () => ({ widgets: [requiredWidget], loading: false, error: null }),
  useInjectionSpotEvents: () => ({ triggerEvent: triggerEventMock }),
}))
jest.mock('../injection/useInjectionDataWidgets', () => ({
  __esModule: true,
  useInjectionDataWidgets: () => ({ widgets: [], isLoading: false, error: null }),
}))

import * as React from 'react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { CrudForm, type CrudField } from '../CrudForm'

describe('CrudForm required marker from injection widget metadata', () => {
  const fields: CrudField[] = [
    { id: 'name', label: 'Name', type: 'text' },
    { id: 'description', label: 'Description', type: 'text' },
  ]

  it('renders a required marker on fields declared in an active widget requiredFields', () => {
    const { container } = renderWithProviders(
      <CrudForm
        title="Form"
        fields={fields}
        initialValues={{ name: '', description: '' }}
        injectionSpotId="crud-form:catalog.product"
        onSubmit={() => {}}
      />,
      { dict: { 'ui.forms.actions.save': 'Save' } },
    )

    const descriptionMarker = container.querySelector(
      '[data-crud-field-id="description"] .text-status-error-text',
    )
    const nameMarker = container.querySelector(
      '[data-crud-field-id="name"] .text-status-error-text',
    )

    expect(descriptionMarker).not.toBeNull()
    expect(descriptionMarker?.textContent).toContain('*')
    expect(nameMarker).toBeNull()
  })

  it('passes the active widget requiredFields to custom group components via requiredFieldIds', () => {
    let received: ReadonlySet<string> | undefined
    const groups = [
      {
        id: 'builder',
        component: (ctx: { requiredFieldIds?: ReadonlySet<string> }) => {
          received = ctx.requiredFieldIds
          return <div data-testid="builder" />
        },
      },
    ]

    renderWithProviders(
      <CrudForm
        title="Form"
        fields={[]}
        groups={groups}
        initialValues={{ description: '' }}
        injectionSpotId="crud-form:catalog.product"
        onSubmit={() => {}}
      />,
      { dict: { 'ui.forms.actions.save': 'Save' } },
    )

    expect(received).toBeDefined()
    expect(Array.from(received ?? [])).toContain('description')
  })
})
