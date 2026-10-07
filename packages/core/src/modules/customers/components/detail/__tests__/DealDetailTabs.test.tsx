/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { DealDetailTabs } from '../DealDetailTabs'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string) => fallback ?? key,
}))

function tabOrder() {
  return screen.getAllByRole('tab').map((tab) => tab.textContent?.trim())
}

describe('DealDetailTabs', () => {
  it('renders the built-in tabs', () => {
    render(
      <DealDetailTabs activeTab="activities" onTabChange={() => {}}>
        <div>content</div>
      </DealDetailTabs>,
    )
    expect(screen.getByRole('tab', { name: /activities/i })).toBeInTheDocument()
  })

  describe('injected tab ordering', () => {
    it('places an injected tab before the built-in tabs when its priority is higher', () => {
      render(
        <DealDetailTabs
          activeTab="activities"
          onTabChange={() => {}}
          injectedTabs={[{ id: 'crm.overview', label: 'Overview', priority: 1000 }]}
        >
          <div>content</div>
        </DealDetailTabs>,
      )
      expect(tabOrder()[0]).toBe('Overview')
    })

    it('keeps an injected tab without a priority after every built-in tab', () => {
      render(
        <DealDetailTabs
          activeTab="activities"
          onTabChange={() => {}}
          injectedTabs={[{ id: 'crm.overview', label: 'Overview' }]}
        >
          <div>content</div>
        </DealDetailTabs>,
      )
      const order = tabOrder()
      expect(order[0]).not.toBe('Overview')
      expect(order[order.length - 1]).toBe('Overview')
    })

    it('keeps the declared order of injected tabs that share a priority', () => {
      render(
        <DealDetailTabs
          activeTab="activities"
          onTabChange={() => {}}
          injectedTabs={[
            { id: 'crm.first', label: 'First', priority: 10 },
            { id: 'crm.second', label: 'Second', priority: 10 },
          ]}
        >
          <div>content</div>
        </DealDetailTabs>,
      )
      expect(tabOrder().slice(0, 2)).toEqual(['First', 'Second'])
    })
  })
})
