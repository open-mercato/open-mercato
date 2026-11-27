/**
 * @jest-environment jsdom
 */

// Regression for https://github.com/open-mercato/open-mercato/issues/8804 — an app
// without the scheduler module registers no polling schedules, so connected mailboxes
// only sync on "Poll now" while the profile page looked healthy.

import * as React from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import ProfileCommunicationChannelsPage from '../page'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'

jest.mock('@open-mercato/shared/lib/i18n/context', () => {
  const dict = require('../../../../i18n/en.json') as Record<string, string>
  const translate = (key: string, fallback?: string) => dict[key] ?? fallback ?? key
  return { useT: () => translate }
})

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  PageBody: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  DataTable: () => <div data-testid="data-table-mock" />,
}))

jest.mock('@open-mercato/ui/backend/injection/InjectionSpot', () => ({
  InjectionSpot: () => null,
  useInjectionWidgets: () => ({ widgets: [], loading: false, error: null }),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({ runMutation: jest.fn(), retryLastMutation: jest.fn() }),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
}))

const apiCallMock = apiCall as jest.MockedFunction<typeof apiCall>

const AUTOMATIC_SYNC_OFF = /Automatic sync is off/

async function mountPage(result: Record<string, unknown>) {
  apiCallMock.mockResolvedValue({ ok: true, result } as never)
  await act(async () => {
    render(<ProfileCommunicationChannelsPage />)
  })
  await waitFor(() => expect(apiCallMock).toHaveBeenCalled())
}

const polledChannel = { id: 'imap-1', status: 'connected', supportsRealtimePush: false }
const pushDrivenChannel = { id: 'discord-1', status: 'connected', supportsRealtimePush: true }

describe('profile communication channels — automatic sync notice', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('warns that automatic sync is off when the API reports no scheduler and a channel relies on polling', async () => {
    await mountPage({ items: [polledChannel], automaticSyncEnabled: false })

    expect(await screen.findByText(AUTOMATIC_SYNC_OFF)).toBeInTheDocument()
  })

  it('shows no notice when every connected channel is push-driven', async () => {
    await mountPage({ items: [pushDrivenChannel], automaticSyncEnabled: false })

    await waitFor(() => expect(apiCallMock).toHaveBeenCalledTimes(1))
    expect(screen.queryByText(AUTOMATIC_SYNC_OFF)).not.toBeInTheDocument()
  })

  it('shows no notice before any channel is connected', async () => {
    await mountPage({ items: [], automaticSyncEnabled: false })

    await waitFor(() => expect(apiCallMock).toHaveBeenCalledTimes(1))
    expect(screen.queryByText(AUTOMATIC_SYNC_OFF)).not.toBeInTheDocument()
  })
})
