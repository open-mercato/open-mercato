/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { act, screen, waitFor } from '@testing-library/react'
import { UpgradeActionBanner } from '../upgrades/UpgradeActionBanner'
import { useBackendChrome } from '../BackendChromeProvider'
import { apiCall } from '../utils/apiCall'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'

jest.mock('../utils/apiCall', () => ({
  apiCall: jest.fn(),
}))

jest.mock('../FlashMessages', () => ({
  flash: jest.fn(),
}))

jest.mock('../BackendChromeProvider', () => ({
  BackendChromeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useBackendChrome: jest.fn(),
}))

const UPGRADE_ACTIONS_RESPONSE = {
  version: '0.3.4',
  actions: [
    {
      id: 'seed-catalog',
      version: '0.3.4',
      message: 'Install example products',
      ctaLabel: 'Install now',
    },
  ],
}

function mockChrome(opts: { isReady?: boolean; grantedFeatures?: string[] } = {}) {
  const isReady = opts.isReady ?? true
  ;(useBackendChrome as jest.Mock).mockReturnValue({
    payload: opts.grantedFeatures !== undefined ? { grantedFeatures: opts.grantedFeatures } : null,
    isReady,
    isLoading: !isReady,
    refresh: jest.fn(),
  })
}

beforeAll(() => {
  if (typeof globalThis.fetch === 'undefined') {
    Object.defineProperty(globalThis, 'fetch', { value: jest.fn(), writable: true, configurable: true })
  }
})

beforeEach(() => {
  jest.clearAllMocks()
  process.env.NEXT_PUBLIC_UPGRADE_ACTIONS_ENABLED = 'true'
  mockChrome()
})

afterEach(() => {
  delete process.env.NEXT_PUBLIC_UPGRADE_ACTIONS_ENABLED
})

describe('UpgradeActionBanner — feature guard', () => {
  it('renders null and does not call apiCall when payload is null (no configs.manage)', async () => {
    ;(apiCall as jest.Mock).mockResolvedValue({ ok: true, result: UPGRADE_ACTIONS_RESPONSE })

    renderWithProviders(<UpgradeActionBanner />)

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50))
    })

    expect(screen.queryByText('Install now')).toBeNull()
    expect(apiCall).not.toHaveBeenCalled()
  })

  it('renders null and does not call apiCall when grantedFeatures is empty (no configs.manage)', async () => {
    mockChrome({ isReady: true, grantedFeatures: [] })
    ;(apiCall as jest.Mock).mockResolvedValue({ ok: true, result: UPGRADE_ACTIONS_RESPONSE })

    renderWithProviders(<UpgradeActionBanner />)

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50))
    })

    expect(screen.queryByText('Install now')).toBeNull()
    expect(apiCall).not.toHaveBeenCalled()
  })

  it('calls apiCall and renders banner when grantedFeatures includes configs.manage', async () => {
    mockChrome({ isReady: true, grantedFeatures: ['configs.manage'] })
    ;(apiCall as jest.Mock).mockResolvedValue({ ok: true, result: UPGRADE_ACTIONS_RESPONSE })

    renderWithProviders(<UpgradeActionBanner />)

    await waitFor(() => {
      expect(apiCall).toHaveBeenCalledWith(
        '/api/configs/upgrade-actions',
        { headers: { 'x-om-forbidden-redirect': '0' } },
      )
    })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Install now' })).toBeInTheDocument()
    })
  })

  it('calls apiCall when grantedFeatures includes configs.* wildcard', async () => {
    mockChrome({ isReady: true, grantedFeatures: ['configs.*'] })
    ;(apiCall as jest.Mock).mockResolvedValue({ ok: true, result: UPGRADE_ACTIONS_RESPONSE })

    renderWithProviders(<UpgradeActionBanner />)

    await waitFor(() => {
      expect(apiCall).toHaveBeenCalledWith(
        '/api/configs/upgrade-actions',
        { headers: { 'x-om-forbidden-redirect': '0' } },
      )
    })
  })

  it('does not call apiCall while chrome is still loading (isReady=false), then fires after ready', async () => {
    mockChrome({ isReady: false })
    ;(apiCall as jest.Mock).mockResolvedValue({ ok: true, result: UPGRADE_ACTIONS_RESPONSE })

    const { rerender } = renderWithProviders(<UpgradeActionBanner />)

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50))
    })

    expect(screen.queryByText('Install now')).toBeNull()
    expect(apiCall).not.toHaveBeenCalled()

    mockChrome({ isReady: true, grantedFeatures: ['configs.manage'] })
    rerender(<UpgradeActionBanner />)

    await waitFor(() => {
      expect(apiCall).toHaveBeenCalledWith(
        '/api/configs/upgrade-actions',
        { headers: { 'x-om-forbidden-redirect': '0' } },
      )
    })
  })
})
