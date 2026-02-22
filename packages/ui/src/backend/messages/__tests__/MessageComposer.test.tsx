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

jest.mock('../../confirm-dialog', () => ({
  useConfirmDialog: () => ({
    confirm: jest.fn(),
    ConfirmDialogElement: null,
  }),
}))

jest.mock('../../detail/AttachmentsSection', () => ({
  AttachmentsSection: () => null,
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
}))

jest.mock('remark-gfm', () => ({ __esModule: true, default: {} }))

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

  it('cancels dialog composer without saving draft', async () => {
    const onCancel = jest.fn()
    const onOpenChange = jest.fn()

    renderWithProviders(
      <MessageComposer open variant="compose" onCancel={onCancel} onOpenChange={onOpenChange} />,
      { dict: {} },
    )

    fireEvent.click(await screen.findByRole('button', { name: /cancel|ui\.forms\.actions\.cancel/i }))

    await waitFor(() => {
      expect(onOpenChange).toHaveBeenCalledWith(false)
      expect(onCancel).toHaveBeenCalledTimes(1)
    })

    const composeRequest = (apiCall as jest.Mock).mock.calls.find(
      (call) => call[0] === '/api/messages' && call[1]?.method === 'POST',
    )
    expect(composeRequest).toBeUndefined()
  })

  it('cancels inline composer on Escape without saving draft', async () => {
    const onCancel = jest.fn()

    renderWithProviders(
      <MessageComposer inline variant="compose" onCancel={onCancel} />,
      { dict: {} },
    )

    fireEvent.keyDown(await screen.findByPlaceholderText('Search recipients...'), { key: 'Escape' })

    await waitFor(() => {
      expect(onCancel).toHaveBeenCalledTimes(1)
    })

    const composeRequest = (apiCall as jest.Mock).mock.calls.find(
      (call) => call[0] === '/api/messages' && call[1]?.method === 'POST',
    )
    expect(composeRequest).toBeUndefined()
  })

  it('submits reply payload with recipients when provided', async () => {
    renderWithProviders(
      <MessageComposer
        inline
        variant="reply"
        messageId="message-1"
        defaultValues={{
          body: 'Reply body',
          recipients: ['11111111-1111-4111-8111-111111111111'],
        }}
      />,
      { dict: {} },
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Reply' }))

    await waitFor(() => {
      expect(apiCall).toHaveBeenCalledWith(
        '/api/messages/message-1/reply',
        expect.objectContaining({
          method: 'POST',
        }),
      )
    })

    const replyRequest = (apiCall as jest.Mock).mock.calls.find(
      (call) => call[0] === '/api/messages/message-1/reply' && call[1]?.method === 'POST',
    )
    const payload = JSON.parse(replyRequest?.[1]?.body ?? '{}') as Record<string, unknown>
    expect(payload.recipients).toEqual([{ userId: '11111111-1111-4111-8111-111111111111', type: 'to' }])
  })
})
