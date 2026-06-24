/** @jest-environment jsdom */
jest.setTimeout(15000)

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {} }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))
jest.mock('remark-gfm', () => ({ __esModule: true, default: {} }))
jest.mock('../injection/InjectionSpot', () => ({
  __esModule: true,
  InjectionSpot: () => null,
  useInjectionWidgets: () => ({ widgets: [], loading: false, error: null }),
  useInjectionSpotEvents: () => ({ triggerEvent: jest.fn() }),
}))
jest.mock('../injection/useInjectionDataWidgets', () => ({
  __esModule: true,
  useInjectionDataWidgets: () => ({ widgets: [], isLoading: false, error: null }),
}))

import * as React from 'react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { CrudForm, type CrudField } from '../CrudForm'

describe('CrudForm native HTML5 validation (issue #3485)', () => {
  it('marks the default single-card form as noValidate so native constraints cannot mask zod errors', () => {
    const fields: CrudField[] = [
      { id: 'canonicalUrl', label: 'Canonical URL', type: 'text' },
    ]

    const { container } = renderWithProviders(
      <CrudForm title="Form" fields={fields} onSubmit={() => {}} />,
      { dict: { 'ui.forms.actions.save': 'Save' } },
    )

    const form = container.querySelector('form') as HTMLFormElement | null
    expect(form).not.toBeNull()
    expect(form?.noValidate).toBe(true)
  })

  it('marks the grouped/two-column form as noValidate even when a child renders a native url input', () => {
    const { container } = renderWithProviders(
      <CrudForm
        title="Form"
        fields={[]}
        groups={[
          {
            id: 'compliance',
            component: () => <input type="url" defaultValue="not-a-valid-url" />,
          },
        ]}
        onSubmit={() => {}}
      />,
      { dict: { 'ui.forms.actions.save': 'Save' } },
    )

    const form = container.querySelector('form') as HTMLFormElement | null
    expect(form).not.toBeNull()
    expect(form?.noValidate).toBe(true)
  })
})
