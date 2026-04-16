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
})
