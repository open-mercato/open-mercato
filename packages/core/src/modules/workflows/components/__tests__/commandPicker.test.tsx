/**
 * @jest-environment jsdom
 *
 * The UPDATE_ENTITY command picker must not lie.
 *
 * Offering a command the tenant has not enabled is how an author ships a
 * workflow that fails on its first run — this module's recurring bug class. But
 * the field accepts free text, so simply dropping the disabled candidates would
 * turn a runtime failure into an unanswerable absence. So: only enabled
 * candidates are OFFERED, disabled ones are still SHOWN with the remedy, and a
 * value already pointing at something unavailable is called out.
 */
import * as React from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { CommandPicker } from '../fields/CommandPicker'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
}))

const apiCallMock = apiCall as jest.Mock

const UNAVAILABLE_TITLE_KEY = 'workflows.commandPicker.unavailableTitle'
const UNAVAILABLE_HINT_KEY = 'workflows.commandPicker.unavailableHint'
const SELECTED_DISABLED_KEY = 'workflows.commandPicker.selectedDisabled'
const SELECTED_UNKNOWN_KEY = 'workflows.commandPicker.selectedUnknown'

const catalogue = [
  { commandId: 'sales.orders.update', labelKey: null, enabled: true, defaultEnabled: true },
  { commandId: 'catalog.products.update', labelKey: null, enabled: false, defaultEnabled: false },
]

function renderPicker(value = '') {
  return renderWithProviders(<CommandPicker value={value} onChange={() => {}} />)
}

/** Focus + type opens the suggestion list and triggers the debounced load. */
async function openSuggestions() {
  const input = screen.getByRole('combobox')
  await act(async () => {
    fireEvent.focus(input)
    fireEvent.change(input, { target: { value: 'update' } })
  })
  await act(async () => {
    jest.advanceTimersByTime(300)
  })
}

beforeEach(() => {
  jest.useFakeTimers()
  apiCallMock.mockReset()
  apiCallMock.mockResolvedValue({ ok: true, result: { items: catalogue } })
})

afterEach(() => {
  jest.useRealTimers()
})

describe('CommandPicker', () => {
  it('offers only the commands the tenant has enabled', async () => {
    renderPicker()
    await openSuggestions()

    await waitFor(() => {
      expect(screen.getByRole('option', { name: /sales\.orders\.update/ })).toBeInTheDocument()
    })
    expect(screen.queryByRole('option', { name: /catalog\.products\.update/ })).toBeNull()
  })

  it('still shows the disabled candidates, with the remedy', async () => {
    renderPicker()
    await openSuggestions()

    await waitFor(() => {
      expect(screen.getByText(UNAVAILABLE_TITLE_KEY)).toBeInTheDocument()
    })
    expect(screen.getByText(UNAVAILABLE_HINT_KEY)).toBeInTheDocument()
    expect(screen.getByText('catalog.products.update')).toBeInTheDocument()
  })

  it('warns when the authored value is a candidate the tenant has not enabled', async () => {
    renderPicker('catalog.products.update')
    await openSuggestions()

    await waitFor(() => {
      expect(screen.getByText(SELECTED_DISABLED_KEY)).toBeInTheDocument()
    })
  })

  it('warns when the authored value is not in the catalogue at all', async () => {
    renderPicker('auth.users.delete')
    await openSuggestions()

    await waitFor(() => {
      expect(screen.getByText(SELECTED_UNKNOWN_KEY)).toBeInTheDocument()
    })
  })

  it('does not warn about an enabled value', async () => {
    renderPicker('sales.orders.update')
    await openSuggestions()

    await waitFor(() => {
      expect(screen.getByText(UNAVAILABLE_TITLE_KEY)).toBeInTheDocument()
    })
    expect(screen.queryByText(SELECTED_DISABLED_KEY)).toBeNull()
    expect(screen.queryByText(SELECTED_UNKNOWN_KEY)).toBeNull()
  })

  it('treats a response without the enabled flag as enabled, so an older server still works', async () => {
    apiCallMock.mockResolvedValue({ ok: true, result: { items: [{ commandId: 'sales.orders.update' }] } })

    renderPicker('sales.orders.update')
    await openSuggestions()

    await waitFor(() => {
      expect(screen.getByRole('option', { name: /sales\.orders\.update/ })).toBeInTheDocument()
    })
    expect(screen.queryByText(UNAVAILABLE_TITLE_KEY)).toBeNull()
    expect(screen.queryByText(SELECTED_DISABLED_KEY)).toBeNull()
  })
})
