/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import InboxSettingsPage from '../page'

const apiCallMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
  withScopedApiRequestHeaders: (_headers: unknown, fn: () => unknown) => fn(),
}))

jest.mock('@open-mercato/ui/backend/utils/optimisticLock', () => ({
  buildOptimisticLockHeader: () => ({}),
}))

jest.mock('@open-mercato/ui/backend/conflicts', () => ({
  surfaceRecordConflict: () => false,
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: async ({ operation }: { operation: () => Promise<unknown> }) => operation(),
  }),
}))

beforeEach(() => {
  apiCallMock.mockReset()
})

describe('InboxSettingsPage (issue #6232)', () => {
  it('shows the not-found copy, not the generic load-failed error, when settings is null', async () => {
    apiCallMock.mockResolvedValue({ ok: true, result: { settings: null } })

    renderWithProviders(<InboxSettingsPage />)

    await waitFor(() => {
      expect(screen.getByText('No inbox settings found. Settings are created when a new tenant is provisioned.')).toBeTruthy()
    })
    expect(screen.queryByText('Failed to load settings')).toBeNull()
  })

  it('shows the load-failed error when the request itself fails', async () => {
    apiCallMock.mockResolvedValue({ ok: false, result: null })

    renderWithProviders(<InboxSettingsPage />)

    await waitFor(() => {
      expect(screen.getByText('Failed to load settings')).toBeTruthy()
    })
  })

  it('renders the settings when present', async () => {
    apiCallMock.mockResolvedValue({
      ok: true,
      result: { settings: { inboxAddress: 'ops-abc@inbox.mercato.local', isActive: true, workingLanguage: 'en' } },
    })

    renderWithProviders(<InboxSettingsPage />)

    await waitFor(() => {
      expect(screen.getByText('ops-abc@inbox.mercato.local')).toBeTruthy()
    })
  })
})
