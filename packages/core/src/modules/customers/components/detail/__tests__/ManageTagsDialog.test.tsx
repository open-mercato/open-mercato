/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { ManageTagsDialog } from '../ManageTagsDialog'

const apiCallOrThrowMock = jest.fn()
const readApiResultOrThrowMock = jest.fn()

type KindSetting = {
  kind: string
  selectionMode: 'single' | 'multi'
  visibleInTags: boolean
  sortOrder: number
}

const createdSettings: KindSetting[] = []

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCallOrThrow: (...args: unknown[]) => apiCallOrThrowMock(...args),
  readApiResultOrThrow: (...args: unknown[]) => readApiResultOrThrowMock(...args),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

describe('ManageTagsDialog', () => {
  beforeEach(() => {
    createdSettings.length = 0
    apiCallOrThrowMock.mockReset()
    readApiResultOrThrowMock.mockReset()

    readApiResultOrThrowMock.mockImplementation((url: string) => {
      if (url === '/api/customers/dictionaries/kind-settings') {
        return Promise.resolve({ items: [...createdSettings] })
      }
      if (url.startsWith('/api/customers/dictionaries/')) {
        return Promise.resolve({ items: [] })
      }
      return Promise.resolve({ items: [] })
    })

    apiCallOrThrowMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/customers/dictionaries/kind-settings') {
        const payload = JSON.parse(String(init?.body ?? '{}')) as KindSetting
        createdSettings.push({
          kind: payload.kind,
          selectionMode: payload.selectionMode,
          visibleInTags: payload.visibleInTags,
          sortOrder: payload.sortOrder,
        })
        return Promise.resolve({ ok: true })
      }
      return Promise.resolve({ ok: true })
    })
  })

  it('creates a new custom category and shows it in the category rail', async () => {
    await act(async () => {
      renderWithProviders(<ManageTagsDialog open onClose={jest.fn()} />)
    })

    fireEvent.click(screen.getByRole('button', { name: 'New category' }))
    fireEvent.change(screen.getByPlaceholderText('Category name...'), {
      target: { value: 'Partner stage' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create category' }))

    await waitFor(() => {
      expect(apiCallOrThrowMock).toHaveBeenCalledWith(
        '/api/customers/dictionaries/kind-settings',
        expect.objectContaining({
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
        }),
      )
    })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Partner Stage/ })).toBeInTheDocument()
    })
  })

  it('reorders entries using the up/down arrow buttons', async () => {
    const baseEntries = [
      { id: 'e1', value: 'alpha', label: 'Alpha', color: '#aaaaaa', icon: null, position: 0, is_default: false },
      { id: 'e2', value: 'beta', label: 'Beta', color: '#bbbbbb', icon: null, position: 1, is_default: false },
      { id: 'e3', value: 'gamma', label: 'Gamma', color: '#cccccc', icon: null, position: 2, is_default: false },
    ]

    readApiResultOrThrowMock.mockImplementation((url: string) => {
      if (url === '/api/customers/dictionaries/kind-settings') {
        return Promise.resolve({ items: [] })
      }
      if (url === '/api/customers/dictionaries/statuses') {
        return Promise.resolve({ items: baseEntries })
      }
      return Promise.resolve({ items: [] })
    })

    await act(async () => {
      renderWithProviders(<ManageTagsDialog open onClose={jest.fn()} />)
    })

    // Wait for the statuses category to load entries.
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Move up' }).length).toBe(3)
    })

    const moveUpButtons = screen.getAllByRole('button', { name: 'Move up' })
    const moveDownButtons = screen.getAllByRole('button', { name: 'Move down' })

    // First row: move-up should be disabled (already at top).
    expect(moveUpButtons[0]).toBeDisabled()
    // Last row: move-down should be disabled (already at bottom).
    expect(moveDownButtons[moveDownButtons.length - 1]).toBeDisabled()
    // Middle arrows enabled.
    expect(moveUpButtons[1]).not.toBeDisabled()
    expect(moveDownButtons[0]).not.toBeDisabled()

    // Move Beta (row 2) up — expect Alpha/Beta to swap.
    const labelInputsBefore = screen
      .getAllByRole('textbox')
      .filter((el) => ['Alpha', 'Beta', 'Gamma'].includes((el as HTMLInputElement).value))
    expect((labelInputsBefore[0] as HTMLInputElement).value).toBe('Alpha')
    expect((labelInputsBefore[1] as HTMLInputElement).value).toBe('Beta')

    await act(async () => {
      fireEvent.click(screen.getAllByRole('button', { name: 'Move up' })[1])
    })

    await waitFor(() => {
      const labelInputsAfter = screen
        .getAllByRole('textbox')
        .filter((el) => ['Alpha', 'Beta', 'Gamma'].includes((el as HTMLInputElement).value))
      expect((labelInputsAfter[0] as HTMLInputElement).value).toBe('Beta')
      expect((labelInputsAfter[1] as HTMLInputElement).value).toBe('Alpha')
    })
  })
})
