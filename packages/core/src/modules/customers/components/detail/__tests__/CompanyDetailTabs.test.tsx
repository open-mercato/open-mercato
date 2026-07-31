/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { CompanyDetailTabs } from '../CompanyDetailTabs'

let mockGrantedFeatures: string[] = []

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string) => fallback ?? key,
}))

jest.mock('@open-mercato/ui/primitives/button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}))

jest.mock('@open-mercato/ui/backend/BackendChromeProvider', () => ({
  useBackendChrome: () => ({
    payload: { grantedFeatures: mockGrantedFeatures },
    isReady: true,
  }),
}))

function renderTabs() {
  return render(
    <CompanyDetailTabs activeTab="people" onTabChange={() => {}}>
      <div>content</div>
    </CompanyDetailTabs>,
  )
}

describe('CompanyDetailTabs', () => {
  it('renders the Deals tab when the user has customers.deals.view', () => {
    mockGrantedFeatures = ['customers.companies.view', 'customers.deals.view']
    renderTabs()
    expect(screen.getByRole('tab', { name: /deals/i })).toBeInTheDocument()
  })

  it('hides the Deals tab when the user lacks customers.deals.view', () => {
    mockGrantedFeatures = ['customers.companies.view']
    renderTabs()
    expect(screen.queryByRole('tab', { name: /deals/i })).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /people/i })).toBeInTheDocument()
  })

  it('renders the Deals tab for a wildcard customers.* grant', () => {
    mockGrantedFeatures = ['customers.*']
    renderTabs()
    expect(screen.getByRole('tab', { name: /deals/i })).toBeInTheDocument()
  })
})
