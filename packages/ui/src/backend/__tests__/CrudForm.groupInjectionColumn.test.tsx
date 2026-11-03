/** @jest-environment jsdom */
jest.setTimeout(15000)

// Regression guard for #4400: an injected group widget placed in column 1 must
// render as a full-width row in the main stack — CrudForm must NOT switch to
// the narrow 7fr/3fr secondary-column layout unless a widget explicitly asks
// for column 2. The hook is mocked so the test drives the injected widgets
// directly, following the CrudForm.fieldInjection.test.tsx pattern.
let injectedGroupWidgets: unknown[] = []

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {} }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))
jest.mock('remark-gfm', () => ({ __esModule: true, default: {} }))
jest.mock('../injection/InjectionSpot', () => ({
  __esModule: true,
  InjectionSpot: () => null,
  useInjectionWidgets: () => ({ widgets: injectedGroupWidgets, loading: false, error: null }),
  useInjectionSpotEvents: () => ({ triggerEvent: jest.fn(async () => ({ ok: true, data: {} })) }),
}))
jest.mock('../injection/useInjectionDataWidgets', () => ({
  __esModule: true,
  useInjectionDataWidgets: () => ({ widgets: [], isLoading: false, error: null }),
}))

import * as React from 'react'
import { waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { CrudForm, type CrudField, type CrudFormGroup } from '../CrudForm'

const fields: CrudField[] = [
  { id: 'name', label: 'Name', type: 'text' },
]

const groups: CrudFormGroup[] = [
  { id: 'contact', label: 'Contact', fields: ['name'] },
]

function makeGroupWidget(column: 1 | 2) {
  return {
    widgetId: 'customer_accounts.injection.company-users',
    placement: { kind: 'group', column, groupLabel: 'Portal users', priority: 200 },
    module: {
      metadata: { title: 'Portal users', description: '' },
      Widget: () => <div data-testid="portal-users-widget">portal users</div>,
    },
  }
}

function renderForm() {
  return renderWithProviders(
    React.createElement(CrudForm as never, {
      title: 'Company',
      entityId: 'customers:company',
      fields,
      groups,
      onSubmit: () => {},
    }),
  )
}

describe('CrudForm injected group column placement (#4400)', () => {
  afterEach(() => {
    injectedGroupWidgets = []
  })

  it('renders a column-1 group widget as a full-width row without the secondary column', async () => {
    injectedGroupWidgets = [makeGroupWidget(1)]

    const { container } = renderForm()

    await waitFor(() => {
      expect(container.querySelector('[data-testid="portal-users-widget"]')).toBeTruthy()
    })

    expect(container.querySelector('[data-crud-injection-region]')).toBeNull()
    const twoColumnGrid = Array.from(container.querySelectorAll('div')).find((node) =>
      node.className.includes('7fr_3fr'),
    )
    expect(twoColumnGrid).toBeUndefined()
  })

  it('still supports an explicit column-2 group widget via the secondary column (sanity)', async () => {
    injectedGroupWidgets = [makeGroupWidget(2)]

    const { container } = renderForm()

    await waitFor(() => {
      expect(container.querySelector('[data-testid="portal-users-widget"]')).toBeTruthy()
    })

    const secondaryRegion = container.querySelector('[data-crud-injection-region]')
    expect(secondaryRegion).toBeTruthy()
    expect(secondaryRegion?.querySelector('[data-testid="portal-users-widget"]')).toBeTruthy()
  })
})
