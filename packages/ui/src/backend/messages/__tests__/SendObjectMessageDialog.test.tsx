/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { SendObjectMessageDialog } from '../SendObjectMessageDialog'

const messageComposerMock = jest.fn()

jest.mock('../MessageComposer', () => ({
  MessageComposer: (props: Record<string, unknown>) => {
    messageComposerMock(props)
    return null
  },
}))

describe('SendObjectMessageDialog', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('opens composer with object-only defaults', async () => {
    renderWithProviders(
      <SendObjectMessageDialog
        object={{
          entityModule: 'sales',
          entityType: 'order',
          entityId: '11111111-1111-4111-8111-111111111111',
        }}
      />,
      { dict: {} },
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Compose message' }))

    const latestCall = messageComposerMock.mock.calls[messageComposerMock.mock.calls.length - 1]?.[0]
    expect(latestCall).toEqual(expect.objectContaining({
      lockedType: 'messages.defaultWithObjects',
      contextObject: expect.objectContaining({
        entityModule: 'sales',
        entityType: 'order',
      }),
      requiredActionConfig: null,
      open: true,
    }))
  })

  it('passes required action config when provided', async () => {
    renderWithProviders(
      <SendObjectMessageDialog
        object={{
          entityModule: 'staff',
          entityType: 'leave_request',
          entityId: '11111111-1111-4111-8111-111111111111',
        }}
        requiredActionConfig={{
          mode: 'optional',
          options: [{ id: 'approve', label: 'Approve' }],
        }}
      />,
      { dict: {} },
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Compose message' }))

    const latestCall = messageComposerMock.mock.calls[messageComposerMock.mock.calls.length - 1]?.[0]
    expect(latestCall).toEqual(expect.objectContaining({
      requiredActionConfig: {
        mode: 'optional',
        options: [{ id: 'approve', label: 'Approve' }],
      },
      open: true,
    }))
  })
})
