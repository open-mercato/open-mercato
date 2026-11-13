/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import ChannelInfoPanelWidget from '../widget.client'

const mockTranslate = (key: string, fallback?: string) => fallback ?? key

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => mockTranslate,
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: jest.fn(),
    retryLastMutation: jest.fn(),
  }),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

const ASSIGNEE_ID = 'fb0f0076-0d5b-40e7-9996-ab9a2ece9e14'

const message = {
  id: 'msg-1',
  threadId: 'thread-1',
  _channel: {
    providerKey: 'imap',
    channelType: 'email',
    direction: 'outbound',
    deliveryStatus: 'failed',
  },
  _channelContact: {
    contactPersonId: null,
    assignedUserId: ASSIGNEE_ID,
    subject: 'test 2',
  },
}

function renderPanel(userFeatures: string[]) {
  return render(
    <ChannelInfoPanelWidget
      data={message}
      context={{ userFeatures }}
      onDataChange={() => {}}
    />,
  )
}

describe('ChannelInfoPanelWidget assignee label', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(apiCall as jest.Mock).mockResolvedValue({
      ok: true,
      result: {
        items: [
          { id: 'user-2', email: 'employee@acme.com', name: null },
          { id: ASSIGNEE_ID, email: 'admin@acme.com', name: null },
        ],
      },
    })
  })

  it('shows the assignee email in the closed dropdown without opening it', async () => {
    renderPanel(['communication_channels.assign'])

    const trigger = screen.getByRole('combobox', { name: 'Assigned to' })
    await waitFor(() => expect(trigger.textContent).toContain('admin@acme.com'))
    expect(trigger.textContent).not.toContain(ASSIGNEE_ID)
    expect(apiCall).toHaveBeenCalledTimes(1)
    expect((apiCall as jest.Mock).mock.calls[0][0]).toBe('/api/auth/users?page=1&pageSize=50')
  })

  it('does not fetch users when the viewer cannot reassign', async () => {
    renderPanel([])

    await waitFor(() => expect(screen.getByText(ASSIGNEE_ID)).toBeTruthy())
    expect(apiCall).not.toHaveBeenCalled()
  })
})
