/** @jest-environment jsdom */

import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { PersonEmailThreadsTab } from '../PersonEmailThreadsTab'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({ apiCall: jest.fn() }))
jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({ runMutation: jest.fn(), retryLastMutation: jest.fn() }),
}))
jest.mock('@open-mercato/ui/backend/injection/useAppEvent', () => ({ useAppEvent: jest.fn() }))
jest.mock('../ComposeEmailDialog', () => ({ ComposeEmailDialog: () => null }))
jest.mock('../PersonEmailShareControl', () => ({ PersonEmailShareControl: () => null }))

it('lets a viewer load and refresh email threads without listing or syncing mailboxes', async () => {
  const mockApiCall = jest.mocked(apiCall)
  mockApiCall.mockResolvedValue({
    ok: true,
    result: { threads: [] },
    status: 200,
    response: new Response(),
  })

  renderWithProviders(
    <PersonEmailThreadsTab personId="person-1" canCompose={false} canConnectMailbox={false} />,
  )

  const refreshButton = screen.getByRole('button', { name: 'Refresh' })
  await waitFor(() => expect(refreshButton).toBeEnabled())
  fireEvent.click(refreshButton)
  await waitFor(() => expect(refreshButton).toBeEnabled())

  expect(mockApiCall.mock.calls.map(([url]) => url)).toEqual([
    '/api/customers/people/person-1/email-threads',
    '/api/customers/people/person-1/email-threads',
  ])
  expect(screen.queryByRole('link', { name: 'Connect your mailbox' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'New email' })).not.toBeInTheDocument()
})
