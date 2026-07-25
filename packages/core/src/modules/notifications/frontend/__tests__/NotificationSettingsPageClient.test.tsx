/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { NotificationSettingsPageClient } from '../NotificationSettingsPageClient'

const apiCallMock = jest.fn()
const readApiResultOrThrowMock = jest.fn()
const runMutationMock = jest.fn()
const retryLastMutation = jest.fn(async () => true)

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
  readApiResultOrThrow: (...args: unknown[]) => readApiResultOrThrowMock(...args),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: (...args: unknown[]) => runMutationMock(...args),
    retryLastMutation,
  }),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

type RunMutationInput = {
  context: { resourceKind: string; retryLastMutation: () => Promise<boolean> }
  mutationPayload: Record<string, unknown>
}

const savedSettings = {
  panelPath: '/backend/notifications',
  strategies: {
    database: { enabled: true },
    email: { enabled: true },
    custom: {},
  },
}

describe('NotificationSettingsPageClient guarded mutation', () => {
  beforeEach(() => {
    apiCallMock.mockReset()
    apiCallMock.mockResolvedValue({ ok: true, result: { settings: savedSettings } })
    readApiResultOrThrowMock.mockReset()
    readApiResultOrThrowMock.mockResolvedValue({ settings: savedSettings })
    runMutationMock.mockReset()
    runMutationMock.mockImplementation(
      async ({ operation }: { operation: () => Promise<unknown> }) => operation(),
    )
    retryLastMutation.mockClear()
  })

  it('saves settings through the guarded mutation path', async () => {
    renderWithProviders(<NotificationSettingsPageClient />)

    const saveButton = await screen.findByRole('button', { name: /save settings/i })
    fireEvent.click(saveButton)

    await waitFor(() => {
      expect(runMutationMock).toHaveBeenCalledTimes(1)
    })
    const input = runMutationMock.mock.calls[0][0] as RunMutationInput
    expect(input.context.resourceKind).toBe('notifications.settings')
    expect(input.context.retryLastMutation).toBe(retryLastMutation)
    expect(apiCallMock).toHaveBeenCalledWith(
      '/api/notifications/settings',
      expect.objectContaining({ method: 'POST' }),
    )
  })
})
