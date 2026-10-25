/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import enDict from '../../i18n/en.json'
import {
  OAuthGrantReauthBanner,
  resolveOAuthGrantReconnectHref,
  type OAuthGrantReauthBannerProps,
} from '../OAuthGrantReauthBanner'

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}))

const MESSAGE = 'Access to Zz Test OAuth Grant was revoked or expired. Reconnect to resume.'
const ASK_ADMIN = 'Ask an administrator to reconnect.'
const RECONNECT_HREF = '/backend/integrations/test_oauth_grant?tab=health'

function renderBanner(overrides: Partial<OAuthGrantReauthBannerProps> = {}) {
  const props: OAuthGrantReauthBannerProps = {
    status: 'invalidated',
    integrationTitle: 'Zz Test OAuth Grant',
    reconnectHref: RECONNECT_HREF,
    canManageCredentials: true,
    isAccessLoading: false,
    ...overrides,
  }
  return renderWithProviders(<OAuthGrantReauthBanner {...props} />, { dict: enDict })
}

describe('OAuthGrantReauthBanner', () => {
  it('shows the message and a Reconnect link carrying ?tab= for a credentials manager', () => {
    renderBanner()

    const banner = screen.getByRole('alert')
    expect(banner).toHaveTextContent(MESSAGE)
    expect(banner).not.toHaveTextContent(ASK_ADMIN)
    const link = screen.getByRole('link', { name: 'Reconnect' })
    expect(link).toHaveAttribute('href', RECONNECT_HREF)
  })

  it('shows the message alone for a credentials manager without a visible connect tab', () => {
    renderBanner({ reconnectHref: null })

    expect(screen.getByRole('alert')).toHaveTextContent(MESSAGE)
    expect(screen.getByRole('alert')).not.toHaveTextContent(ASK_ADMIN)
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('ends with askAdmin and renders no link for a viewer without integrations.credentials.manage', () => {
    renderBanner({ canManageCredentials: false, reconnectHref: RECONNECT_HREF })

    expect(screen.getByRole('alert')).toHaveTextContent(`${MESSAGE} ${ASK_ADMIN}`)
    expect(screen.queryByRole('link')).toBeNull()
  })

  it.each([
    ['a viewer', false, null],
    ['an admin whose link is already resolved', true, RECONNECT_HREF],
  ] as const)('shows neither the link nor the askAdmin ending while access loads for %s', (_case, canManageCredentials, reconnectHref) => {
    renderBanner({ isAccessLoading: true, canManageCredentials, reconnectHref })

    const banner = screen.getByRole('alert')
    expect(banner).toHaveTextContent(MESSAGE)
    expect(banner).not.toHaveTextContent(ASK_ADMIN)
    expect(screen.queryByRole('link')).toBeNull()
  })

  it.each([['unavailable'], ['active'], [null], [undefined]] as const)('renders nothing for status %s', (status) => {
    const { container } = renderBanner({ status })

    expect(screen.queryByRole('alert')).toBeNull()
    expect(container).toBeEmptyDOMElement()
  })
})

describe('resolveOAuthGrantReconnectHref', () => {
  const visibleTabIds = ['credentials', 'health', 'logs']

  it('links to the connect tab when it is visible and the viewer can manage credentials', () => {
    expect(resolveOAuthGrantReconnectHref({
      integrationId: 'test_oauth_grant',
      connectTabId: 'health',
      visibleTabIds,
      canManageCredentials: true,
    })).toBe(RECONNECT_HREF)
  })

  it('returns null without integrations.credentials.manage', () => {
    expect(resolveOAuthGrantReconnectHref({
      integrationId: 'test_oauth_grant',
      connectTabId: 'health',
      visibleTabIds,
      canManageCredentials: false,
    })).toBeNull()
  })

  it('returns null when the connect tab is hidden or not declared', () => {
    expect(resolveOAuthGrantReconnectHref({
      integrationId: 'test_oauth_grant',
      connectTabId: 'provider',
      visibleTabIds,
      canManageCredentials: true,
    })).toBeNull()
    expect(resolveOAuthGrantReconnectHref({
      integrationId: 'test_oauth_grant',
      connectTabId: undefined,
      visibleTabIds,
      canManageCredentials: true,
    })).toBeNull()
  })
})
