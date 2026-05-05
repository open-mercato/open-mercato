/**
 * @jest-environment jsdom
 */

import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { BackendHeaderChrome } from '../BackendHeaderChrome'

jest.mock('next/dynamic', () => (loader: () => Promise<unknown>) => {
  const source = loader.toString()
  const isOrganizationSwitcher = source.includes('OrganizationSwitcher')
  const Lazy = () =>
    isOrganizationSwitcher ? (
      <div data-testid="lazy-organization-switcher" />
    ) : (
      <div data-testid="lazy-other" />
    )
  return Lazy
})

jest.mock('@open-mercato/ui/backend/BackendChromeProvider', () => ({
  useBackendChrome: () => ({ payload: { groups: [], grantedFeatures: [] }, isReady: true }),
}))

jest.mock('@open-mercato/ui/backend/IntegrationsButton', () => ({
  IntegrationsButton: () => <div data-testid="integrations-button" />,
}))

jest.mock('@open-mercato/ui/backend/ProfileDropdown', () => ({
  ProfileDropdown: () => <div data-testid="profile-dropdown" />,
}))

jest.mock('@open-mercato/ui/backend/SettingsButton', () => ({
  SettingsButton: () => <div data-testid="settings-button" />,
}))

jest.mock('@/components/AiAssistantShellIntegration', () => ({
  AiAssistantShellIntegration: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

describe('BackendHeaderChrome', () => {
  it('renders the organization switcher in the topbar without a viewport-gated wrapper', () => {
    const { container } = render(
      <BackendHeaderChrome
        email="demo@example.com"
        embeddingConfigured={false}
        missingConfigMessage=""
        tenantId={null}
        organizationId={null}
      />,
    )

    const switcher = screen.getByTestId('lazy-organization-switcher')
    expect(switcher).toBeInTheDocument()

    // Regression for issue #1795: the topbar OrganizationSwitcher must not be
    // wrapped in a viewport-gated container that hides it at narrow widths.
    // Previously `<div className="hidden lg:contents">` removed it below 1024px,
    // which combined with `mobileSidebarSlot={<OrganizationSwitcher compact />}`
    // caused the dropdown to reappear inside the mobile sidebar drawer.
    const hiddenWrappers = container.querySelectorAll('.hidden')
    for (const wrapper of Array.from(hiddenWrappers)) {
      expect(wrapper.contains(switcher)).toBe(false)
    }
  })
})
