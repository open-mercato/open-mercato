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
  useCurrentOrganization,
} from '../BackendChromeProvider'
import { apiCall } from '../utils/apiCall'

jest.mock('../utils/apiCall', () => ({
  apiCall: jest.fn(),
}))

function ChromeStateProbe() {
  const chrome = useBackendChrome()
  return (
    <div>
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
    expect(apiCall).toHaveBeenCalledWith('/api/auth/admin/nav', { credentials: 'include' })
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
