/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { act, screen, waitFor } from '@testing-library/react'
import { UpgradeActionBanner } from '../upgrades/UpgradeActionBanner'
import { BackendChromeProvider } from '../BackendChromeProvider'
import { apiCall } from '../utils/apiCall'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'

jest.mock('../utils/apiCall', () => ({
  apiCall: jest.fn(),
}))

jest.mock('../FlashMessages', () => ({
  flash: jest.fn(),
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

beforeEach(() => {
  jest.clearAllMocks()
  process.env.NEXT_PUBLIC_UPGRADE_ACTIONS_ENABLED = 'true'
})

afterEach(() => {
  delete process.env.NEXT_PUBLIC_UPGRADE_ACTIONS_ENABLED
})

describe('UpgradeActionBanner — feature guard', () => {
  it('renders null and does not call apiCall when rendered outside BackendChromeProvider (no adminNavApi, isReady=true, payload=null)', async () => {
    ;(apiCall as jest.Mock).mockResolvedValue({ ok: true, result: UPGRADE_ACTIONS_RESPONSE })

    renderWithProviders(<UpgradeActionBanner />)

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50))
    })

    expect(screen.queryByText('Install now')).toBeNull()
    expect(apiCall).not.toHaveBeenCalledWith('/api/configs/upgrade-actions')
  })

  it('renders null and does not call apiCall when grantedFeatures is empty (no configs.manage)', async () => {
    ;(apiCall as jest.Mock).mockImplementation(async (url: string) => {
      if (url === '/api/auth/admin/nav') {
        return {
          ok: true,
          result: {
            groups: [],
            settingsSections: [],
            settingsPathPrefixes: [],
            profileSections: [],
            profilePathPrefixes: [],
            grantedFeatures: [],
            roles: [],
          },
        }
      }
      return { ok: true, result: UPGRADE_ACTIONS_RESPONSE }
    })

    renderWithProviders(
      <BackendChromeProvider adminNavApi="/api/auth/admin/nav">
        <UpgradeActionBanner />
      </BackendChromeProvider>,
    )

    await waitFor(() => {
      expect(apiCall).toHaveBeenCalledWith('/api/auth/admin/nav', expect.anything())
    })

    await new Promise((r) => setTimeout(r, 50))

    expect(screen.queryByText('Install now')).toBeNull()
    expect(apiCall).not.toHaveBeenCalledWith('/api/configs/upgrade-actions')
  })

  it('calls apiCall and renders banner when grantedFeatures includes configs.manage', async () => {
    ;(apiCall as jest.Mock).mockImplementation(async (url: string) => {
      if (url === '/api/auth/admin/nav') {
        return {
          ok: true,
          result: {
            groups: [],
            settingsSections: [],
            settingsPathPrefixes: [],
            profileSections: [],
            profilePathPrefixes: [],
            grantedFeatures: ['configs.manage'],
            roles: ['admin'],
          },
        }
      }
      if (url === '/api/configs/upgrade-actions') {
        return { ok: true, result: UPGRADE_ACTIONS_RESPONSE }
      }
      return { ok: false, result: null }
    })

    renderWithProviders(
      <BackendChromeProvider adminNavApi="/api/auth/admin/nav">
        <UpgradeActionBanner />
      </BackendChromeProvider>,
    )

    await waitFor(() => {
      expect(apiCall).toHaveBeenCalledWith('/api/configs/upgrade-actions')
    })

    await waitFor(() => {
      expect(screen.getByText('Install now')).toBeInTheDocument()
    })
  })

  it('calls apiCall when grantedFeatures includes configs.* wildcard', async () => {
    ;(apiCall as jest.Mock).mockImplementation(async (url: string) => {
      if (url === '/api/auth/admin/nav') {
        return {
          ok: true,
          result: {
            groups: [],
            settingsSections: [],
            settingsPathPrefixes: [],
            profileSections: [],
            profilePathPrefixes: [],
            grantedFeatures: ['configs.*'],
            roles: ['admin'],
          },
        }
      }
      if (url === '/api/configs/upgrade-actions') {
        return { ok: true, result: UPGRADE_ACTIONS_RESPONSE }
      }
      return { ok: false, result: null }
    })

    renderWithProviders(
      <BackendChromeProvider adminNavApi="/api/auth/admin/nav">
        <UpgradeActionBanner />
      </BackendChromeProvider>,
    )

    await waitFor(() => {
      expect(apiCall).toHaveBeenCalledWith('/api/configs/upgrade-actions')
    })
  })

  it('does not call apiCall while chrome is still loading (isReady=false)', async () => {
    let resolveNav!: (value: unknown) => void
    ;(apiCall as jest.Mock).mockImplementation(async (url: string) => {
      if (url === '/api/auth/admin/nav') {
        return new Promise((resolve) => {
          resolveNav = resolve
        })
      }
      return { ok: true, result: UPGRADE_ACTIONS_RESPONSE }
    })

    renderWithProviders(
      <BackendChromeProvider adminNavApi="/api/auth/admin/nav">
        <UpgradeActionBanner />
      </BackendChromeProvider>,
    )

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50))
    })

    expect(screen.queryByText('Install now')).toBeNull()
    expect(apiCall).not.toHaveBeenCalledWith('/api/configs/upgrade-actions')

    await act(async () => {
      resolveNav({
        ok: true,
        result: {
          groups: [],
          settingsSections: [],
          settingsPathPrefixes: [],
          profileSections: [],
          profilePathPrefixes: [],
          grantedFeatures: ['configs.manage'],
          roles: ['admin'],
        },
      })
      await new Promise((r) => setTimeout(r, 50))
    })

    await waitFor(() => {
      expect(apiCall).toHaveBeenCalledWith('/api/configs/upgrade-actions')
    })
  })
})
