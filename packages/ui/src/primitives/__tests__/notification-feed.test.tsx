/** @jest-environment jsdom */

import * as React from 'react'
import { render as rtlRender, fireEvent } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'

// NotificationFeedItem uses useT() for the interactive aria-label fallback.
// Use the `wrapper` option (instead of manually wrapping `ui`) so that
// testing-library's `rerender` re-uses the same I18nProvider — otherwise
// rerender bypasses the wrap and throws "useT must be used within I18nProvider".
const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <I18nProvider locale="en" dict={{}}>{children}</I18nProvider>
)
const render: typeof rtlRender = (ui: React.ReactElement, options?: Parameters<typeof rtlRender>[1]) =>
  rtlRender(ui, { wrapper: Wrapper, ...options })

import {
  NotificationFeed,
  NotificationFeedHeader,
  NotificationFeedList,
  NotificationFeedItem,
  NotificationFeedFooter,
  NotificationFeedIconBadge,
} from '../notification-feed'

describe('NotificationFeed', () => {
  it('renders the root card with data-slot markers and rounded shell', () => {
    const { container } = render(
      <NotificationFeed>
        <NotificationFeedHeader title="Notifications" />
        <NotificationFeedList>
          <NotificationFeedItem title="New lead" />
        </NotificationFeedList>
      </NotificationFeed>,
    )
    const root = container.querySelector('[data-slot="notification-feed"]') as HTMLElement
    expect(root).not.toBeNull()
    expect(root.className).toContain('rounded-xl')
    expect(root.className).toContain('border')
    expect(container.querySelector('[data-slot="notification-feed-header"]')).not.toBeNull()
    expect(container.querySelector('[data-slot="notification-feed-list"]')).not.toBeNull()
    expect(container.querySelector('[data-slot="notification-feed-item"]')).not.toBeNull()
  })

  it('renders the header title + actions slot when both are provided', () => {
    const { container } = render(
      <NotificationFeed>
        <NotificationFeedHeader title="Notifications">
          <button data-testid="settings">⚙</button>
        </NotificationFeedHeader>
      </NotificationFeed>,
    )
    const title = container.querySelector('[data-slot="notification-feed-header-title"]') as HTMLElement
    expect(title).not.toBeNull()
    expect(title.textContent).toBe('Notifications')
    const actions = container.querySelector(
      '[data-slot="notification-feed-header-actions"]',
    ) as HTMLElement
    expect(actions).not.toBeNull()
    expect(actions.querySelector('[data-testid="settings"]')).not.toBeNull()
  })

  it('renders item title + body + timestamp slots without any separator glyph', () => {
    const { container } = render(
      <NotificationFeed>
        <NotificationFeedList>
          <NotificationFeedItem
            title="New Lead Generated"
            body="John Smith submitted web form"
            timestamp="10 minutes ago"
          />
        </NotificationFeedList>
      </NotificationFeed>,
    )
    const item = container.querySelector('[data-slot="notification-feed-item"]') as HTMLElement
    expect(item).not.toBeNull()
    expect(item.textContent).toContain('New Lead Generated')
    expect(item.textContent).toContain('John Smith submitted web form')
    expect(item.textContent).toContain('10 minutes ago')
    // No middle-dot or em-dash separator anywhere in the row.
    expect(item.textContent).not.toContain('·')
    expect(item.textContent).not.toContain('—')
  })

  it('renders the unread dot only when `unread` is true', () => {
    const { container, rerender } = render(
      <NotificationFeed>
        <NotificationFeedList>
          <NotificationFeedItem title="Read" />
        </NotificationFeedList>
      </NotificationFeed>,
    )
    expect(container.querySelector('[data-slot="notification-feed-item-unread-dot"]')).toBeNull()
    expect(
      container.querySelector('[data-slot="notification-feed-item"]')!.getAttribute('data-unread'),
    ).toBeNull()

    rerender(
      <NotificationFeed>
        <NotificationFeedList>
          <NotificationFeedItem title="Unread" unread />
        </NotificationFeedList>
      </NotificationFeed>,
    )
    expect(
      container.querySelector('[data-slot="notification-feed-item-unread-dot"]'),
    ).not.toBeNull()
    expect(
      container.querySelector('[data-slot="notification-feed-item"]')!.getAttribute('data-unread'),
    ).toBe('true')
  })

  it('renders the item icon + indented children slots when provided', () => {
    const { container } = render(
      <NotificationFeed>
        <NotificationFeedList>
          <NotificationFeedItem
            title="With icon and children"
            icon={<span data-testid="badge">B</span>}
          >
            <button data-testid="approve">Approve</button>
          </NotificationFeedItem>
        </NotificationFeedList>
      </NotificationFeed>,
    )
    expect(container.querySelector('[data-slot="notification-feed-item-icon"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="badge"]')).not.toBeNull()
    const childrenSlot = container.querySelector(
      '[data-slot="notification-feed-item-children"]',
    ) as HTMLElement
    expect(childrenSlot).not.toBeNull()
    expect(childrenSlot.querySelector('[data-testid="approve"]')).not.toBeNull()
  })

  it('renders item as a button when onClick is provided and fires on click + Enter + Space', () => {
    const onClick = jest.fn()
    const { container } = render(
      <NotificationFeed>
        <NotificationFeedList>
          <NotificationFeedItem
            title="Click me"
            onClick={onClick}
          />
        </NotificationFeedList>
      </NotificationFeed>,
    )
    const item = container.querySelector('[data-slot="notification-feed-item"]') as HTMLElement
    expect(item.getAttribute('role')).toBe('button')
    expect(item.getAttribute('tabIndex')).toBe('0')
    expect(item.getAttribute('aria-label')).toBe('Click me')

    fireEvent.click(item)
    expect(onClick).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(item, { key: 'Enter' })
    expect(onClick).toHaveBeenCalledTimes(2)

    fireEvent.keyDown(item, { key: ' ' })
    expect(onClick).toHaveBeenCalledTimes(3)

    fireEvent.keyDown(item, { key: 'a' })
    expect(onClick).toHaveBeenCalledTimes(3)
  })

  it('does NOT wrap the item as a button when onClick is omitted', () => {
    const { container } = render(
      <NotificationFeed>
        <NotificationFeedList>
          <NotificationFeedItem title="Non-clickable" />
        </NotificationFeedList>
      </NotificationFeed>,
    )
    const item = container.querySelector('[data-slot="notification-feed-item"]') as HTMLElement
    expect(item.getAttribute('role')).toBeNull()
    expect(item.getAttribute('tabIndex')).toBeNull()
    expect(item.className).not.toMatch(/cursor-pointer/)
  })

  it('renders the actions slot when provided and prevents bubble click to row onClick', () => {
    const onItemClick = jest.fn()
    const onActionClick = jest.fn()
    const { container } = render(
      <NotificationFeed>
        <NotificationFeedList>
          <NotificationFeedItem
            title="With actions"
            onClick={onItemClick}
            actions={
              <button data-testid="kebab" onClick={onActionClick}>
                ⋯
              </button>
            }
          />
        </NotificationFeedList>
      </NotificationFeed>,
    )
    const actionsWrap = container.querySelector(
      '[data-slot="notification-feed-item-actions"]',
    ) as HTMLElement
    expect(actionsWrap).not.toBeNull()
    const kebab = container.querySelector('[data-testid="kebab"]') as HTMLButtonElement
    fireEvent.click(kebab)
    expect(onActionClick).toHaveBeenCalledTimes(1)
    // Action click does NOT bubble up to the row's onClick — the slot
    // wrapper explicitly stops propagation.
    expect(onItemClick).not.toHaveBeenCalled()
  })

  it('renders the footer slot', () => {
    const { container } = render(
      <NotificationFeed>
        <NotificationFeedList>
          <NotificationFeedItem title="x" />
        </NotificationFeedList>
        <NotificationFeedFooter>
          <button data-testid="archive-all">Archive all</button>
        </NotificationFeedFooter>
      </NotificationFeed>,
    )
    const footer = container.querySelector('[data-slot="notification-feed-footer"]') as HTMLElement
    expect(footer).not.toBeNull()
    expect(footer.querySelector('[data-testid="archive-all"]')).not.toBeNull()
  })

  it('IconBadge renders with the correct tone class per tone', () => {
    const cases: Array<{
      tone: 'indigo' | 'success' | 'warning' | 'error' | 'info' | 'brand' | 'neutral'
      expectedClasses: string[]
    }> = [
      { tone: 'indigo', expectedClasses: ['bg-accent-indigo/10', 'text-accent-indigo'] },
      { tone: 'success', expectedClasses: ['bg-status-success-icon/10', 'text-status-success-icon'] },
      { tone: 'warning', expectedClasses: ['bg-status-warning-icon/10', 'text-status-warning-icon'] },
      { tone: 'error', expectedClasses: ['bg-status-error-icon/10', 'text-status-error-icon'] },
      { tone: 'info', expectedClasses: ['bg-status-info-icon/10', 'text-status-info-icon'] },
      { tone: 'brand', expectedClasses: ['bg-brand-violet/10', 'text-brand-violet'] },
      { tone: 'neutral', expectedClasses: ['bg-muted', 'text-muted-foreground'] },
    ]
    for (const { tone, expectedClasses } of cases) {
      const { container, unmount } = render(
        <NotificationFeedIconBadge tone={tone}>x</NotificationFeedIconBadge>,
      )
      const badge = container.querySelector(
        '[data-slot="notification-feed-icon-badge"]',
      ) as HTMLElement
      expect(badge).not.toBeNull()
      expect(badge.getAttribute('data-tone')).toBe(tone)
      for (const cls of expectedClasses) {
        expect(badge.className).toContain(cls)
      }
      unmount()
    }
  })

  it('IconBadge defaults to tone="indigo" and size="default" (size-10)', () => {
    const { container } = render(
      <NotificationFeedIconBadge>x</NotificationFeedIconBadge>,
    )
    const badge = container.querySelector(
      '[data-slot="notification-feed-icon-badge"]',
    ) as HTMLElement
    expect(badge.getAttribute('data-tone')).toBe('indigo')
    expect(badge.className).toContain('bg-accent-indigo/10')
    expect(badge.className).toContain('size-10')
  })

  it('IconBadge supports sm size (size-8)', () => {
    const { container } = render(
      <NotificationFeedIconBadge size="sm">x</NotificationFeedIconBadge>,
    )
    const badge = container.querySelector(
      '[data-slot="notification-feed-icon-badge"]',
    ) as HTMLElement
    expect(badge.className).toContain('size-8')
    expect(badge.className).not.toContain('size-10')
  })

  it('forwards className on each compound slot', () => {
    const { container } = render(
      <NotificationFeed className="root-custom">
        <NotificationFeedHeader className="header-custom" title="t" />
        <NotificationFeedList className="list-custom">
          <NotificationFeedItem className="item-custom" title="x" />
        </NotificationFeedList>
        <NotificationFeedFooter className="footer-custom">x</NotificationFeedFooter>
      </NotificationFeed>,
    )
    expect(container.querySelector('[data-slot="notification-feed"]')!.className).toContain(
      'root-custom',
    )
    expect(container.querySelector('[data-slot="notification-feed-header"]')!.className).toContain(
      'header-custom',
    )
    expect(container.querySelector('[data-slot="notification-feed-list"]')!.className).toContain(
      'list-custom',
    )
    expect(container.querySelector('[data-slot="notification-feed-item"]')!.className).toContain(
      'item-custom',
    )
    expect(container.querySelector('[data-slot="notification-feed-footer"]')!.className).toContain(
      'footer-custom',
    )
  })
})
