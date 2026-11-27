/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import { emitOrganizationScopeChanged } from '@open-mercato/shared/lib/frontend/organizationEvents'
import type { BackendChromePayload } from '@open-mercato/shared/modules/navigation/backendChrome'
import {
  BackendChromeProvider,
  useBackendChrome,
  useBackendChromePolicy,
  useCurrentOrganization,
} from '../BackendChromeProvider'
import { apiCall } from '../utils/apiCall'

jest.mock('../utils/apiCall', () => ({
  apiCall: jest.fn(),
}))

function ChromeStateProbe() {
  const chrome = useBackendChrome()
  const policy = useBackendChromePolicy()
  return (
    <div>
      <span data-testid="policy">{policy.state}:{policy.features?.join(',')}</span>
      <span data-testid="loading">{chrome.isLoading ? 'loading' : 'idle'}</span>
      <span data-testid="ready">{chrome.isReady ? 'ready' : 'not-ready'}</span>
    </div>
  )
}

function CurrentOrganizationProbe() {
  const organization = useCurrentOrganization()
  return (
    <span data-testid="current-organization">
      {organization ? `${organization.id}:${organization.name}` : 'none'}
    </span>
  )
}

function makePayload(
  currentOrganization: BackendChromePayload['currentOrganization'],
): BackendChromePayload {
  return {
    groups: [],
    settingsSections: [],
    settingsPathPrefixes: [],
    profileSections: [],
    profilePathPrefixes: [],
    grantedFeatures: [],
    roles: [],
    currentOrganization,
  }
}

describe('BackendChromeProvider', () => {
  beforeEach(() => {
    ;(apiCall as jest.Mock).mockReset()
  })

  it('contains transient navigation fetch failures', async () => {
    ;(apiCall as jest.Mock).mockRejectedValue(new TypeError('Failed to fetch'))

    render(
      <BackendChromeProvider adminNavApi="/api/auth/admin/nav">
        <ChromeStateProbe />
      </BackendChromeProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('idle')
    })

    expect(screen.getByTestId('ready')).toHaveTextContent('not-ready')
    expect(screen.getByTestId('policy')).toHaveTextContent('failed:')
    expect(apiCall).toHaveBeenCalledWith('/api/auth/admin/nav', expect.objectContaining({ credentials: 'include', signal: expect.any(AbortSignal) }))
  })

  it('returns null outside a provider', () => {
    render(<CurrentOrganizationProbe />)

    expect(screen.getByTestId('current-organization')).toHaveTextContent('none')
  })

  it('returns null before the chrome payload arrives', () => {
    ;(apiCall as jest.Mock).mockReturnValue(new Promise(() => {}))

    render(
      <BackendChromeProvider adminNavApi="/api/auth/admin/nav?test=pending">
        <CurrentOrganizationProbe />
      </BackendChromeProvider>,
    )

    expect(screen.getByTestId('current-organization')).toHaveTextContent('none')
  })

  it('returns the organization from the hydrated payload', async () => {
    ;(apiCall as jest.Mock).mockResolvedValue({
      ok: true,
      result: makePayload({ id: 'org-1', name: 'Northwind Ltd' }),
    })

    render(
      <BackendChromeProvider adminNavApi="/api/auth/admin/nav?test=hydrated">
        <CurrentOrganizationProbe />
      </BackendChromeProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('current-organization')).toHaveTextContent('org-1:Northwind Ltd')
    })
  })

  it('refreshes the organization after the active scope changes', async () => {
    ;(apiCall as jest.Mock)
      .mockResolvedValueOnce({
        ok: true,
        result: makePayload({ id: 'org-1', name: 'Northwind Ltd' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        result: makePayload({ id: 'org-2', name: 'Contoso GmbH' }),
      })

    render(
      <BackendChromeProvider adminNavApi="/api/auth/admin/nav?test=scope-refresh">
        <CurrentOrganizationProbe />
      </BackendChromeProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('current-organization')).toHaveTextContent('org-1:Northwind Ltd')
    })

    act(() => {
      emitOrganizationScopeChanged({ organizationId: 'org-2', tenantId: 'tenant-1' })
    })

    await waitFor(() => {
      expect(screen.getByTestId('current-organization')).toHaveTextContent('org-2:Contoso GmbH')
    })
    expect(apiCall).toHaveBeenCalledTimes(2)
  })
})

it('keeps delayed chrome responses and cache updates attached to their request scope', async () => {
  jest.mocked(apiCall).mockReset()
  let settleA: (payload: Awaited<ReturnType<typeof apiCall>>) => void = () => {}
  let settleB: (payload: Awaited<ReturnType<typeof apiCall>>) => void = () => {}
  jest.mocked(apiCall)
    .mockImplementationOnce(() => new Promise((resolve) => { settleA = resolve }))
    .mockImplementationOnce(() => new Promise((resolve) => { settleB = resolve }))
  const { unmount } = render(
    <BackendChromeProvider adminNavApi="/api/auth/admin/nav?test=epoch-race">
      <ChromeStateProbe />
      <CurrentOrganizationProbe />
    </BackendChromeProvider>,
  )
  await waitFor(() => expect(apiCall).toHaveBeenCalledTimes(1))
  const requestA = jest.mocked(apiCall).mock.calls[0][1]
  act(() => emitOrganizationScopeChanged({ organizationId: 'org-b', tenantId: 'race' }))
  expect(screen.getByTestId('policy')).toHaveTextContent('pending:')
  expect(requestA?.signal?.aborted).toBe(true)
  await waitFor(() => expect(apiCall).toHaveBeenCalledTimes(2))
  await act(async () => settleB({ ok: true, status: 200, response: new Response(), cacheStatus: null, result: { ...makePayload({ id: 'org-b', name: 'B' }), grantedFeatures: ['scope.b'] } }))
  expect(screen.getByTestId('policy')).toHaveTextContent('ready:scope.b')
  await act(async () => settleA({ ok: true, status: 200, response: new Response(), cacheStatus: null, result: { ...makePayload({ id: 'org-a', name: 'A' }), grantedFeatures: ['scope.a'] } }))
  expect(screen.getByTestId('current-organization')).toHaveTextContent('org-b:B')
  unmount()
  render(<BackendChromeProvider adminNavApi="/api/auth/admin/nav?test=epoch-race"><ChromeStateProbe /></BackendChromeProvider>)
  expect(screen.getByTestId('policy')).toHaveTextContent('ready:scope.b')
  expect(apiCall).toHaveBeenCalledTimes(2)
})

it('publishes failure for a new scope without cached grants and recovers on refresh', async () => {
  const result = (grants: string[]) => ({
    ok: true, status: 200, response: new Response(), cacheStatus: null,
    result: { ...makePayload(null), grantedFeatures: grants },
  })
  jest.mocked(apiCall).mockReset()
    .mockResolvedValueOnce(result(['scope.old']))
    .mockRejectedValueOnce(new TypeError('Fixture network failure'))
    .mockResolvedValueOnce(result([]))
    .mockRejectedValueOnce(new TypeError('Fixture refresh failure'))
  render(<BackendChromeProvider adminNavApi="/api/auth/admin/nav?test=epoch-recovery"><ChromeStateProbe /></BackendChromeProvider>)
  await waitFor(() => expect(screen.getByTestId('policy')).toHaveTextContent('ready:scope.old'))
  act(() => emitOrganizationScopeChanged({ organizationId: 'recovery', tenantId: 'race' }))
  await waitFor(() => expect(screen.getByTestId('policy')).toHaveTextContent('failed:'))
  await act(async () => { window.dispatchEvent(new Event('focus')) })
  expect(screen.getByTestId('policy')).toHaveTextContent('ready:')
  await act(async () => { window.dispatchEvent(new Event('focus')) })
  expect(screen.getByTestId('policy')).toHaveTextContent('ready:')
  expect(apiCall).toHaveBeenCalledTimes(4)
})
