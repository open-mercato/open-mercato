/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
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
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
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

    const dialog = await screen.findByRole('dialog')
    const cancelButtons = within(dialog).getAllByRole('button', { name: 'Cancel' })
    fireEvent.click(cancelButtons[cancelButtons.length - 1] as HTMLButtonElement)

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

  it('uses inline cancel action for embedded reply composer', async () => {
    const onCancel = jest.fn()

    renderWithProviders(
      <MessageComposer inline variant="reply" messageId="message-1" onCancel={onCancel} />,
      { dict: {} },
    )

    fireEvent.click(await screen.findByRole('button', { name: /cancel|ui\.forms\.actions\.cancel/i }))

    await waitFor(() => {
      expect(onCancel).toHaveBeenCalledTimes(1)
    })
  })

  it('does not render back link when inlineBackHref is null', async () => {
    const { container } = renderWithProviders(
      <MessageComposer inline inlineBackHref={null} variant="reply" messageId="message-1" />,
      { dict: {} },
    )

    await screen.findByRole('button', { name: 'Reply' })
    expect(container.querySelector('a[href="/backend/messages"]')).toBeNull()
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

  it('does not load recipient suggestions on initial autofocus and loads them on input click', async () => {
    renderWithProviders(
      <MessageComposer inline variant="compose" />,
      { dict: {} },
    )

    await screen.findByPlaceholderText('Search recipients...')

    await waitFor(() => {
      expect((apiCall as jest.Mock).mock.calls.some(
        (call) => typeof call[0] === 'string' && call[0].startsWith('/api/auth/users?'),
      )).toBe(false)
    })

    fireEvent.mouseDown(screen.getByPlaceholderText('Search recipients...'))

    await waitFor(() => {
      expect(apiCall).toHaveBeenCalledWith(
        expect.stringMatching(/^\/api\/auth\/users\?/),
      )
    })
  })

  it('changes priority selection on click', async () => {
    renderWithProviders(
      <MessageComposer inline variant="compose" />,
      { dict: {} },
    )

    const highPriorityOption = await screen.findByRole('radio', { name: 'High' })
    fireEvent.click(highPriorityOption)

    expect(highPriorityOption).toHaveAttribute('aria-checked', 'true')
  })

  it('changes priority selection with keyboard arrows', async () => {
    renderWithProviders(
      <MessageComposer inline variant="compose" />,
      { dict: {} },
    )

    const priorityGroup = await screen.findByRole('radiogroup', { name: 'Priority' })
    priorityGroup.focus()
    fireEvent.keyDown(priorityGroup, { key: 'ArrowRight' })

    expect(await screen.findByRole('radio', { name: 'High' })).toHaveAttribute('aria-checked', 'true')
  })
})
