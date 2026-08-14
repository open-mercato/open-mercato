/** @jest-environment jsdom */

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))
jest.mock('remark-gfm', () => ({ __esModule: true, default: {} }))
jest.mock('../confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: jest.fn().mockResolvedValue(true), ConfirmDialogElement: null }),
}))
jest.mock('../custom-fields/FieldDefinitionsManager', () => {
  const React = require('react')
  return { __esModule: true, FieldDefinitionsManager: React.forwardRef(() => <div>field definitions</div>) }
})
jest.mock('../utils/customFieldForms', () => ({
  __esModule: true,
  buildFormFieldFromCustomFieldDef: jest.fn(() => null),
  buildFormFieldsFromCustomFields: jest.fn(() => []),
  fetchCustomFieldFormStructure: jest.fn(async () => ({
    fields: [],
    definitions: [],
    metadata: { items: [], fieldsetsByEntity: {}, entitySettings: {} },
  })),
}))

import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { CrudForm, type CrudField } from '../CrudForm'

const dict = { 'ui.forms.actions.save': 'Save' }

const fields: CrudField[] = [
  { id: 'name', label: 'Name', type: 'text' },
  { id: 'isActive', label: 'Active', type: 'checkbox' },
]

/**
 * A checkbox seeded `false` must be able to reach `true`. The users edit form uses this
 * to reactivate a deactivated account, so a stuck-off checkbox would let an operator
 * deactivate someone with no way back.
 */
describe('CrudForm checkbox toggling', () => {
  it('submits true after toggling a checkbox that started false', async () => {
    const onSubmit = jest.fn().mockResolvedValue(undefined)

    renderWithProviders(
      <CrudForm
        title="Test"
        fields={fields}
        initialValues={{ name: 'thing', isActive: false }}
        onSubmit={onSubmit}
        submitLabel="Save"
      />,
      { dict },
    )

    const checkbox = await screen.findByRole('checkbox')
    expect(checkbox).toHaveAttribute('data-state', 'unchecked')

    fireEvent.click(checkbox)

    await waitFor(() => expect(checkbox).toHaveAttribute('data-state', 'checked'))

    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0])

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ isActive: true })
  })

  it('submits false after clearing a checkbox that started true', async () => {
    const onSubmit = jest.fn().mockResolvedValue(undefined)

    renderWithProviders(
      <CrudForm
        title="Test"
        fields={fields}
        initialValues={{ name: 'thing', isActive: true }}
        onSubmit={onSubmit}
        submitLabel="Save"
      />,
      { dict },
    )

    const checkbox = await screen.findByRole('checkbox')
    expect(checkbox).toHaveAttribute('data-state', 'checked')

    fireEvent.click(checkbox)
    await waitFor(() => expect(checkbox).toHaveAttribute('data-state', 'unchecked'))

    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[0])

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ isActive: false })
  })
})
