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

function tabOrder() {
  return screen.getAllByRole('tab').map((tab) => tab.textContent?.trim())
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

  describe('injected tab ordering', () => {
    beforeEach(() => {
      mockGrantedFeatures = ['customers.*']
    })

    it('places an injected tab before the built-in tabs when its priority is higher', () => {
      render(
        <CompanyDetailTabs
          activeTab="people"
          onTabChange={() => {}}
          injectedTabs={[{ id: 'crm.overview', label: 'Overview', priority: 1000 }]}
        >
          <div>content</div>
        </CompanyDetailTabs>,
      )
      expect(tabOrder()[0]).toBe('Overview')
    })

    it('keeps an injected tab without a priority after every built-in tab', () => {
      render(
        <CompanyDetailTabs
          activeTab="people"
          onTabChange={() => {}}
          injectedTabs={[{ id: 'crm.overview', label: 'Overview' }]}
        >
          <div>content</div>
        </CompanyDetailTabs>,
      )
      const order = tabOrder()
      expect(order[0]).not.toBe('Overview')
      expect(order[order.length - 1]).toBe('Overview')
    })

    it('keeps the declared order of injected tabs that share a priority', () => {
      render(
        <CompanyDetailTabs
          activeTab="people"
          onTabChange={() => {}}
          injectedTabs={[
            { id: 'crm.first', label: 'First', priority: 10 },
            { id: 'crm.second', label: 'Second', priority: 10 },
          ]}
        >
          <div>content</div>
        </CompanyDetailTabs>,
      )
      const order = tabOrder()
      expect(order.slice(0, 2)).toEqual(['First', 'Second'])
    })
  })
})
