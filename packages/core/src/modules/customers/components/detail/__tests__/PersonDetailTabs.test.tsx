/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { PersonDetailTabs, resolveLegacyTab } from '../PersonDetailTabs'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string) => fallback ?? key,
}))

jest.mock('@open-mercato/ui/primitives/button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}))

describe('PersonDetailTabs', () => {
  it('renders an Addresses tab', () => {
    render(
      <PersonDetailTabs activeTab="activities" onTabChange={() => {}}>
        <div>content</div>
      </PersonDetailTabs>,
    )
    expect(screen.getByRole('tab', { name: /address/i })).toBeInTheDocument()
  })

  it('hides built-in and injected tabs listed in hiddenTabIds (#4379)', () => {
    render(
      <PersonDetailTabs
        activeTab="activities"
        onTabChange={() => {}}
        hiddenTabIds={['emails', 'crm.custom-tab']}
        injectedTabs={[
          { id: 'crm.custom-tab', label: 'Custom' },
          { id: 'crm.other-tab', label: 'Other' },
        ]}
      >
        <div>content</div>
      </PersonDetailTabs>,
    )
    expect(screen.queryByRole('tab', { name: /emails/i })).toBeNull()
    expect(screen.queryByRole('tab', { name: 'Custom' })).toBeNull()
    expect(screen.getByRole('tab', { name: 'Other' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /activities/i })).toBeInTheDocument()
  })

  describe('resolveLegacyTab', () => {
    it('keeps built-in ids and falls back for unknown ids', () => {
      expect(resolveLegacyTab('deals')).toBe('deals')
      expect(resolveLegacyTab('nonsense')).toBe('activities')
      expect(resolveLegacyTab(null)).toBe('activities')
    })

    it('accepts injected tab ids passed as knownTabIds (#4379)', () => {
      expect(resolveLegacyTab('crm.custom-tab', ['crm.custom-tab'])).toBe('crm.custom-tab')
      expect(resolveLegacyTab('crm.unknown', ['crm.custom-tab'])).toBe('activities')
    })
  })
})
