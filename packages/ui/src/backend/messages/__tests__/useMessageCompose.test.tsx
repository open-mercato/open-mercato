/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { useMessageCompose } from '../useMessageCompose'
import { apiCall } from '../../utils/apiCall'

jest.mock('../../utils/apiCall', () => ({
  apiCall: jest.fn(),
}))

jest.mock('../../FlashMessages', () => ({
  flash: jest.fn(),
}))

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

describe('useMessageCompose recipient suggestions', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    ;(apiCall as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      result: { items: [] },
      response: { status: 200 },
    })
  })

  it('scopes recipient suggestions to the composer active organization', async () => {
    const { result } = renderHook(() => useMessageCompose({ variant: 'compose' }), {
      wrapper: createWrapper(),
    })

    await result.current.loadRecipientSuggestions()

    const authUsersCall = (apiCall as jest.Mock).mock.calls.find(
      ([url]) => typeof url === 'string' && url.startsWith('/api/auth/users'),
    )
    expect(authUsersCall).toBeDefined()

    const requestedUrl = new URL(`http://localhost${authUsersCall[0]}`)
    expect(requestedUrl.searchParams.get('scopeToActiveOrganization')).toBe('1')
  })
})

describe('useMessageCompose Escape handling', () => {
  beforeEach(() => {
    jest.resetAllMocks()
    ;(apiCall as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      result: { items: [] },
      response: { status: 200 },
    })
  })

  function buildEscapeEvent(options: { defaultPrevented?: boolean, targetInsideComposer?: boolean }) {
    const composer = document.createElement('div')
    const insideField = document.createElement('input')
    composer.appendChild(insideField)
    const portaledContent = document.createElement('div')
    const preventDefault = jest.fn()
    const event = {
      key: 'Escape',
      metaKey: false,
      ctrlKey: false,
      defaultPrevented: options.defaultPrevented ?? false,
      currentTarget: composer,
      target: options.targetInsideComposer === false ? portaledContent : insideField,
      preventDefault,
    } as unknown as React.KeyboardEvent<HTMLDivElement>
    return { event, preventDefault }
  }

  function renderInlineCompose(onCancel: jest.Mock) {
    return renderHook(() => useMessageCompose({ variant: 'compose', inline: true, onCancel }), {
      wrapper: createWrapper(),
    })
  }

  it('cancels on a plain Escape from inside the composer', () => {
    const onCancel = jest.fn()
    const { result } = renderInlineCompose(onCancel)
    const { event, preventDefault } = buildEscapeEvent({})

    result.current.handleKeyDown(event)

    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('ignores an Escape a nested layer already handled', () => {
    const onCancel = jest.fn()
    const { result } = renderInlineCompose(onCancel)
    const { event, preventDefault } = buildEscapeEvent({ defaultPrevented: true })

    result.current.handleKeyDown(event)

    expect(preventDefault).not.toHaveBeenCalled()
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('ignores an Escape bubbling from portaled content outside the composer', () => {
    const onCancel = jest.fn()
    const { result } = renderInlineCompose(onCancel)
    const { event, preventDefault } = buildEscapeEvent({ targetInsideComposer: false })

    result.current.handleKeyDown(event)

    expect(preventDefault).not.toHaveBeenCalled()
    expect(onCancel).not.toHaveBeenCalled()
  })
})
