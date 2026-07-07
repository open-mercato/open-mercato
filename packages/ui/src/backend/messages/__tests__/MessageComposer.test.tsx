/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import { MessageComposer } from '../MessageComposer'
import { apiCall, withScopedApiRequestHeaders } from '../../utils/apiCall'
import { flash } from '../../FlashMessages'
import { dismissRecordConflict, getRecordConflictForTest } from '../../conflicts'

jest.mock('../../utils/apiCall', () => ({
  apiCall: jest.fn(),
  withScopedApiRequestHeaders: jest.fn((_headers: Record<string, string>, run: () => unknown) => run()),
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

jest.mock('../../injection/useInjectionDataWidgets', () => ({
  useInjectionDataWidgets: () => ({
    widgets: [],
    isLoading: false,
  }),
}))

jest.mock('../../injection/InjectionSpot', () => ({
  InjectionSpot: () => null,
  useInjectionWidgets: () => ({
    widgets: [],
    isLoading: false,
  }),
  useInjectionSpotEvents: () => ({
    triggerEvent: jest.fn(async () => ({ ok: true })),
  }),
}))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))

jest.mock('remark-gfm', () => ({ __esModule: true, default: {} }))

describe('MessageComposer draft flow', () => {
  jest.setTimeout(10000)

  beforeEach(() => {
    jest.resetAllMocks()
    dismissRecordConflict()
    ;(withScopedApiRequestHeaders as jest.Mock).mockImplementation(
      (_headers: Record<string, string>, run: () => unknown) => run(),
    )
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

  it('sends an existing draft via PATCH with isDraft=false', async () => {
    renderWithProviders(
      <MessageComposer
        inline
        variant="compose"
        messageId="draft-1"
        defaultValues={{
          recipients: ['11111111-1111-4111-8111-111111111111'],
          subject: 'Existing draft',
          body: 'Existing draft body',
        }}
      />,
      { dict: {} },
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Send' }))

    await waitFor(() => {
      expect(apiCall).toHaveBeenCalledWith(
        '/api/messages/draft-1',
        expect.objectContaining({
          method: 'PATCH',
        }),
      )
    })

    const updateRequest = (apiCall as jest.Mock).mock.calls.find(
      (call) => call[0] === '/api/messages/draft-1' && call[1]?.method === 'PATCH',
    )
    const payload = JSON.parse(updateRequest?.[1]?.body ?? '{}') as Record<string, unknown>
    expect(payload.isDraft).toBe(false)
    expect(payload.recipients).toEqual([{ userId: '11111111-1111-4111-8111-111111111111', type: 'to' }])
    expect(flash).toHaveBeenCalledWith('Message sent.', 'success')
  })

  it('attaches the optimistic-lock header when sending an existing draft', async () => {
    const expectedUpdatedAt = '2026-02-24T10:00:00.000Z'

    renderWithProviders(
      <MessageComposer
        inline
        variant="compose"
        messageId="draft-1"
        expectedUpdatedAt={expectedUpdatedAt}
        defaultValues={{
          recipients: ['11111111-1111-4111-8111-111111111111'],
          subject: 'Existing draft',
          body: 'Existing draft body',
        }}
      />,
      { dict: {} },
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Send' }))

    await waitFor(() => {
      expect(apiCall).toHaveBeenCalledWith(
        '/api/messages/draft-1',
        expect.objectContaining({ method: 'PATCH' }),
      )
    })

    expect(withScopedApiRequestHeaders).toHaveBeenCalledWith(
      { [OPTIMISTIC_LOCK_HEADER_NAME]: expectedUpdatedAt },
      expect.any(Function),
    )
  })

  it('surfaces a 409 optimistic-lock conflict on the shared banner instead of a generic flash', async () => {
    const expectedUpdatedAt = '2026-02-24T10:00:00.000Z'

    ;(apiCall as jest.Mock).mockImplementation((url: string, options?: { method?: string }) => {
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

      if (url === '/api/messages/draft-1' && options?.method === 'PATCH') {
        return Promise.resolve({
          ok: false,
          status: 409,
          result: {
            error: 'record_modified',
            code: 'optimistic_lock_conflict',
            currentUpdatedAt: '2026-02-24T11:00:00.000Z',
            expectedUpdatedAt,
          },
          response: { status: 409 },
        })
      }

      return Promise.resolve({ ok: true, status: 200, result: { items: [] }, response: { status: 200 } })
    })

    renderWithProviders(
      <MessageComposer
        inline
        variant="compose"
        messageId="draft-1"
        expectedUpdatedAt={expectedUpdatedAt}
        defaultValues={{
          recipients: ['11111111-1111-4111-8111-111111111111'],
          subject: 'Existing draft',
          body: 'Existing draft body',
        }}
      />,
      { dict: {} },
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Send' }))

    await waitFor(() => {
      const conflict = getRecordConflictForTest()
      expect(conflict).not.toBeNull()
      expect(conflict?.currentUpdatedAt).toBe('2026-02-24T11:00:00.000Z')
    })

    expect(flash).not.toHaveBeenCalledWith('Failed to send message.', 'error')
  })

  it('closes the compose dialog on a 409 conflict so the shared banner is not hidden behind it (TC-007)', async () => {
    const expectedUpdatedAt = '2026-02-24T10:00:00.000Z'
    const onOpenChange = jest.fn()

    ;(apiCall as jest.Mock).mockImplementation((url: string, options?: { method?: string }) => {
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

      if (url === '/api/messages/draft-1' && options?.method === 'PATCH') {
        return Promise.resolve({
          ok: false,
          status: 409,
          result: {
            error: 'record_modified',
            code: 'optimistic_lock_conflict',
            currentUpdatedAt: '2026-02-24T11:00:00.000Z',
            expectedUpdatedAt,
          },
          response: { status: 409 },
        })
      }

      return Promise.resolve({ ok: true, status: 200, result: { items: [] }, response: { status: 200 } })
    })

    renderWithProviders(
      <MessageComposer
        open
        variant="compose"
        messageId="draft-1"
        expectedUpdatedAt={expectedUpdatedAt}
        onOpenChange={onOpenChange}
        defaultValues={{
          recipients: ['11111111-1111-4111-8111-111111111111'],
          subject: 'Existing draft',
          body: 'Existing draft body',
        }}
      />,
      { dict: {} },
    )

    const dialog = await screen.findByRole('dialog')
    const sendButtons = within(dialog).getAllByRole('button', { name: 'Send' })
    fireEvent.click(sendButtons[sendButtons.length - 1] as HTMLButtonElement)

    await waitFor(() => {
      expect(getRecordConflictForTest()).not.toBeNull()
    })
    // The page-level conflict banner is hidden behind the modal, so the dialog
    // must close to reveal it (and its Refresh action) to the user.
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('saves an existing draft via PATCH without a draft transition flag', async () => {
    renderWithProviders(
      <MessageComposer
        inline
        variant="compose"
        messageId="draft-1"
        defaultValues={{
          subject: 'Existing draft',
          body: 'Existing draft body',
        }}
      />,
      { dict: {} },
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Save draft' }))

    await waitFor(() => {
      expect(apiCall).toHaveBeenCalledWith(
        '/api/messages/draft-1',
        expect.objectContaining({
          method: 'PATCH',
        }),
      )
    })

    const updateRequest = (apiCall as jest.Mock).mock.calls.find(
      (call) => call[0] === '/api/messages/draft-1' && call[1]?.method === 'PATCH',
    )
    const payload = JSON.parse(updateRequest?.[1]?.body ?? '{}') as Record<string, unknown>
    expect(payload).not.toHaveProperty('isDraft')
    expect(payload).toEqual(expect.objectContaining({
      subject: 'Existing draft',
      body: 'Existing draft body',
    }))
    expect(flash).toHaveBeenCalledWith('Draft saved.', 'success')
  })

  it('keeps the send action disabled after a successful compose submit until the composer resets', async () => {
    let resolveMessagePost!: (value: {
      ok: boolean
      status: number
      result: { id: string }
      response: { status: number }
    }) => void

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
        return new Promise((resolve) => {
          resolveMessagePost = resolve
        })
      }

      return Promise.resolve({
        ok: true,
        status: 200,
        result: { items: [] },
        response: { status: 200 },
      })
    })

    renderWithProviders(
      <MessageComposer
        inline
        variant="compose"
        defaultValues={{
          recipients: ['11111111-1111-4111-8111-111111111111'],
          subject: 'Send lock test',
          body: 'Send lock body',
        }}
      />,
      { dict: {} },
    )

    await waitFor(() => {
      expect((apiCall as jest.Mock).mock.calls.some((call) => call[0] === '/api/messages/types')).toBe(true)
    })

    await act(async () => {
      await Promise.resolve()
    })

    const sendButton = await screen.findByRole('button', { name: /^send$/i })
    fireEvent.click(sendButton)

    await waitFor(() => {
      const messagePostCalls = (apiCall as jest.Mock).mock.calls.filter(
        (call) => call[0] === '/api/messages' && call[1]?.method === 'POST',
      )
      expect(messagePostCalls).toHaveLength(1)
    })

    await waitFor(() => {
      expect(sendButton).toBeDisabled()
    })

    await act(async () => {
      resolveMessagePost({
        ok: true,
        status: 201,
        result: { id: 'message-1' },
        response: { status: 201 },
      })
    })

    await waitFor(() => {
      expect(flash).toHaveBeenCalledWith('Message sent.', 'success')
    })

    expect(sendButton).toBeDisabled()

    fireEvent.click(sendButton)

    await waitFor(() => {
      const messagePostCalls = (apiCall as jest.Mock).mock.calls.filter(
        (call) => call[0] === '/api/messages' && call[1]?.method === 'POST',
      )
      expect(messagePostCalls).toHaveLength(1)
    })
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
        expect.objectContaining({
          headers: expect.objectContaining({
            'x-om-forbidden-redirect': '0',
          }),
        }),
      )
    })
  })

  it('keeps recipient suggestions available for multi-character input when backend search is unreliable', async () => {
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

      if (url.startsWith('/api/auth/users?')) {
        const requestUrl = new URL(url, 'http://localhost')
        const search = requestUrl.searchParams.get('search') ?? ''
        return Promise.resolve({
          ok: true,
          status: 200,
          result: {
            items: search.length <= 1
              ? [{ id: 'user-1', email: 'alice@example.com' }]
              : [],
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

    renderWithProviders(
      <MessageComposer inline variant="compose" />,
      { dict: {} },
    )

    const input = await screen.findByPlaceholderText('Search recipients...')

    fireEvent.mouseDown(input)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'alice@example.com' })).toBeInTheDocument()
    })

    fireEvent.change(input, { target: { value: 'ali' } })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'alice@example.com' })).toBeInTheDocument()
    })

    const authUserCalls = (apiCall as jest.Mock).mock.calls
      .filter((call) => typeof call[0] === 'string' && call[0].startsWith('/api/auth/users?'))
      .map((call) => call[0] as string)

    expect(authUserCalls.every((call) => !call.includes('search='))).toBe(true)
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
