/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { BackendChromeProvider, useBackendChrome } from '../BackendChromeProvider'
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
})
