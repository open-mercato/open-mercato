/** @jest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { EntitySettingsManager } from '../EntitySettingsManager'

const mockTranslate = (key: string, fallback?: string) => fallback ?? key

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({ useT: () => mockTranslate }))
jest.mock('@open-mercato/ui/backend/utils/api', () => ({ apiFetch: jest.fn() }))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: ({ operation }: { operation: () => Promise<unknown> }) => operation(),
  }),
}))

const mockApiFetch = jest.mocked(apiFetch)

beforeEach(() => {
  jest.clearAllMocks()
  mockApiFetch.mockResolvedValueOnce(new Response(JSON.stringify({
    newEntitiesRestrictedByDefault: false,
    updatedAt: null,
  })))
})

test('shows the translated storage error and preserves the selection for a retry', async () => {
  const message = 'Moduł konfiguracji jest wyłączony.'
  mockApiFetch
    .mockResolvedValueOnce(new Response(JSON.stringify({ error: message }), { status: 503 }))
    .mockResolvedValueOnce(new Response(JSON.stringify({
      ok: true,
      newEntitiesRestrictedByDefault: true,
      updatedAt: '2026-11-24T13:00:00.000Z',
    })))

  render(<EntitySettingsManager />)

  const checkbox = await screen.findByRole('checkbox')
  const save = screen.getByRole('button', { name: 'Save' })
  fireEvent.click(checkbox)
  fireEvent.click(save)

  expect(await screen.findByRole('alert')).toHaveTextContent(message)
  expect(checkbox).toBeChecked()
  expect(save).toBeEnabled()
  expect(flash).not.toHaveBeenCalled()

  fireEvent.click(save)
  await waitFor(() => expect(flash).toHaveBeenCalledWith('Settings saved', 'success'))
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  expect(mockApiFetch).toHaveBeenLastCalledWith('/api/entities/entity-settings', expect.objectContaining({
    method: 'PUT',
    body: JSON.stringify({ newEntitiesRestrictedByDefault: true }),
  }))
})

test('shows the localized fallback for a failed network request', async () => {
  mockApiFetch.mockRejectedValueOnce(new TypeError('Network error'))

  render(<EntitySettingsManager />)
  fireEvent.click(await screen.findByRole('button', { name: 'Save' }))

  expect(await screen.findByRole('alert')).toHaveTextContent('Failed to save settings')
})
