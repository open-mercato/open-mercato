/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { act, renderHook } from '@testing-library/react'
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

describe('useMessageCompose draft attachment ids', () => {
  beforeEach(() => {
    jest.resetAllMocks()
  })

  it('pages through every draft attachment so a save never drops attachments past the first page (#3816)', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({ id: `att-${index}` }))
    ;(apiCall as jest.Mock).mockImplementation(async (url: string) => {
      const requested = new URL(`http://localhost${url}`)
      const page = requested.searchParams.get('page')
      if (!page) {
        return { ok: true, status: 200, result: { items: firstPage }, response: { status: 200 } }
      }
      const items = page === '1' ? firstPage : page === '2' ? [{ id: 'att-100' }] : []
      return {
        ok: true,
        status: 200,
        result: { items, total: 101, page: Number(page), pageSize: 100, totalPages: 2 },
        response: { status: 200 },
      }
    })

    const { result } = renderHook(() => useMessageCompose({ variant: 'compose', messageId: 'message-1' }), {
      wrapper: createWrapper(),
    })

    let loadedIds: string[] = []
    await act(async () => {
      loadedIds = await result.current.loadAttachmentIds()
    })

    expect(loadedIds).toHaveLength(101)
    expect(loadedIds).toContain('att-100')
    const attachmentCalls = (apiCall as jest.Mock).mock.calls
      .map(([url]) => new URL(`http://localhost${url}`))
      .filter((url) => url.pathname === '/api/attachments')
    expect(attachmentCalls).toHaveLength(2)
    for (const url of attachmentCalls) {
      expect(url.searchParams.get('entityId')).toBe('messages:message')
      expect(url.searchParams.get('recordId')).toBe('message-1')
      expect(url.searchParams.get('pageSize')).toBe('100')
    }
    expect(attachmentCalls.map((url) => url.searchParams.get('page'))).toEqual(['1', '2'])
  })

  function mockAttachmentPages(pages: Record<string, { ok?: boolean; items: Array<{ id: string }>; total?: number; totalPages?: number }>) {
    ;(apiCall as jest.Mock).mockImplementation(async (url: string) => {
      const requested = new URL(`http://localhost${url}`)
      const entry = pages[requested.searchParams.get('page') ?? ''] ?? { items: [] }
      const ok = entry.ok ?? true
      return {
        ok,
        status: ok ? 200 : 500,
        result: ok ? { items: entry.items, total: entry.total, totalPages: entry.totalPages } : { error: 'boom' },
        response: { status: ok ? 200 : 500 },
      }
    })
  }

  function renderDraftCompose() {
    return renderHook(() => useMessageCompose({ variant: 'compose', messageId: 'message-1' }), {
      wrapper: createWrapper(),
    })
  }

  it('refuses to return a partial id list when the pages hold fewer ids than the reported total (#3816)', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({ id: `att-${index}` }))
    mockAttachmentPages({
      '1': { items: firstPage, total: 102, totalPages: 2 },
      '2': { items: [{ id: 'att-99' }, { id: 'att-100' }], total: 102, totalPages: 2 },
    })
    const { result } = renderDraftCompose()

    await act(async () => {
      await expect(result.current.loadAttachmentIds()).rejects.toThrow('Failed to load attachments.')
    })
  })

  it('stops after one page when the response carries no paging totals', async () => {
    mockAttachmentPages({ '1': { items: [{ id: 'att-a' }, { id: 'att-b' }] } })
    const { result } = renderDraftCompose()

    let loadedIds: string[] = []
    await act(async () => {
      loadedIds = await result.current.loadAttachmentIds()
    })

    expect(loadedIds).toEqual(['att-a', 'att-b'])
    expect((apiCall as jest.Mock).mock.calls).toHaveLength(1)
  })

  it('fails instead of returning the first page when a later page errors', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({ id: `att-${index}` }))
    mockAttachmentPages({
      '1': { items: firstPage, total: 150, totalPages: 2 },
      '2': { ok: false, items: [] },
    })
    const { result } = renderDraftCompose()

    await act(async () => {
      await expect(result.current.loadAttachmentIds()).rejects.toThrow('boom')
    })
  })
})
