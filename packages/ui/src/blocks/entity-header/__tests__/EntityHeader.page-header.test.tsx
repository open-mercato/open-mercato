import * as React from 'react'
import { fireEvent, screen, within } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { EntityHeader, entityHeaderTabIds } from '../index'
import { entityHeaderFixtures } from '../fixtures'
import { entityHeaderPropsSchema, type EntityHeaderProps } from '../../contracts/entity-header'

const dict = {
  ui: {
    blocks: {
      entityHeader: {
        moreActions: 'More actions',
        loading: 'Loading',
        error: 'Something went wrong',
        retry: 'Try again',
        tabs: 'Sections',
        count: 'Total: {count}',
      },
    },
  },
}

function renderHeader(props: EntityHeaderProps) {
  return renderWithProviders(<EntityHeader {...props} />, { dict })
}

function slot(name: string): HTMLElement | null {
  return document.querySelector(`[data-slot="${name}"]`)
}

function outline(node: Element, depth = 0): string[] {
  const slotName = node.getAttribute('data-slot')
  const role = node.getAttribute('role')
  const line = `${'  '.repeat(depth)}${node.tagName.toLowerCase()}${slotName ? `[${slotName}]` : ''}${role ? `(${role})` : ''}`
  return [line, ...Array.from(node.children).flatMap((child) => outline(child, depth + 1))]
}

const tabsProps = entityHeaderFixtures.withTabs

describe('EntityHeader tabs', () => {
  it('renders a labelled tablist with one tab per item and marks the active one', () => {
    renderHeader(tabsProps)
    const tablist = screen.getByRole('tablist', { name: 'Sections' })
    const tabs = within(tablist).getAllByRole('tab')
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Overview', 'Deals12', 'Activity', 'Billing'])
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: /Deals/ })).toHaveAttribute('aria-selected', 'false')
    expect(screen.queryByRole('tabpanel')).not.toBeInTheDocument()
  })

  it('uses tabsLabel as the tablist name when given', () => {
    renderHeader({ ...tabsProps, tabsLabel: 'Customer sections' })
    expect(screen.getByRole('tablist', { name: 'Customer sections' })).toBeInTheDocument()
  })

  it('calls onTabChange with the key on click and not for the active tab', () => {
    const onTabChange = jest.fn()
    renderHeader({ ...tabsProps, onTabChange })
    fireEvent.click(screen.getByRole('tab', { name: 'Overview' }))
    expect(onTabChange).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('tab', { name: 'Activity' }))
    expect(onTabChange).toHaveBeenCalledWith('activity')
  })

  it('wires ids from idBase so the host can label its panel', () => {
    renderHeader(tabsProps)
    const ids = entityHeaderTabIds('customer-sections', 'overview')
    const active = screen.getByRole('tab', { name: 'Overview' })
    expect(active).toHaveAttribute('id', ids.tabId)
    expect(active).toHaveAttribute('aria-controls', ids.panelId)
    expect(screen.getByRole('tab', { name: 'Activity' })).not.toHaveAttribute('aria-controls')
  })

  it('omits aria-controls without idBase but keeps unique tab ids', () => {
    renderHeader(entityHeaderFixtures.manyTabs)
    const tabs = screen.getAllByRole('tab')
    expect(tabs.every((tab) => !tab.hasAttribute('aria-controls'))).toBe(true)
    expect(new Set(tabs.map((tab) => tab.id)).size).toBe(tabs.length)
  })

  it('keeps a single tab stop on the active tab', () => {
    renderHeader({ ...tabsProps, activeTabKey: 'activity' })
    expect(screen.getByRole('tab', { name: 'Activity' })).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('tabindex', '-1')
  })

  it('moves focus with arrow keys, wraps, skips disabled tabs and selects on focus', () => {
    const onTabChange = jest.fn()
    renderHeader({ ...tabsProps, onTabChange })
    const overview = screen.getByRole('tab', { name: 'Overview' })
    overview.focus()
    fireEvent.keyDown(overview, { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { name: /Deals/ })).toHaveFocus()
    expect(onTabChange).toHaveBeenLastCalledWith('deals')
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'End' })
    expect(screen.getByRole('tab', { name: 'Activity' })).toHaveFocus()
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowRight' })
    expect(overview).toHaveFocus()
    fireEvent.keyDown(overview, { key: 'ArrowLeft' })
    expect(screen.getByRole('tab', { name: 'Activity' })).toHaveFocus()
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Home' })
    expect(overview).toHaveFocus()
    expect(onTabChange).not.toHaveBeenCalledWith('billing')
  })

  it('renders a disabled tab that cannot be selected', () => {
    const onTabChange = jest.fn()
    renderHeader({ ...tabsProps, onTabChange })
    const billing = screen.getByRole('tab', { name: 'Billing' })
    expect(billing).toBeDisabled()
    fireEvent.click(billing)
    expect(onTabChange).not.toHaveBeenCalled()
  })

  it('formats the tab count and renders a resolvable icon', () => {
    renderHeader(entityHeaderFixtures.recordPage)
    const deals = screen.getByRole('tab', { name: /Deals/ })
    expect(deals.querySelector('[data-slot="entity-header-tab-count"]')).toHaveTextContent('12')
    expect(deals.querySelector('svg')).not.toBeNull()
    renderHeader(entityHeaderFixtures.manyTabs)
    expect(screen.getByRole('tab', { name: /Orders/ })).toHaveTextContent('1,240')
  })

  it('renders href tabs as real links that keep tab semantics', () => {
    renderHeader({
      title: 'Acme Corporation',
      tabs: [
        { key: 'overview', label: 'Overview', href: '#overview' },
        { key: 'deals', label: 'Deals', href: '#deals' },
        { key: 'billing', label: 'Billing', href: '#billing', disabled: true },
      ],
      activeTabKey: 'overview',
    })
    const deals = screen.getByRole('tab', { name: 'Deals' })
    expect(deals.tagName).toBe('A')
    expect(deals).toHaveAttribute('href', '#deals')
    expect(deals).toHaveAttribute('aria-selected', 'false')
    const billing = screen.getByRole('tab', { name: 'Billing' })
    expect(billing.tagName).toBe('BUTTON')
    expect(billing).toBeDisabled()
  })

  it('hands plain clicks on href tabs to onTabChange and leaves modified clicks to the browser', () => {
    const onTabChange = jest.fn()
    renderHeader({
      title: 'Acme Corporation',
      tabs: [
        { key: 'overview', label: 'Overview', href: '#overview' },
        { key: 'deals', label: 'Deals', href: '#deals' },
      ],
      activeTabKey: 'overview',
      onTabChange,
    })
    const deals = screen.getByRole('tab', { name: 'Deals' })
    expect(fireEvent.click(deals)).toBe(false)
    expect(onTabChange).toHaveBeenCalledWith('deals')
    onTabChange.mockClear()
    expect(fireEvent.click(deals, { metaKey: true })).toBe(true)
    expect(onTabChange).not.toHaveBeenCalled()
  })

  it('only moves focus between href tabs with arrow keys and activates on Space', () => {
    const onTabChange = jest.fn()
    renderHeader({
      title: 'Acme Corporation',
      tabs: [
        { key: 'overview', label: 'Overview', href: '#overview' },
        { key: 'deals', label: 'Deals', href: '#deals' },
      ],
      activeTabKey: 'overview',
      onTabChange,
    })
    const overview = screen.getByRole('tab', { name: 'Overview' })
    overview.focus()
    fireEvent.keyDown(overview, { key: 'ArrowRight' })
    const deals = screen.getByRole('tab', { name: 'Deals' })
    expect(deals).toHaveFocus()
    expect(onTabChange).not.toHaveBeenCalled()
    fireEvent.keyDown(deals, { key: ' ' })
    expect(onTabChange).toHaveBeenCalledWith('deals')
  })

  it('renders the tab strip after the below slot and outside the indented column', () => {
    renderHeader({
      ...tabsProps,
      below: <p>Last contact two days ago</p>,
    })
    const root = slot('entity-header') as HTMLElement
    const below = slot('entity-header-below') as HTMLElement
    const tabs = slot('entity-header-tabs') as HTMLElement
    expect(below.compareDocumentPosition(tabs) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(tabs.parentElement).toBe(root)
    expect(root.lastElementChild).toBe(tabs)
    expect(tabs.className).not.toContain('pl-16')
  })

  it('keeps the tab strip on one scrolling line with an edge-to-edge rail', () => {
    renderHeader(entityHeaderFixtures.manyTabs)
    const scroller = slot('entity-header-tabs-scroller') as HTMLElement
    expect(scroller.className).toContain('overflow-x-auto')
    expect(screen.getByRole('tablist').className).toContain('w-max')
    const rail = (slot('entity-header-tabs') as HTMLElement).firstElementChild as HTMLElement
    expect(rail.className).toContain('inset-x-0')
    expect(rail.className).toContain('border-b')
  })

  it('fades the overflowing edge and scrolls the active tab into view', () => {
    const widths = { scrollWidth: 900, clientWidth: 300 }
    const scrollWidth = jest.spyOn(Element.prototype, 'scrollWidth', 'get').mockImplementation(() => widths.scrollWidth)
    const clientWidth = jest.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(() => widths.clientWidth)
    const rect = jest.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function mockRect(this: Element) {
      const isActiveTab = this.getAttribute('aria-selected') === 'true'
      const left = isActiveTab ? 700 : 0
      const width = isActiveTab ? 80 : 300
      return new DOMRect(left, 0, width, 40)
    })
    try {
      renderHeader({ ...entityHeaderFixtures.manyTabs, activeTabKey: 'history' })
      const scroller = slot('entity-header-tabs-scroller') as HTMLElement
      expect(scroller.scrollLeft).toBe(520)
      expect(scroller).toHaveAttribute('data-fade-start', 'true')
      expect(scroller).toHaveAttribute('data-fade-end', 'true')
      scroller.scrollLeft = 600
      fireEvent.scroll(scroller)
      expect(scroller).not.toHaveAttribute('data-fade-end')
    } finally {
      scrollWidth.mockRestore()
      clientWidth.mockRestore()
      rect.mockRestore()
    }
  })

  it('shows no fade when the tabs fit', () => {
    renderHeader(tabsProps)
    const scroller = slot('entity-header-tabs-scroller') as HTMLElement
    expect(scroller).not.toHaveAttribute('data-fade-start')
    expect(scroller).not.toHaveAttribute('data-fade-end')
  })
})

describe('EntityHeader back control', () => {
  it('renders a link above the title row when backHref is given', () => {
    renderHeader(entityHeaderFixtures.backLink)
    const back = screen.getByRole('link', { name: 'Customers' })
    expect(back).toHaveAttribute('href', '#customers')
    expect(back.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    const wrapper = slot('entity-header-back') as HTMLElement
    expect((slot('entity-header') as HTMLElement).firstElementChild).toBe(wrapper)
    expect(wrapper.compareDocumentPosition(screen.getByRole('heading', { level: 1 })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('renders a button that calls onBack when there is no href', () => {
    const onBack = jest.fn()
    renderHeader({ title: 'Acme Corporation', backLabel: 'Customers', onBack })
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Customers' }))
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('hands plain clicks to onBack when both href and onBack are given', () => {
    const onBack = jest.fn()
    renderHeader({ ...entityHeaderFixtures.backLink, onBack })
    const back = screen.getByRole('link', { name: 'Customers' })
    expect(fireEvent.click(back)).toBe(false)
    expect(onBack).toHaveBeenCalledTimes(1)
    expect(fireEvent.click(back, { ctrlKey: true })).toBe(true)
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('keeps the back link and the title in the error state', () => {
    renderHeader({ ...entityHeaderFixtures.recordPage, status: 'error', errorMessage: 'The record could not be loaded' })
    expect(screen.getByRole('link', { name: 'Customers' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Acme Corporation' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('The record could not be loaded')
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
  })
})

describe('EntityHeader count', () => {
  it('renders the count after the title, outside the heading, with a spoken label', () => {
    renderHeader(entityHeaderFixtures.listPage)
    const heading = screen.getByRole('heading', { level: 1, name: 'Customers' })
    const count = slot('entity-header-count') as HTMLElement
    expect(heading).not.toContainElement(count)
    expect(heading.nextElementSibling).toBe(count)
    expect(count.querySelector('[aria-hidden="true"]')).toHaveTextContent('128')
    expect(count.querySelector('.sr-only')).toHaveTextContent('Total: 128')
    expect(count.className).toContain('text-muted-foreground')
  })

  it('renders a zero count and formats large numbers', () => {
    renderHeader({ title: 'Customers', count: 0 })
    expect(slot('entity-header-count')?.querySelector('[aria-hidden="true"]')).toHaveTextContent('0')
    renderHeader({ title: 'Orders', count: 12840 })
    expect(screen.getByText('Total: 12,840')).toBeInTheDocument()
  })
})

describe('EntityHeader as a list page header', () => {
  it('does not indent the text column, the below slot or the tabs without an avatar or leading slot', () => {
    renderHeader({
      ...entityHeaderFixtures.listPage,
      below: <p>Filters</p>,
      trailing: <span>Synced</span>,
      tabs: [
        { key: 'all', label: 'All' },
        { key: 'mine', label: 'Mine' },
      ],
      activeTabKey: 'all',
      onTabChange: () => undefined,
    })
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(slot('entity-header-leading')).toBeNull()
    expect((slot('entity-header-below') as HTMLElement).className).not.toContain('pl-16')
    expect((slot('entity-header-trailing') as HTMLElement).className).not.toContain('pl-16')
    const textColumn = screen.getByRole('heading', { level: 1 }).parentElement?.parentElement as HTMLElement
    expect(textColumn.parentElement?.firstElementChild).toBe(textColumn)
    expect(screen.getByRole('button', { name: 'New customer' })).toHaveAttribute('data-action-emphasis', 'primary')
  })
})

describe('EntityHeader loading with page header props', () => {
  it('adds a tab strip placeholder when tabs are passed', () => {
    renderHeader(entityHeaderFixtures.loadingWithTabs)
    const root = slot('entity-header') as HTMLElement
    expect(root).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByText('Loading')).toBeInTheDocument()
    const strip = slot('entity-header-tabs-skeleton') as HTMLElement
    expect(strip.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(3)
    expect(root.lastElementChild).toBe(strip)
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('caps the number of tab placeholders', () => {
    renderHeader({ ...entityHeaderFixtures.manyTabs, status: 'loading' })
    expect((slot('entity-header-tabs-skeleton') as HTMLElement).querySelectorAll('[data-slot="skeleton"]')).toHaveLength(6)
  })

  it('renders no tab strip placeholder without tabs', () => {
    renderHeader(entityHeaderFixtures.loading)
    expect(slot('entity-header-tabs-skeleton')).toBeNull()
  })
})

describe('EntityHeader without the page header props', () => {
  const newSlots = [
    'entity-header-back',
    'entity-header-count',
    'entity-header-tabs',
    'entity-header-tabs-scroller',
    'entity-header-tab',
    'entity-header-tabs-skeleton',
  ]

  it.each(['default', 'readOnly', 'minimal', 'loading', 'error', 'withSlots', 'disabledAction'])(
    'adds none of the new elements to the %s fixture',
    (name) => {
      renderHeader(entityHeaderFixtures[name])
      for (const slotName of newSlots) expect(slot(slotName)).toBeNull()
      expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
      expect(screen.queryByRole('link')).not.toBeInTheDocument()
    },
  )

  it('keeps the ready structure of the default fixture', () => {
    renderHeader(entityHeaderFixtures.default)
    const root = slot('entity-header') as HTMLElement
    expect(root.className).toBe('flex flex-col gap-3')
    expect(outline(root)).toEqual([
      'div[entity-header]',
      '  div',
      '    div',
      '      div[avatar](img)',
      '        span',
      '      div',
      '        div',
      '          h1',
      '          div[badge]',
      '        p',
      '        dl[entity-header-meta]',
      '          div',
      '            dt',
      '            dd',
      '          div',
      '            dt',
      '            dd',
      '          div',
      '            dt',
      '            dd',
      '    div[entity-header-actions]',
      '      div',
      '        div[entity-header-buttons]',
      '          button[button]',
      '            span',
      '          button[button]',
      '            span',
      '          button[button]',
      '            span',
      '          button[icon-button]',
      '            svg',
      '              circle',
      '              circle',
      '              circle',
    ])
  })

  it('keeps the loading structure', () => {
    renderHeader(entityHeaderFixtures.loading)
    const root = slot('entity-header') as HTMLElement
    expect(root.className).toBe('flex flex-col gap-3')
    expect(outline(root)).toEqual([
      'div[entity-header]',
      '  span',
      '  div',
      '    div',
      '      div[skeleton](status)',
      '      div',
      '        div[skeleton](status)',
      '        div[skeleton](status)',
      '        div',
      '          div',
      '            div[skeleton](status)',
      '            div[skeleton](status)',
      '          div',
      '            div[skeleton](status)',
      '            div[skeleton](status)',
      '          div',
      '            div[skeleton](status)',
      '            div[skeleton](status)',
      '    div',
      '      div[skeleton](status)',
      '      div[skeleton](status)',
      '      div[skeleton](status)',
    ])
  })

  it('keeps the error structure', () => {
    renderHeader(entityHeaderFixtures.error)
    const root = slot('entity-header') as HTMLElement
    expect(root.className).toBe('flex items-start gap-4')
    expect(outline(root)).toEqual([
      'div[entity-header]',
      '  div',
      '    h1',
      '    div(alert)',
      '      svg',
      '        circle',
      '        line',
      '        line',
      '      div',
      '        p',
      '        div',
      '          button[button]',
    ])
  })

  it('parses every fixture against the contract schema', () => {
    for (const [name, fixture] of Object.entries(entityHeaderFixtures)) {
      expect({ name, ok: entityHeaderPropsSchema.safeParse(fixture).success }).toEqual({ name, ok: true })
    }
  })
})
