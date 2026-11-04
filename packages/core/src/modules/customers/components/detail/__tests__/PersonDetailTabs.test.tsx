/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { registerComponentOverrides } from '@open-mercato/shared/modules/widgets/component-registry'
import {
  PERSON_DETAIL_TABS_COMPONENT_ID,
  PersonDetailTabs,
  type PersonDetailTabsProps,
  resolveLegacyTab,
} from '../PersonDetailTabs'

jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string) => fallback ?? key,
}))

jest.mock('@open-mercato/ui/primitives/button', () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button>,
}))

describe('PersonDetailTabs', () => {
  it('preserves a pending injected selection and native defaults while sorting deduplicated tabs', () => {
    const onTabChange = jest.fn()
    const { rerender } = render(
      <PersonDetailTabs activeTab="crm.pending" onTabChange={onTabChange} isLoadingInjectedTabs>
        <div>content</div>
      </PersonDetailTabs>,
    )
    expect(onTabChange).not.toHaveBeenCalled()
    const injectedTabs = [
      { id: 'crm.pending', label: 'Pending', priority: 1000 },
      { id: 'crm.pending', label: 'Duplicate', priority: 2000 },
      { id: 'activities', label: 'Spoofed native', priority: 3000 },
    ]
    rerender(
      <PersonDetailTabs activeTab="crm.pending" onTabChange={onTabChange} injectedTabs={injectedTabs}>
        <div>content</div>
      </PersonDetailTabs>,
    )
    expect(screen.getAllByRole('tab')[0]).toHaveTextContent('Pending')
    expect(screen.getByRole('tab', { name: 'Pending', exact: true })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByRole('tab', { name: 'Duplicate', exact: true })).toBeNull()
    expect(screen.queryByRole('tab', { name: 'Spoofed native', exact: true })).toBeNull()
    expect(onTabChange).not.toHaveBeenCalled()
    rerender(
      <PersonDetailTabs activeTab="activities" onTabChange={onTabChange} injectedTabs={injectedTabs}>
        <div>content</div>
      </PersonDetailTabs>,
    )
    expect(screen.getByRole('tab', { name: 'Activities' })).toHaveAttribute('aria-selected', 'true')
    expect(onTabChange).not.toHaveBeenCalled()
  })

  afterEach(() => {
    registerComponentOverrides([])
  })

  it('keeps six tabs inline and folds Addresses into the More menu', () => {
    const onTabChange = jest.fn()
    render(
      <PersonDetailTabs activeTab="activities" onTabChange={onTabChange}>
        <div>content</div>
      </PersonDetailTabs>,
    )
    expect(screen.getAllByRole('tab')).toHaveLength(6)
    expect(screen.queryByRole('tab', { name: /address/i })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /^More/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: /address/i }))
    expect(onTabChange).toHaveBeenCalledWith('addresses')
  })

  it('lifts the active overflow tab inline so the selection stays visible', () => {
    render(
      <PersonDetailTabs activeTab="addresses" onTabChange={() => {}}>
        <div>content</div>
      </PersonDetailTabs>,
    )
    expect(screen.getByRole('tab', { name: /address/i })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getAllByRole('tab')).toHaveLength(7)
  })

  it.each([
    { tasksCount: 0, label: 'Tasks' },
    { tasksCount: 2, label: 'Tasks 2' },
    { tasksCount: 1000, label: 'Tasks 999+' },
  ])(
    'renders the task total $tasksCount using the shared badge',
    ({ tasksCount, label }) => {
      render(
        <PersonDetailTabs activeTab="activities" onTabChange={() => {}} tasksCount={tasksCount}>
          <div>content</div>
        </PersonDetailTabs>,
      )
      expect(screen.getByRole('tab', { name: label })).toBeInTheDocument()
    },
  )

  it('renders the icon declared on an injected tab placement', () => {
    render(
      <PersonDetailTabs
        activeTab="activities"
        onTabChange={() => {}}
        injectedTabs={[{ id: 'pending-work', label: 'Pending work', icon: 'list-checks', priority: 10 }]}
      >
        <div>content</div>
      </PersonDetailTabs>,
    )
    expect(screen.getByRole('tab', { name: 'Pending work' }).querySelector('svg.lucide-list-checks')).not.toBeNull()
  })

  it('folds a tab that appears after the first measurement instead of staying on the measuring render', () => {
    const widthSpy = jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 100 } as DOMRect)
    const clientWidth = Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth')
    Object.defineProperty(Element.prototype, 'clientWidth', { configurable: true, get: () => 450 })
    try {
      const { rerender } = render(
        <PersonDetailTabs activeTab="activities" onTabChange={() => {}}>
          <div>content</div>
        </PersonDetailTabs>,
      )
      const inlineBefore = screen.getAllByRole('tab').length
      expect(inlineBefore).toBeLessThan(8)

      rerender(
        <PersonDetailTabs activeTab="activities" onTabChange={() => {}} injectedTabs={[{ id: 'late', label: 'Late tab', priority: -10 }]}>
          <div>content</div>
        </PersonDetailTabs>,
      )

      expect(screen.getAllByRole('tab')).toHaveLength(inlineBefore)
      fireEvent.click(screen.getByRole('button', { name: /^More/ }))
      expect(screen.getByRole('menuitem', { name: 'Late tab' })).toBeInTheDocument()
    } finally {
      widthSpy.mockRestore()
      if (clientWidth) Object.defineProperty(Element.prototype, 'clientWidth', clientWidth)
    }
  })

  it('re-measures when selecting a tab changes its width, so the strip folds at the all-fit boundary and unfolds again', () => {
    const selectedWidth = (element: Element) => (element.textContent?.startsWith('Addresses') ? 140 : 110)
    const widthSpy = jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this.getAttribute('role') !== 'tab') return { width: 0 } as DOMRect
      return { width: this.getAttribute('aria-selected') === 'true' ? selectedWidth(this) : 100 } as DOMRect
    })
    const tabCount = 8
    const widthWithActivitiesSelected = (tabCount - 1) * 100 + 110
    const clientWidth = Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth')
    Object.defineProperty(Element.prototype, 'clientWidth', { configurable: true, get: () => widthWithActivitiesSelected + 1 })
    try {
      const onTabChange = jest.fn()
      const { rerender } = render(
        <PersonDetailTabs activeTab="activities" onTabChange={onTabChange}>
          <div>content</div>
        </PersonDetailTabs>,
      )
      expect(screen.getAllByRole('tab')).toHaveLength(tabCount)
      expect(screen.queryByRole('button', { name: /^More/ })).toBeNull()

      rerender(
        <PersonDetailTabs activeTab="addresses" onTabChange={onTabChange}>
          <div>content</div>
        </PersonDetailTabs>,
      )
      expect(screen.getByRole('tab', { name: /address/i })).toHaveAttribute('aria-selected', 'true')
      expect(screen.getAllByRole('tab').length).toBeLessThan(tabCount)
      fireEvent.click(screen.getByRole('button', { name: /^More/ }))
      expect(screen.getAllByRole('menuitem').length + screen.getAllByRole('tab').length).toBe(tabCount)

      rerender(
        <PersonDetailTabs activeTab="activities" onTabChange={onTabChange}>
          <div>content</div>
        </PersonDetailTabs>,
      )
      expect(screen.getAllByRole('tab')).toHaveLength(tabCount)
      expect(screen.queryByRole('button', { name: /^More/ })).toBeNull()
    } finally {
      widthSpy.mockRestore()
      if (clientWidth) Object.defineProperty(Element.prototype, 'clientWidth', clientWidth)
    }
  })

  describe('when the rail narrows without the row resizing', () => {
    type ObservedCallback = () => void
    const observed = new Map<Element, ObservedCallback[]>()
    let listWidth = 450
    let widthSpy: jest.SpyInstance
    let clientWidth: PropertyDescriptor | undefined
    const originalResizeObserver = global.ResizeObserver

    beforeEach(() => {
      observed.clear()
      listWidth = 450
      widthSpy = jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 100 } as DOMRect)
      clientWidth = Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth')
      Object.defineProperty(Element.prototype, 'clientWidth', { configurable: true, get: () => listWidth })
      global.ResizeObserver = class {
        constructor(private readonly callback: ObservedCallback) {}
        observe(element: Element) {
          observed.set(element, [...(observed.get(element) ?? []), this.callback])
        }
        unobserve() {}
        disconnect() {
          for (const [element, callbacks] of observed) {
            observed.set(element, callbacks.filter((callback) => callback !== this.callback))
          }
        }
      } as unknown as typeof ResizeObserver
    })

    afterEach(() => {
      widthSpy.mockRestore()
      if (clientWidth) Object.defineProperty(Element.prototype, 'clientWidth', clientWidth)
      global.ResizeObserver = originalResizeObserver
    })

    function resizeTabStrip(width: number) {
      listWidth = width
      const strip = screen.getByRole('tablist').parentElement?.parentElement as Element
      act(() => {
        for (const callback of observed.get(strip) ?? []) callback()
      })
    }

    it('folds tabs when a late section action takes room from the strip, and restores them when it goes', () => {
      const sectionAction = { label: 'Add address', onClick: () => {} }
      const { rerender } = render(
        <PersonDetailTabs activeTab="activities" onTabChange={() => {}}>
          <div>content</div>
        </PersonDetailTabs>,
      )
      expect(screen.getAllByRole('tab')).toHaveLength(3)

      rerender(
        <PersonDetailTabs activeTab="activities" onTabChange={() => {}} sectionAction={sectionAction}>
          <div>content</div>
        </PersonDetailTabs>,
      )
      resizeTabStrip(250)
      expect(screen.getAllByRole('tab')).toHaveLength(1)
      expect(screen.getByTestId('detail-tabs-more')).toBeInTheDocument()

      rerender(
        <PersonDetailTabs activeTab="activities" onTabChange={() => {}}>
          <div>content</div>
        </PersonDetailTabs>,
      )
      resizeTabStrip(450)
      expect(screen.getAllByRole('tab')).toHaveLength(3)
    })
  })

  describe('More menu keyboard', () => {
    function openMenu() {
      render(
        <PersonDetailTabs
          activeTab="activities"
          onTabChange={() => {}}
          injectedTabs={[
            { id: 'crm.first', label: 'First', priority: -1 },
            { id: 'crm.second', label: 'Second', priority: -2 },
          ]}
        >
          <div>content</div>
        </PersonDetailTabs>,
      )
      const trigger = screen.getByTestId('detail-tabs-more')
      fireEvent.keyDown(trigger, { key: 'ArrowDown' })
      return { trigger, menu: screen.getByRole('menu'), items: screen.getAllByRole('menuitem') }
    }

    it('exposes the trigger as an expanded menu button', () => {
      const { trigger } = openMenu()
      expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
      expect(trigger).toHaveAttribute('aria-expanded', 'true')
    })

    it('opens on ArrowDown with the first item focused and every item out of the tab order', () => {
      const { items } = openMenu()
      expect(items.length).toBeGreaterThan(2)
      expect(items[0]).toHaveFocus()
      expect(items.every((item) => item.getAttribute('tabindex') === '-1')).toBe(true)
    })

    it('moves focus with the arrow keys, wraps at both ends, and honours Home and End', () => {
      const { menu, items } = openMenu()
      const last = items[items.length - 1]
      fireEvent.keyDown(menu, { key: 'ArrowDown' })
      expect(items[1]).toHaveFocus()
      fireEvent.keyDown(menu, { key: 'ArrowUp' })
      expect(items[0]).toHaveFocus()
      fireEvent.keyDown(menu, { key: 'ArrowUp' })
      expect(last).toHaveFocus()
      fireEvent.keyDown(menu, { key: 'ArrowDown' })
      expect(items[0]).toHaveFocus()
      fireEvent.keyDown(menu, { key: 'End' })
      expect(last).toHaveFocus()
      fireEvent.keyDown(menu, { key: 'Home' })
      expect(items[0]).toHaveFocus()
    })

    it('closes on Tab', () => {
      const { menu } = openMenu()
      fireEvent.keyDown(menu, { key: 'Tab' })
      expect(screen.queryByRole('menu')).toBeNull()
    })
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
    fireEvent.click(screen.getByRole('button', { name: /^More/ }))
    expect(screen.queryByRole('menuitem', { name: 'Custom' })).toBeNull()
    expect(screen.getByRole('menuitem', { name: 'Other' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /activities/i })).toBeInTheDocument()
  })

  it('lets a downstream props transform hide tabs without replacing the detail page (#4379)', () => {
    registerComponentOverrides([
      {
        target: { componentId: PERSON_DETAIL_TABS_COMPONENT_ID },
        priority: 50,
        metadata: { module: 'test' },
        propsTransform: (props: PersonDetailTabsProps) => ({
          ...props,
          hiddenTabIds: ['emails'],
        }),
      },
    ])
    render(
      <PersonDetailTabs activeTab="activities" onTabChange={() => {}}>
        <div>content</div>
      </PersonDetailTabs>,
    )
    expect(screen.queryByRole('tab', { name: /emails/i })).toBeNull()
    expect(screen.getByRole('tab', { name: /activities/i })).toBeInTheDocument()
  })

  describe('injected tab ordering', () => {
    // Tabs past the inline limit live in the More menu, so the order spans both lists.
    function tabOrder() {
      const inline = screen.getAllByRole('tab').map((tab) => tab.textContent?.trim())
      const more = screen.queryByRole('button', { name: /^More/ })
      if (!more) return inline
      fireEvent.click(more)
      const overflow = screen.queryAllByRole('menuitem').map((item) => item.textContent?.trim())
      return [...inline, ...overflow]
    }

    it('places an injected tab before the built-in tabs when its priority is higher', () => {
      render(
        <PersonDetailTabs
          activeTab="activities"
          onTabChange={() => {}}
          injectedTabs={[{ id: 'crm.overview', label: 'Overview', priority: 1000 }]}
        >
          <div>content</div>
        </PersonDetailTabs>,
      )
      expect(tabOrder()[0]).toBe('Overview')
    })

    it('keeps an injected tab without a priority after every built-in tab', () => {
      render(
        <PersonDetailTabs
          activeTab="activities"
          onTabChange={() => {}}
          injectedTabs={[{ id: 'crm.overview', label: 'Overview' }]}
        >
          <div>content</div>
        </PersonDetailTabs>,
      )
      const order = tabOrder()
      expect(order[0]).not.toBe('Overview')
      expect(order[order.length - 1]).toBe('Overview')
    })

    it('keeps the declared order of injected tabs that share a priority', () => {
      render(
        <PersonDetailTabs
          activeTab="activities"
          onTabChange={() => {}}
          injectedTabs={[
            { id: 'crm.first', label: 'First', priority: 10 },
            { id: 'crm.second', label: 'Second', priority: 10 },
          ]}
        >
          <div>content</div>
        </PersonDetailTabs>,
      )
      expect(tabOrder().slice(0, 2)).toEqual(['First', 'Second'])
    })
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
