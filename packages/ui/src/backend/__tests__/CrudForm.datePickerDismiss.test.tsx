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
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { CrudForm, type CrudField } from '../CrudForm'

const dict = { 'ui.forms.actions.save': 'Save' }

async function mousePress(target: HTMLElement) {
  await act(async () => {
    fireEvent.pointerDown(target, { button: 0 })
    fireEvent.mouseDown(target, { button: 0 })
    target.focus()
    fireEvent.pointerUp(target, { button: 0 })
    fireEvent.mouseUp(target, { button: 0 })
    fireEvent.click(target, { button: 0 })
  })
}

/**
 * #9093: a day picked in a CrudForm date field but not confirmed with Apply must be
 * the value that gets saved when the user clicks the form's Save, instead of the old
 * date being submitted behind a success toast.
 */
describe('CrudForm date fields commit a picked but unapplied day on Save (#9093)', () => {
  it.each<[CrudField['type'], string, unknown]>([
    ['date', '2026-05-09', '2026-05-15'],
    ['datepicker', '2026-05-09', '2026-05-15'],
    ['datetime-local', '2026-05-09T10:30', '2026-05-15T10:30'],
    ['datetime', new Date(2026, 4, 9, 10, 30).toISOString(), new Date(2026, 4, 15, 10, 30).toISOString()],
  ])('type "%s" submits the picked day', async (type, initial, expected) => {
    const onSubmit = jest.fn().mockResolvedValue(undefined)
    const fields: CrudField[] = [{ id: 'due', label: 'Due', type }]

    renderWithProviders(
      <CrudForm
        title="Test"
        fields={fields}
        initialValues={{ due: initial }}
        onSubmit={onSubmit}
        submitLabel="Save"
      />,
      { dict },
    )

    const trigger = await waitFor(() => {
      const element = document.querySelector('[data-slot="date-picker-trigger"]')
      if (!element) throw new Error('DatePicker trigger not rendered yet')
      return element as HTMLElement
    })
    await act(async () => {
      fireEvent.click(trigger)
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    const dayButton = within(screen.getByRole('grid')).getByText('15').closest('button')
    if (!dayButton) throw new Error('Day 15 button not found')
    await act(async () => {
      fireEvent.click(dayButton)
    })

    await mousePress(screen.getAllByRole('button', { name: 'Save' })[0])

    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ due: expected })
  })
})
