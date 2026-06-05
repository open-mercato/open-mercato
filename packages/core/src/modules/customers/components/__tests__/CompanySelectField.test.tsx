/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// Radix Select uses pointer capture / scrollIntoView APIs that jsdom lacks.
if (typeof window !== 'undefined') {
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false
  if (!Element.prototype.releasePointerCapture)
    Element.prototype.releasePointerCapture = () => undefined
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => undefined
}

const mockReadApiResultOrThrow = jest.fn()
const mockApiCallOrThrow = jest.fn()
const mockApiCall = jest.fn()
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: (...args: unknown[]) => mockReadApiResultOrThrow(...args),
  apiCallOrThrow: (...args: unknown[]) => mockApiCallOrThrow(...args),
  apiCall: (...args: unknown[]) => mockApiCall(...args),
}))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('@open-mercato/ui/backend/CrudForm', () => ({}))
jest.mock('../AddressTiles', () => ({ CustomerAddressTiles: () => null }))
jest.mock('../detail/RolesSection', () => ({ RolesSection: () => null }))
jest.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({}) }))
jest.mock('@open-mercato/core/modules/dictionaries/components/DictionaryEntrySelect', () => ({
  DictionaryEntrySelect: () => null,
  __esModule: true,
}))
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => (k: string, f?: string) => f ?? k }))

import { CompanySelectField } from '../formConfig'

const labels = {
  placeholder: 'Select company',
  addLabel: 'Add company',
  dialogTitle: 'Add company',
  inputLabel: 'Name',
  inputPlaceholder: 'Name',
  emptyError: 'Required',
  cancelLabel: 'Cancel',
  saveLabel: 'Save',
  errorLoad: 'Failed to load',
  errorSave: 'Failed to save',
  loadingLabel: 'Loading',
}

const cappedList = {
  items: [
    { id: 'co-visible', display_name: 'Visible Company' },
  ],
}

describe('CompanySelectField', () => {
  beforeEach(() => {
    mockReadApiResultOrThrow.mockReset()
    mockApiCallOrThrow.mockReset()
    mockApiCall.mockReset()
  })

  it('seeds a saved company missing from the capped list via the ?ids= filter', async () => {
    mockReadApiResultOrThrow.mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('ids=co-omitted')) {
        return Promise.resolve({ items: [{ id: 'co-omitted', display_name: 'Omitted Company' }] })
      }
      return Promise.resolve(cappedList)
    })

    render(<CompanySelectField value="co-omitted" onChange={jest.fn()} labels={labels} />)

    await waitFor(() => {
      const calledIdsFetch = mockReadApiResultOrThrow.mock.calls.some(
        (call) => typeof call[0] === 'string' && (call[0] as string).includes('ids=co-omitted'),
      )
      expect(calledIdsFetch).toBe(true)
    })

    // The saved company becomes an available option once seeded.
    const trigger = screen.getByRole('combobox')
    fireEvent.pointerDown(
      trigger,
      new MouseEvent('pointerdown', { bubbles: true, button: 0 }) as unknown as PointerEvent,
    )
    await waitFor(() => {
      expect(screen.getAllByText('Omitted Company').length).toBeGreaterThan(0)
    })
  })

  it('does not issue an ?ids= seed fetch when the saved company is already in the list', async () => {
    mockReadApiResultOrThrow.mockResolvedValue(cappedList)

    render(<CompanySelectField value="co-visible" onChange={jest.fn()} labels={labels} />)

    // Allow the load + potential seed effect to settle.
    await waitFor(() => expect(mockReadApiResultOrThrow).toHaveBeenCalled())
    await Promise.resolve()

    const calledIdsFetch = mockReadApiResultOrThrow.mock.calls.some(
      (call) => typeof call[0] === 'string' && (call[0] as string).includes('ids='),
    )
    expect(calledIdsFetch).toBe(false)
  })
})
