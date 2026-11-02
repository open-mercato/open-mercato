/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { useMessageCompose } from '../useMessageCompose'
import { apiCall, withScopedApiRequestHeaders } from '../../utils/apiCall'
import type { MessageSenderOption } from '../message-composer.types'

jest.mock('../../utils/apiCall', () => ({
  apiCall: jest.fn(),
  withScopedApiRequestHeaders: jest.fn((_headers: unknown, run: () => unknown) => run()),
}))

jest.mock('../../FlashMessages', () => ({
  flash: jest.fn(),
}))

const senderOptions: MessageSenderOption[] = [
  { id: 'mailbox-primary', label: 'Primary inbox', description: 'me@example.com', isDefault: true },
  { id: 'mailbox-other', label: 'Other inbox', description: 'other@example.com' },
]

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        {/* @ts-expect-error shared provider accepts a loose dict shape */}
        <I18nProvider locale="en" dict={{}}>
          {children}
        </I18nProvider>
      </QueryClientProvider>
    )
  }
}

function mockApiCall(overrides: (url: string) => unknown = () => null) {
  ;(withScopedApiRequestHeaders as jest.Mock).mockImplementation(
    (_headers: unknown, run: () => unknown) => run(),
  )
  ;(apiCall as jest.Mock).mockImplementation(async (url: string) => {
    const override = overrides(url)
    if (override) return override
    if (url.startsWith('/api/messages/types')) {
      return {
        ok: true,
        status: 200,
        result: { items: [{ type: 'default', module: 'messages', labelKey: 'default', icon: 'mail', allowReply: true, allowForward: true, isCreateableByUser: true }] },
      }
    }
    return { ok: true, status: 200, result: { items: [] } }
  })
}

function findComposeCall(): [string, { method?: string; body?: string }] | undefined {
  return (apiCall as jest.Mock).mock.calls.find(
    ([url, init]) => url === '/api/messages' && init?.method === 'POST',
  ) as [string, { method?: string; body?: string }] | undefined
}

/**
 * A successful send parks `handleSubmit` on a promise the composer only resolves
 * when it next closes, so the call is awaited through the request it made rather
 * than through its return value.
 */
async function submitAndReadPayload(
  submit: () => Promise<boolean>,
): Promise<Record<string, unknown>> {
  await act(async () => {
    void submit()
  })
  await waitFor(() => expect(findComposeCall()).toBeDefined())
  return JSON.parse(findComposeCall()![1].body as string) as Record<string, unknown>
}

async function fillExternalCompose(result: { current: ReturnType<typeof useMessageCompose> }) {
  await waitFor(() => expect(result.current.createableMessageTypes.length).toBeGreaterThan(0))
  act(() => {
    result.current.setVisibility('public')
    result.current.setExternalEmail('client@example.com')
    result.current.setSubject('Quote')
    result.current.setBody('Here it is')
  })
}

describe('useMessageCompose sender selection', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    mockApiCall()
  })

  it('offers no senders until the compose addresses an external recipient', async () => {
    const { result } = renderHook(
      () => useMessageCompose({ variant: 'compose', inline: true, senderOptions }),
      { wrapper: createWrapper() },
    )

    expect(result.current.senderOptions).toEqual([])

    act(() => {
      result.current.setVisibility('public')
    })

    expect(result.current.senderOptions).toEqual(senderOptions)
  })

  it('defaults to the platform sender and posts the unchanged payload', async () => {
    const { result } = renderHook(
      () => useMessageCompose({ variant: 'compose', inline: true, senderOptions }),
      { wrapper: createWrapper() },
    )

    await fillExternalCompose(result)
    expect(result.current.senderChannelId).toBe('')

    const payload = await submitAndReadPayload(() => result.current.handleSubmit())

    expect(payload).not.toHaveProperty('senderChannelId')
  })

  it('posts the chosen mailbox on the send', async () => {
    const { result } = renderHook(
      () => useMessageCompose({ variant: 'compose', inline: true, senderOptions }),
      { wrapper: createWrapper() },
    )

    await fillExternalCompose(result)
    act(() => {
      result.current.setSenderChannelId('mailbox-other')
    })

    const payload = await submitAndReadPayload(() => result.current.handleSubmit())

    expect(payload.senderChannelId).toBe('mailbox-other')
  })

  it('drops a mailbox that is no longer offered', async () => {
    const { result } = renderHook(
      () => useMessageCompose({ variant: 'compose', inline: true, senderOptions }),
      { wrapper: createWrapper() },
    )

    await fillExternalCompose(result)
    act(() => {
      result.current.setSenderChannelId('mailbox-other')
      result.current.setVisibility('internal')
    })

    expect(result.current.senderChannelId).toBe('')
  })

  it('never routes a saved draft through a mailbox', async () => {
    const { result } = renderHook(
      () => useMessageCompose({ variant: 'compose', inline: true, senderOptions }),
      { wrapper: createWrapper() },
    )

    await fillExternalCompose(result)
    act(() => {
      result.current.setSenderChannelId('mailbox-other')
    })

    const payload = await submitAndReadPayload(() =>
      result.current.handleSubmit({ saveAsDraft: true }),
    )

    expect(payload).not.toHaveProperty('senderChannelId')
  })

  it('surfaces a send-as-user 422 as a field error on the sender control', async () => {
    mockApiCall((url) =>
      url === '/api/messages'
        ? {
            ok: false,
            status: 422,
            result: {
              error: 'This channel needs reconnection before it can send messages.',
              fieldErrors: {
                senderChannelId: 'This channel needs reconnection before it can send messages.',
              },
            },
          }
        : null,
    )

    const { result } = renderHook(
      () => useMessageCompose({ variant: 'compose', inline: true, senderOptions }),
      { wrapper: createWrapper() },
    )

    await fillExternalCompose(result)
    act(() => {
      result.current.setSenderChannelId('mailbox-other')
    })

    await act(async () => {
      await result.current.handleSubmit()
    })

    expect(result.current.submitFieldErrors).toEqual({
      senderChannelId: 'This channel needs reconnection before it can send messages.',
    })
  })
})
