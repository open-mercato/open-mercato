/** @jest-environment jsdom */

import * as React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DictionarySelectField } from '../formConfig'
import { DealFormField } from '../detail/create/DealFormField'

const mockQueryClient = {}
const mockTranslate = (key: string, fallback?: string) => fallback ?? key
const mockEnsureCustomerDictionary = jest.fn()

jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => mockQueryClient,
}))

jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeVersion: () => 'test-scope',
}))

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => mockTranslate,
}))

jest.mock('next/navigation', () => ({
  usePathname: () => '/backend/customers/deals/create',
  useSearchParams: () => new URLSearchParams(),
}))

jest.mock('../detail/hooks/useCustomerDictionary', () => ({
  ensureCustomerDictionary: (...args: unknown[]) => mockEnsureCustomerDictionary(...args),
  invalidateCustomerDictionary: jest.fn(),
}))

jest.mock('../AddressTiles', () => ({
  CustomerAddressTiles: () => null,
}))

jest.mock('../detail/RolesSection', () => ({
  RolesSection: () => null,
}))

const labels = {
  placeholder: 'Select a deal status',
  addLabel: 'Add deal status',
  dialogTitle: 'Add deal status',
  valueLabel: 'Value',
  valuePlaceholder: 'Value',
  labelLabel: 'Label',
  labelPlaceholder: 'Display name shown in UI',
  emptyError: 'Value is required',
  cancelLabel: 'Cancel',
  saveLabel: 'Save',
  errorLoad: 'Failed to load options',
  errorSave: 'Failed to save option',
  loadingLabel: 'Loading',
  manageTitle: 'Manage dictionary',
}

describe('Deal status label association', () => {
  beforeEach(() => {
    mockEnsureCustomerDictionary.mockReset().mockResolvedValue({ entries: [] })
  })

  it.each([
    ['explicit', 'status'],
    ['generated', undefined],
  ])('names and focuses the status combobox with %s field IDs', async (_description, fieldId) => {
    render(
      <DealFormField fieldId={fieldId} label="Status">
        <DictionarySelectField
          kind="deal-statuses"
          onChange={jest.fn()}
          labels={labels}
          showActiveAppearance={false}
        />
      </DealFormField>,
    )

    const trigger = screen.getByRole('combobox', { name: 'Status' })
    expect(screen.getByLabelText('Status')).toBe(trigger)
    expect(trigger.id).not.toBe('')
    if (fieldId) expect(trigger).toHaveAttribute('id', fieldId)
    expect(screen.getByText('Status')).toHaveAttribute('for', trigger.id)

    await waitFor(() => expect(trigger).toBeEnabled())
    fireEvent.click(screen.getByText('Status'))
    expect(trigger).toHaveFocus()
  })
})
