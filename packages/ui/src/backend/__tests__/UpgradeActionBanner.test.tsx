/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import { UpgradeActionBanner } from '../upgrades/UpgradeActionBanner'
import { BackendChromeProvider } from '../BackendChromeProvider'
import { apiCall } from '../utils/apiCall'

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

function renderBanner(chromePayload: { isReady: boolean; grantedFeatures?: string[] } | null) {
  if (chromePayload === null) {
    return render(<UpgradeActionBanner />)
  }

  const { isReady, grantedFeatures = [] } = chromePayload
  const apiNavMock = jest.fn(async () => ({
    ok: isReady,
    result: {
      groups: [],
      settingsSections: [],
      settingsPathPrefixes: [],
      profileSections: [],
      profilePathPrefixes: [],
      grantedFeatures,
      roles: [],
    },
  }))
  ;(apiCall as jest.Mock).mockImplementation((url: string) => {
    if (url === '/api/auth/admin/nav') return apiNavMock(url)
    return Promise.resolve({ ok: true, result: UPGRADE_ACTIONS_RESPONSE })
  })

  return render(
    <BackendChromeProvider adminNavApi="/api/auth/admin/nav">
      <UpgradeActionBanner />
    </BackendChromeProvider>,
  )
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

    render(<UpgradeActionBanner />)

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

    render(
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

    render(
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

    render(
      <BackendChromeProvider adminNavApi="/api/auth/admin/nav">
        <UpgradeActionBanner />
      </BackendChromeProvider>,
    )

    await waitFor(() => {
      expect(apiCall).toHaveBeenCalledWith('/api/configs/upgrade-actions')
    })
  })
})
