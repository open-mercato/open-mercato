/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { MessageComposer } from '../MessageComposer'
import { apiCall } from '../../utils/apiCall'
import { flash } from '../../FlashMessages'

jest.mock('../../utils/apiCall', () => ({
  apiCall: jest.fn(),
}))

jest.mock('../../FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('../ObjectAttachmentPicker', () => ({
  ObjectAttachmentPicker: () => null,
}))

jest.mock('../MessageAttachmentPicker', () => ({
  MessageAttachmentPicker: () => null,
}))

describe('MessageComposer draft flow', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    ;(apiCall as jest.Mock).mockImplementation((url: string, options?: { method?: string, body?: string }) => {
      if (url.startsWith('/api/messages/types')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          result: {
            items: [{
              type: 'default',
              module: 'messages',
              labelKey: 'messages.types.default',
              icon: 'mail',
              allowReply: true,
              allowForward: true,
              isCreateableByUser: true,
            }],
          },
          response: { status: 200 },
        })
      }

      if (url.startsWith('/api/messages/object-types')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          result: { items: [] },
          response: { status: 200 },
        })
      }

      if (url === '/api/messages' && options?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          status: 200,
          result: { id: 'message-1' },
          response: { status: 200 },
        })
      }

      return Promise.resolve({
        ok: true,
        status: 200,
        result: { items: [] },
        response: { status: 200 },
      })
    })
  })

  it('submits compose payload with isDraft=true from Save draft action', async () => {
    renderWithProviders(
      <MessageComposer inline variant="compose" />,
      { dict: {} },
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Save draft' }))

    await waitFor(() => {
      expect(apiCall).toHaveBeenCalledWith(
        '/api/messages',
        expect.objectContaining({
          method: 'POST',
        }),
      )
    })

    const composeRequest = (apiCall as jest.Mock).mock.calls.find(
      (call) => call[0] === '/api/messages' && call[1]?.method === 'POST',
    )
    const payload = JSON.parse(composeRequest?.[1]?.body ?? '{}') as Record<string, unknown>
    expect(payload.isDraft).toBe(true)
    expect(flash).toHaveBeenCalledWith('Draft saved.', 'success')
  })
})

