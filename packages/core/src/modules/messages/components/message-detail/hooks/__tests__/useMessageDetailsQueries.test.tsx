/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { renderHook } from '@testing-library/react'

const apiCallMock = jest.fn()

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
}))

type MockQueryFn = () => Promise<unknown>

let lastDetailQueryFn: MockQueryFn | null = null
let lastAttachmentsQueryFn: MockQueryFn | null = null

jest.mock('@tanstack/react-query', () => ({
  useQuery: (options: { queryKey: unknown[]; queryFn: MockQueryFn }) => {
    if (Array.isArray(options.queryKey) && options.queryKey[3] === 'attachments') {
      lastAttachmentsQueryFn = options.queryFn
    } else {
      lastDetailQueryFn = options.queryFn
    }
    return {
      data: undefined,
      isLoading: false,
      isSuccess: false,
      error: null,
    }
  },
}))

import { useMessageDetailsQueries } from '../useMessageDetailsQueries'

function setupHook(queryClient: { setQueryData: jest.Mock; getQueryData: jest.Mock }) {
  const translate = (_key: string, fallback?: string) => fallback ?? _key
  return renderHook(() =>
    useMessageDetailsQueries({
      id: 'msg-1',
      t: translate,
      scopeVersion: 'scope-1',
      queryClient: queryClient as never,
    }),
  )
}

beforeEach(() => {
  apiCallMock.mockReset()
  lastDetailQueryFn = null
  lastAttachmentsQueryFn = null
})

describe('useMessageDetailsQueries 404 handling', () => {
  it('detail query returns null when the API responds with 404', async () => {
    apiCallMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      result: { error: 'Message not found' },
    })

    const queryClient = { setQueryData: jest.fn(), getQueryData: jest.fn() }
    setupHook(queryClient)
    expect(lastDetailQueryFn).toBeTruthy()

    const result = await lastDetailQueryFn!()
    expect(result).toBeNull()
  })

  it('detail query throws on non-404 failures', async () => {
    apiCallMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      result: { error: 'Boom' },
    })

    const queryClient = { setQueryData: jest.fn(), getQueryData: jest.fn() }
    setupHook(queryClient)
    expect(lastDetailQueryFn).toBeTruthy()

    await expect(lastDetailQueryFn!()).rejects.toThrow('Boom')
  })

  it('attachments query returns an empty list when the parent message is gone', async () => {
    apiCallMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      result: { error: 'Message not found' },
    })

    const queryClient = { setQueryData: jest.fn(), getQueryData: jest.fn() }
    setupHook(queryClient)
    expect(lastAttachmentsQueryFn).toBeTruthy()

    const result = await lastAttachmentsQueryFn!()
    expect(result).toEqual([])
  })
})

describe('useMessageDetailsQueries.refreshDetailWithoutAutoMarkRead', () => {
  it('clears cached detail data when the message is gone', async () => {
    apiCallMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      result: { error: 'Message not found' },
    })

    const setQueryData = jest.fn()
    const queryClient = { setQueryData, getQueryData: jest.fn() }
    const { result } = setupHook(queryClient)

    const refreshed = await result.current.refreshDetailWithoutAutoMarkRead()

    expect(refreshed).toBeNull()
    expect(setQueryData).toHaveBeenCalledWith(
      expect.arrayContaining(['messages', 'detail', 'msg-1']),
      null,
    )
  })

  it('stores the refreshed payload when the API responds successfully', async () => {
    const detail = {
      id: 'msg-1',
      type: 'default',
      typeDefinition: { ui: {} },
    }
    apiCallMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      result: detail,
    })

    const setQueryData = jest.fn()
    const queryClient = { setQueryData, getQueryData: jest.fn() }
    const { result } = setupHook(queryClient)

    const refreshed = await result.current.refreshDetailWithoutAutoMarkRead()

    expect(refreshed).toEqual(detail)
    expect(setQueryData).toHaveBeenCalledWith(
      expect.arrayContaining(['messages', 'detail', 'msg-1']),
      detail,
    )
  })
})

describe('useMessageDetailsQueries.suppressAutoMarkRead (#3576)', () => {
  it('auto-marks read on the initial detail fetch', async () => {
    apiCallMock.mockResolvedValue({ ok: true, status: 200, result: { id: 'msg-1' } })

    const queryClient = { setQueryData: jest.fn(), getQueryData: jest.fn() }
    setupHook(queryClient)
    expect(lastDetailQueryFn).toBeTruthy()

    await lastDetailQueryFn!()
    expect(apiCallMock).toHaveBeenCalledWith('/api/messages/msg-1')
  })

  it('skips auto-mark-read on subsequent refetches once suppressed', async () => {
    apiCallMock.mockResolvedValue({ ok: true, status: 200, result: { id: 'msg-1' } })

    const queryClient = { setQueryData: jest.fn(), getQueryData: jest.fn() }
    const { result } = setupHook(queryClient)
    expect(lastDetailQueryFn).toBeTruthy()

    result.current.suppressAutoMarkRead()
    await lastDetailQueryFn!()

    expect(apiCallMock).toHaveBeenCalledWith('/api/messages/msg-1?skipMarkRead=1')
  })
})

describe('useMessageDetailsQueries derived state', () => {
  it('surfaces a deleted-message error when detail data is null and the query succeeded', () => {
    apiCallMock.mockResolvedValue({ ok: false, status: 404, result: null })

    const queryClient = { setQueryData: jest.fn(), getQueryData: jest.fn() }
    const detailQueryHandle = {
      data: null,
      isLoading: false,
      isSuccess: true,
      error: null,
    }
    const attachmentsQueryHandle = {
      data: [],
      isLoading: false,
      isSuccess: true,
      error: null,
    }

    // Re-mock useQuery for this single test to return the desired query state.
    const reactQueryModule = require('@tanstack/react-query')
    const originalUseQuery = reactQueryModule.useQuery
    reactQueryModule.useQuery = (options: { queryKey: unknown[] }) => {
      if (Array.isArray(options.queryKey) && options.queryKey[3] === 'attachments') {
        return attachmentsQueryHandle
      }
      return detailQueryHandle
    }

    try {
      const { result } = setupHook(queryClient)
      expect(result.current.detail).toBeNull()
      expect(result.current.isDetailMissing).toBe(true)
      expect(result.current.loadErrorMessage).toBe('This message is no longer available.')
    } finally {
      reactQueryModule.useQuery = originalUseQuery
    }
  })
})
