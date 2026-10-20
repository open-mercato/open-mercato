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
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { CrudForm, type CrudCustomFieldRenderProps, type CrudField } from '../CrudForm'

// A custom field renders its own control, so the wrapper cannot point its
// <label> at it. The wrapper label carries an id instead, and the field has to
// be told that id to name its control.
describe('CrudForm custom field label id', () => {
  function renderForm(fields: CrudField[]) {
    return renderWithProviders(<CrudForm title="Form" fields={fields} onSubmit={() => {}} />, { dict: {} })
  }

  it('hands a custom field the id of its visible label', () => {
    const { container } = renderForm([
      {
        id: 'jobTitle',
        label: 'Job title',
        type: 'custom',
        component: ({ labelId }) => (
          <button type="button" role="combobox" aria-expanded={false} aria-controls="options" aria-labelledby={labelId} />
        ),
      },
    ])

    const label = container.querySelector('[data-crud-field-id="jobTitle"] label') as HTMLLabelElement
    expect(label.id).not.toBe('')
    expect(screen.getByRole('combobox', { name: 'Job title' })).toHaveAttribute('aria-labelledby', label.id)
  })

  it('passes no label id when the field has no visible label', () => {
    const received: Array<CrudCustomFieldRenderProps['labelId']> = []
    renderForm([
      {
        id: 'addresses',
        label: '',
        type: 'custom',
        component: ({ labelId }) => {
          received.push(labelId)
          return <div>Addresses</div>
        },
      },
    ])

    expect(received.length).toBeGreaterThan(0)
    expect(received.every((value) => value === undefined)).toBe(true)
  })
})
