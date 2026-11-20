/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { DealDetailTabs } from '../DealDetailTabs'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string) => fallback ?? key,
}))

// Tabs past the inline limit live in the More menu, so the order spans both lists.
function tabOrder() {
  const inline = screen.getAllByRole('tab').map((tab) => tab.textContent?.trim())
  const more = screen.queryByRole('button', { name: /^More/ })
  if (!more) return inline
  fireEvent.click(more)
  const overflow = screen.queryAllByRole('menuitem').map((item) => item.textContent?.trim())
  return [...inline, ...overflow]
}

jest.mock('@open-mercato/ui/primitives/button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}))


describe('DealDetailTabs', () => {
  it('preserves a pending injected selection and native defaults while sorting deduplicated tabs', () => {
    const onTabChange = jest.fn()
    const { rerender } = render(
      <DealDetailTabs activeTab="crm.pending" onTabChange={onTabChange} isLoadingInjectedTabs>
        <div>content</div>
      </DealDetailTabs>,
    )
    expect(onTabChange).not.toHaveBeenCalled()
    const injectedTabs = [
      { id: 'crm.pending', label: 'Pending', priority: 1000 },
      { id: 'crm.pending', label: 'Duplicate', priority: 2000 },
      { id: 'activities', label: 'Spoofed native', priority: 3000 },
    ]
    rerender(
      <DealDetailTabs activeTab="crm.pending" onTabChange={onTabChange} injectedTabs={injectedTabs}>
        <div>content</div>
      </DealDetailTabs>,
    )
    expect(screen.getAllByRole('tab')[0]).toHaveTextContent('Pending')
    expect(screen.getByRole('tab', { name: 'Pending', exact: true })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByRole('tab', { name: 'Duplicate', exact: true })).toBeNull()
    expect(screen.queryByRole('tab', { name: 'Spoofed native', exact: true })).toBeNull()
    expect(onTabChange).not.toHaveBeenCalled()
    rerender(
      <DealDetailTabs activeTab="activities" onTabChange={onTabChange} injectedTabs={injectedTabs}>
        <div>content</div>
      </DealDetailTabs>,
    )
    expect(screen.getByRole('tab', { name: 'Activities' })).toHaveAttribute('aria-selected', 'true')
    expect(onTabChange).not.toHaveBeenCalled()
  })

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

  it('keeps every built-in tab inline when the row fits', () => {
    render(
      <DealDetailTabs activeTab="activities" onTabChange={() => {}}>
        <div>content</div>
      </DealDetailTabs>,
    )
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Activities',
      'People',
      'Companies',
      'Notes',
      'Files',
      'ChangelogNEW',
    ])
    expect(screen.queryByRole('button', { name: /^More/ })).toBeNull()
  })

  it('folds overflowing tabs into a More menu and lifts the active one inline (#7487)', () => {
    const onTabChange = jest.fn()
    render(
      <DealDetailTabs
        activeTab="changelog"
        onTabChange={onTabChange}
        injectedTabs={[
          { id: 'pending-work', label: 'Pending work', icon: 'list-checks', priority: 75 },
          { id: 'related-documents', label: 'Related documents', priority: 55 },
        ]}
      >
        <div>content</div>
      </DealDetailTabs>,
    )
    expect(screen.getByRole('tab', { name: /changelog/i })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Pending work' }).querySelector('svg.lucide-list-checks')).not.toBeNull()
    // Both injected tabs precede the built-ins (#8020) and the active Change log is lifted
    // inline, so Files is the tab that folds into More.
    expect(screen.queryByRole('tab', { name: /files/i })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /^More/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /files/i }))
    expect(onTabChange).toHaveBeenCalledWith('files')
  })
})
