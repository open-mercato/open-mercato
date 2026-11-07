/** @jest-environment jsdom */

import * as React from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const mockReadApiResultOrThrow = jest.fn()
const mockScopeVersion = jest.fn(() => 1)

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  readApiResultOrThrow: (...args: unknown[]) => mockReadApiResultOrThrow(...args),
}))
jest.mock('@open-mercato/shared/lib/frontend/useOrganizationScope', () => ({
  useOrganizationScopeVersion: () => mockScopeVersion(),
}))

import { useDealStatusVocabulary } from '../useDealStatusVocabulary'
import { DEFAULT_DEAL_STATUS_VOCABULARY } from '../../../lib/dealStatus'

const tenantVocabulary = { won: ['contract_signed'], lost: ['declined'], closed: ['archived'] }

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe('useDealStatusVocabulary', () => {
  beforeEach(() => {
    mockScopeVersion.mockReturnValue(1)
    mockReadApiResultOrThrow.mockReset()
  })

  it('loads authenticated configuration and shares the request between consumers', async () => {
    mockReadApiResultOrThrow.mockResolvedValue({
      vocabulary: tenantVocabulary,
      source: 'tenant',
      updatedAt: '2026-10-18T10:00:00.000Z',
    })
    const { result } = renderHook(() => ({ first: useDealStatusVocabulary(), second: useDealStatusVocabulary() }), {
      wrapper: createWrapper(),
    })

    await waitFor(() => expect(result.current.first.isLoading).toBe(false))

    expect(result.current.first.vocabulary).toEqual(tenantVocabulary)
    expect(result.current.second.vocabulary).toEqual(tenantVocabulary)
    expect(result.current.first.source).toBe('tenant')
    expect(result.current.first.updatedAt).toBe('2026-10-18T10:00:00.000Z')
    expect(mockReadApiResultOrThrow).toHaveBeenCalledTimes(1)
    expect(mockReadApiResultOrThrow).toHaveBeenCalledWith(
      '/api/customers/settings/deal-status-vocabulary',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
  })

  it('does not keep the previous tenant vocabulary while the scope changes', async () => {
    mockReadApiResultOrThrow.mockResolvedValueOnce({ vocabulary: tenantVocabulary, source: 'tenant', updatedAt: null })
    const { result, rerender } = renderHook(() => useDealStatusVocabulary(), { wrapper: createWrapper() })
    await waitFor(() => expect(result.current.vocabulary).toEqual(tenantVocabulary))
    let resolveNext: (value: unknown) => void = () => {}
    mockReadApiResultOrThrow.mockImplementationOnce(() => new Promise((resolve) => { resolveNext = resolve }))
    mockScopeVersion.mockReturnValue(2)

    rerender()

    expect(result.current.isLoading).toBe(true)
    expect(result.current.vocabulary).toEqual(DEFAULT_DEAL_STATUS_VOCABULARY)
    await act(async () => {
      resolveNext({ vocabulary: DEFAULT_DEAL_STATUS_VOCABULARY, source: 'default', updatedAt: null })
    })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.source).toBe('default')
  })

  it.each([
    { vocabulary: { won: [], lost: ['declined'], closed: ['archived'] }, source: 'tenant', updatedAt: null },
    { vocabulary: tenantVocabulary, source: 'unknown', updatedAt: null },
  ])('fails closed on a malformed response', async (payload) => {
    mockReadApiResultOrThrow.mockResolvedValue(payload)
    const { result } = renderHook(() => useDealStatusVocabulary(), { wrapper: createWrapper() })

    await waitFor(() => expect(result.current.isError).toBe(true))

    expect(result.current.vocabulary).toEqual(DEFAULT_DEAL_STATUS_VOCABULARY)
    expect(result.current.isLoading).toBe(false)
  })
})
