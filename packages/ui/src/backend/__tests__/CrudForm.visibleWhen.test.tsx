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
  useInjectionSpotEvents: () => ({ triggerEvent: async () => ({ ok: true }) }),
}))
jest.mock('../injection/useInjectionDataWidgets', () => ({
  __esModule: true,
  useInjectionDataWidgets: () => ({ widgets: [], isLoading: false, error: null }),
}))

import * as React from 'react'
import { act, fireEvent } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { CrudForm, type CrudField, type CrudFieldGroup } from '../CrudForm'

const dict = {
  'ui.forms.actions.save': 'Save',
  'ui.forms.select.emptyOption': '—',
}

const fields: CrudField[] = [
  {
    id: 'commodity',
    label: 'Commodity',
    type: 'select',
    options: [
      { value: 'coffee', label: 'Coffee' },
      { value: 'wood', label: 'Wood' },
    ],
  },
  {
    id: 'speciesScientificName',
    label: 'Scientific species name',
    type: 'text',
    visibleWhen: { field: 'commodity', equals: 'wood' },
  },
]

const groups: CrudFieldGroup[] = [
  { id: 'details', title: 'Details', column: 1, fields: ['commodity', 'speciesScientificName'] },
]

function renderForm(commodity: string, withGroups: boolean) {
  return renderWithProviders(
    <CrudForm
      title="Form"
      fields={fields}
      groups={withGroups ? groups : undefined}
      initialValues={{ commodity, speciesScientificName: '' }}
      onSubmit={() => {}}
    />,
    { dict },
  )
}

describe('CrudForm visibleWhen', () => {
  it('hides a conditional field inside a group when the condition is not met', () => {
    const { container } = renderForm('coffee', true)
    expect(container.querySelector('[data-crud-field-id="commodity"]')).not.toBeNull()
    expect(container.querySelector('[data-crud-field-id="speciesScientificName"]')).toBeNull()
  })

  it('shows a conditional field inside a group when the condition is met', () => {
    const { container } = renderForm('wood', true)
    expect(container.querySelector('[data-crud-field-id="speciesScientificName"]')).not.toBeNull()
  })

  it('hides a conditional field inside a group when the driving value is empty', () => {
    const { container } = renderForm('', true)
    expect(container.querySelector('[data-crud-field-id="speciesScientificName"]')).toBeNull()
  })

  it('hides a conditional field in an ungrouped form when the condition is not met', () => {
    const { container } = renderForm('coffee', false)
    expect(container.querySelector('[data-crud-field-id="speciesScientificName"]')).toBeNull()
  })

  it('reveals a grouped conditional field when the driving value changes', async () => {
    const { container } = renderForm('coffee', true)
    expect(container.querySelector('[data-crud-field-id="speciesScientificName"]')).toBeNull()

    const select = container.querySelector('[data-crud-field-id="commodity"] select') as HTMLSelectElement | null
    if (!select) {
      // The select renders as a Radix combobox in some builds; drive the value through the
      // hidden native control the field always mirrors.
      const hidden = container.querySelector('[data-crud-field-id="commodity"] input') as HTMLInputElement
      await act(async () => {
        fireEvent.change(hidden, { target: { value: 'wood' } })
      })
    } else {
      await act(async () => {
        fireEvent.change(select, { target: { value: 'wood' } })
      })
    }

    expect(container.querySelector('[data-crud-field-id="speciesScientificName"]')).not.toBeNull()
  })
})
