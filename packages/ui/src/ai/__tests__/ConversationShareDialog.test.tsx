/** @jest-environment jsdom */

import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { ConversationShareDialog } from '../ConversationShareDialog'
import { apiCall } from '../../backend/utils/apiCall'

jest.mock('../../backend/utils/apiCall', () => ({ apiCall: jest.fn() }))
jest.mock('../../backend/utils/useCurrentUserId', () => ({ useCurrentUserId: () => 'owner-1' }))
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (
    _key: string,
    fallback: string,
    params?: Record<string, string | number>,
  ) => fallback.replace(/\{(\w+)\}/g, (match, name) => String(params?.[name] ?? match)),
}))

const mockApiCall = apiCall as jest.MockedFunction<typeof apiCall>

describe('ConversationShareDialog', () => {
  beforeEach(() => {
    mockApiCall.mockImplementation(async (url) => {
      if (url === '/api/auth/users?limit=200') {
        return {
          ok: true,
          result: {
            items: [
              { id: 'user-1', name: 'Alex Chen', email: 'alex@example.com' },
              { id: 'user-2', name: 'Taylor Reed', email: 'taylor@example.com' },
            ],
          },
        } as never
      }
      return {
        ok: true,
        result: {
          ownerUserId: 'owner-1',
          participants: [
            { userId: 'user-1', role: 'viewer', lastReadAt: null, addedAt: '2026-09-28' },
            { userId: 'user-2', role: 'viewer', lastReadAt: null, addedAt: '2026-09-28' },
          ],
        },
      } as never
    })
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  it('identifies which participant each remove button acts on', async () => {
    render(
      <ConversationShareDialog open onOpenChange={jest.fn()} conversationId="conversation-1" />,
    )

    expect(
      await screen.findByRole('button', { name: 'Remove Alex Chen — alex@example.com' }),
    ).toBeEnabled()
    expect(
      screen.getByRole('button', { name: 'Remove Taylor Reed — taylor@example.com' }),
    ).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument()
  })
})
