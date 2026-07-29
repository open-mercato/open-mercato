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
