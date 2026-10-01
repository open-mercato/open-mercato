/**
 * @jest-environment jsdom
 */

// Regression for https://github.com/open-mercato/open-mercato/issues/6402 — the
// OAuth callback reported its outcome as `?flash=<connected|error>`, which the
// global <FlashMessages> host reads as the message text, so users saw a green
// "error" toast instead of the page's translated message. The outcome now
// travels in `?oauth=`; the page must map it and leave `?flash=` alone.

import * as React from 'react'
import { act, render } from '@testing-library/react'
import ProfileCommunicationChannelsPage from '../page'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'

let currentSearchParams = new URLSearchParams()
const routerMock = { push: jest.fn(), replace: jest.fn(), refresh: jest.fn() }

jest.mock('@open-mercato/shared/lib/i18n/context', () => {
  const dict = require('../../../../i18n/en.json') as Record<string, string>
  const translate = (key: string, fallback?: string, params?: Record<string, string>) => {
    const template = dict[key] ?? fallback ?? key
    return template.replace(/\{(\w+)\}/g, (match, name: string) => params?.[name] ?? match)
  }
  return { useT: () => translate }
})

jest.mock('next/navigation', () => ({
  useRouter: () => routerMock,
  useSearchParams: () => currentSearchParams,
}))

jest.mock('@open-mercato/ui/backend/Page', () => ({
  Page: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  PageBody: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}))

jest.mock('@open-mercato/ui/backend/DataTable', () => ({
  DataTable: () => <div data-testid="data-table-mock" />,
}))

jest.mock('@open-mercato/ui/backend/injection/InjectionSpot', () => ({
  InjectionSpot: () => null,
  useInjectionWidgets: () => ({ widgets: [], loading: false, error: null }),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({ runMutation: jest.fn(), retryLastMutation: jest.fn() }),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
}))

const apiCallMock = apiCall as jest.MockedFunction<typeof apiCall>
const flashMock = flash as jest.MockedFunction<typeof flash>

async function mountPageAt(query: string) {
  currentSearchParams = new URLSearchParams(query)
  window.history.replaceState({}, '', `/backend/profile/communication-channels?${query}`)
  apiCallMock.mockResolvedValue({ ok: true, result: { items: [] } } as never)
  await act(async () => {
    render(<ProfileCommunicationChannelsPage />)
  })
}

describe('profile communication channels — OAuth connect result', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('shows the translated error for an ?oauth=error result as an error toast', async () => {
    await mountPageAt('oauth=error&code=mailbox_already_connected&provider=gmail')

    expect(flashMock).toHaveBeenCalledTimes(1)
    expect(flashMock).toHaveBeenCalledWith(
      'This mailbox is already connected through another provider. Disconnect it first to reconnect it with a different one.',
      'error',
    )
  })

  it('shows the provider-specific success message for an ?oauth=connected result', async () => {
    await mountPageAt('oauth=connected&provider=gmail&channelId=channel-1')

    expect(flashMock).toHaveBeenCalledTimes(1)
    expect(flashMock).toHaveBeenCalledWith('Channel connected (gmail).', 'success')
  })

  it('strips the OAuth result params once the toast is shown so a reload does not repeat it', async () => {
    await mountPageAt('oauth=connected&provider=gmail&channelId=channel-1&tab=email')

    expect(routerMock.replace).toHaveBeenCalledTimes(1)
    expect(routerMock.replace).toHaveBeenCalledWith('/backend/profile/communication-channels?tab=email', {
      scroll: false,
    })
  })

  it('leaves a generic ?flash= message to the global FlashMessages host', async () => {
    await mountPageAt('flash=error&code=replay')

    expect(flashMock).not.toHaveBeenCalled()
    expect(routerMock.replace).not.toHaveBeenCalled()
  })
})
