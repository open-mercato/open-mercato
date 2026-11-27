import * as React from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { resolveRegisteredLucideIcon } from '@open-mercato/ui/backend/icons/lucideRegistryRuntime'
import { EntityHeader } from '../EntityHeader'
import { entityHeaderFixtures } from '../fixtures'
import { entityHeaderPropsSchema, type EntityHeaderProps } from '../../contracts/entity-header'

const mockWarn = jest.fn()

jest.mock('@open-mercato/shared/lib/logger', () => {
  const logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: (message: string, fields?: Record<string, unknown>) => mockWarn(message, fields),
    error: () => undefined,
    child: () => logger,
  }
  return { createLogger: () => logger }
})

const dict = {
  ui: {
    blocks: {
      entityHeader: {
        moreActions: 'More actions',
        moreBadges: '+{count}',
        moreBadgesList: '{count} more: {labels}',
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

function collectIconNames(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectIconNames)
  if (!value || typeof value !== 'object' || React.isValidElement(value)) return []
  return Object.entries(value).flatMap(([key, entry]) =>
    key === 'icon' && typeof entry === 'string' ? [entry] : collectIconNames(entry),
  )
}

const noop = () => undefined

describe('EntityHeader actions as links', () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = jest.fn()
  })

  it('renders an action with an href as a link that looks like the same button', () => {
    renderHeader({
      title: 'Northwind Supplies',
      actions: [
        { key: 'edit', label: 'Edit', href: '/customers/1/edit' },
        { key: 'share', label: 'Share', href: '/customers/1/share' },
      ],
      primaryActionKey: 'edit',
      onAction: noop,
    })
    const edit = screen.getByRole('link', { name: 'Edit' })
    const share = screen.getByRole('link', { name: 'Share' })
    expect(edit).toHaveAttribute('href', '/customers/1/edit')
    expect(edit).toHaveAttribute('data-slot', 'button')
    expect(edit).toHaveAttribute('data-action-emphasis', 'primary')
    expect(edit.className).toContain('bg-primary')
    expect(edit.className).toContain('h-10')
    expect(share).toHaveAttribute('data-action-emphasis', 'secondary')
    expect(edit).not.toHaveAttribute('type')
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
  })

  it('hands a plain click to onAction and leaves modified clicks to the browser', () => {
    const onAction = jest.fn()
    renderHeader({
      title: 'Northwind Supplies',
      actions: [{ key: 'edit', label: 'Edit', href: '#edit' }],
      primaryActionKey: 'edit',
      onAction,
    })
    const edit = screen.getByRole('link', { name: 'Edit' })
    expect(fireEvent.click(edit, { metaKey: true })).toBe(true)
    expect(fireEvent.click(edit, { ctrlKey: true })).toBe(true)
    expect(fireEvent.click(edit, { shiftKey: true })).toBe(true)
    expect(fireEvent.click(edit, { button: 1 })).toBe(true)
    expect(onAction).not.toHaveBeenCalled()
    expect(fireEvent.click(edit)).toBe(false)
    expect(onAction).toHaveBeenCalledTimes(1)
    expect(onAction).toHaveBeenCalledWith('edit')
  })

  it('renders a disabled action with an href as a disabled button', () => {
    renderHeader({
      title: 'Northwind Supplies',
      actions: [
        { key: 'edit', label: 'Edit', href: '#edit', disabled: true },
        { key: 'share', label: 'Share', href: '#share', disabled: true, disabledReason: 'Sharing is turned off' },
      ],
      primaryActionKey: 'edit',
      onAction: noop,
    })
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Share' })).toHaveAttribute('aria-disabled', 'true')
  })

  it('keeps the link in place and inert while its promise is pending', async () => {
    let resolve: () => void = () => undefined
    const pending = new Promise<void>((res) => {
      resolve = res
    })
    const onAction = jest.fn(() => pending)
    renderHeader({
      title: 'Northwind Supplies',
      actions: [{ key: 'edit', label: 'Edit', href: '#edit' }],
      primaryActionKey: 'edit',
      onAction,
    })
    fireEvent.click(screen.getByRole('link', { name: 'Edit' }))
    const busy = screen.getByRole('link', { name: /Edit/ })
    expect(busy).toHaveAttribute('aria-busy', 'true')
    expect(busy).toHaveAttribute('aria-disabled', 'true')
    expect(fireEvent.click(busy)).toBe(false)
    expect(fireEvent.click(busy, { metaKey: true })).toBe(false)
    expect(onAction).toHaveBeenCalledTimes(1)
    await act(async () => {
      resolve()
      await pending
    })
    await waitFor(() => expect(screen.getByRole('link', { name: 'Edit' })).not.toHaveAttribute('aria-disabled'))
  })

  it('renders overflow actions with an href as links inside the menu', () => {
    const onAction = jest.fn()
    renderHeader({
      title: 'Northwind Supplies',
      actions: [
        { key: 'edit', label: 'Edit' },
        { key: 'share', label: 'Share' },
        { key: 'copy', label: 'Duplicate' },
        { key: 'portal', label: 'Open in portal', icon: 'external-link', href: '/portal/1' },
        { key: 'locked', label: 'Export', href: '/export', disabled: true },
      ],
      primaryActionKey: 'edit',
      onAction,
    })
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    const link = screen.getByRole('link', { name: 'Open in portal' })
    expect(link).toHaveAttribute('href', '/portal/1')
    expect(link).toHaveAttribute('data-slot', 'entity-header-menu-link')
    expect(screen.queryByRole('link', { name: 'Export' })).not.toBeInTheDocument()
    expect(fireEvent.click(link, { metaKey: true })).toBe(true)
    expect(onAction).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    expect(fireEvent.click(screen.getByRole('link', { name: 'Open in portal' }))).toBe(false)
    expect(onAction).toHaveBeenCalledTimes(1)
    expect(onAction).toHaveBeenCalledWith('portal')
  })
})

describe('EntityHeader icon names', () => {
  beforeEach(() => mockWarn.mockClear())

  it('warns once per unknown icon name and stays silent for known ones', () => {
    const props: EntityHeaderProps = {
      title: 'Northwind Supplies',
      actions: [
        { key: 'edit', label: 'Edit', icon: 'star' },
        { key: 'share', label: 'Share', icon: 'no-such-icon-entity-header' },
      ],
      primaryActionKey: 'edit',
      onAction: noop,
    }
    const { rerender } = renderHeader(props)
    rerender(<EntityHeader {...props} />)
    expect(mockWarn).toHaveBeenCalledTimes(1)
    expect(mockWarn.mock.calls[0][1]).toEqual({ icon: 'no-such-icon-entity-header' })
  })

  it('does not warn in production builds', () => {
    const previous = process.env.NODE_ENV
    Object.assign(process.env, { NODE_ENV: 'production' })
    try {
      renderHeader({
        title: 'Northwind Supplies',
        actions: [{ key: 'edit', label: 'Edit', icon: 'another-missing-icon-entity-header' }],
        primaryActionKey: 'edit',
        onAction: noop,
      })
    } finally {
      Object.assign(process.env, { NODE_ENV: previous })
    }
    expect(mockWarn).not.toHaveBeenCalled()
  })

  it('uses only registered icon names in its fixtures', () => {
    const names = [...new Set(collectIconNames(entityHeaderFixtures))]
    expect(names.length).toBeGreaterThan(0)
    expect(names.filter((name) => resolveRegisteredLucideIcon(name) === null)).toEqual([])
  })
})

describe('EntityHeader meta links', () => {
  it('renders a value with an href as a link and keeps plain values as text', () => {
    renderHeader(entityHeaderFixtures.recordWithLinks)
    expect(screen.getByRole('link', { name: 'Maria Lindqvist' })).toHaveAttribute('href', '#owner')
    expect(screen.getByRole('link', { name: '+48 22 555 01 42' })).toHaveAttribute('href', 'tel:+48225550142')
    expect(screen.getByRole('link', { name: 'orders@northwind.example' })).toHaveAttribute(
      'href',
      'mailto:orders@northwind.example',
    )
    expect(screen.queryByRole('link', { name: 'Gdansk' })).not.toBeInTheDocument()
    expect(screen.getByText('Gdansk').tagName).toBe('DD')
  })

  it('renders the suffix after the value, outside the link', () => {
    renderHeader(entityHeaderFixtures.recordWithLinks)
    const suffix = slot('entity-header-meta-suffix') as HTMLElement
    expect(suffix.textContent).toBe('+2')
    expect(suffix.className).toContain('text-muted-foreground')
    expect(suffix.closest('a')).toBeNull()
    expect(suffix.previousElementSibling).toBe(screen.getByRole('link', { name: '+48 22 555 01 42' }))
  })

  it('renders a suffix after a plain value', () => {
    renderHeader({ title: 'Northwind Supplies', meta: [{ key: 'tags', label: 'Tags', value: 'Wholesale', suffix: '+3' }] })
    const value = screen.getByText('Wholesale', { exact: false })
    expect(value.tagName).toBe('DD')
    expect(value.textContent).toBe('Wholesale+3')
  })

  it('gives rows more room between lines only when a value is a link', () => {
    const { unmount } = renderHeader(entityHeaderFixtures.default)
    expect((slot('entity-header-meta') as HTMLElement).className).toBe(
      'mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:flex sm:flex-wrap sm:gap-y-1',
    )
    unmount()
    renderHeader(entityHeaderFixtures.recordWithLinks)
    expect((slot('entity-header-meta') as HTMLElement).className).toContain('sm:gap-y-3')
  })
})

describe('EntityHeader badges', () => {
  const badges: EntityHeaderProps['badges'] = [
    { label: 'Key account', tone: 'info' },
    { label: 'Wholesale', tone: 'neutral' },
    { label: 'Payment overdue', tone: 'warning' },
  ]

  it('renders every badge after the single badge when there is no limit', () => {
    renderHeader({ title: 'Northwind Supplies', badge: { label: 'Active', tone: 'success' }, badges })
    const labels = Array.from(document.querySelectorAll('[data-slot="badge"]')).map((node) => node.textContent)
    expect(labels).toEqual(['Active', 'Key account', 'Wholesale', 'Payment overdue'])
    expect(slot('entity-header-badges-overflow')).toBeNull()
  })

  it('collapses badges beyond maxVisibleBadges into a focusable +N badge that names the hidden ones', () => {
    renderHeader({ title: 'Northwind Supplies', badge: { label: 'Active', tone: 'success' }, badges, maxVisibleBadges: 1 })
    expect(screen.getByText('Key account')).toBeInTheDocument()
    expect(screen.queryByText('Wholesale')).not.toBeInTheDocument()
    const overflow = slot('entity-header-badges-overflow') as HTMLElement
    expect(overflow).toHaveAttribute('tabindex', '0')
    expect(overflow.querySelector('[aria-hidden="true"]')?.textContent).toBe('+2')
    expect(overflow.querySelector('.sr-only')?.textContent).toBe('2 more: Wholesale, Payment overdue')
  })

  it('shows no overflow badge when everything fits and wraps the title row', () => {
    renderHeader({ title: 'Northwind Supplies', badges, maxVisibleBadges: 3 })
    expect(slot('entity-header-badges-overflow')).toBeNull()
    const row = screen.getByRole('heading', { level: 1 }).parentElement as HTMLElement
    expect(row.className).toContain('flex-wrap')
  })

  it('renders no badges for an empty list', () => {
    renderHeader({ title: 'Northwind Supplies', badges: [] })
    expect(document.querySelector('[data-slot="badge"]')).toBeNull()
  })
})

describe('EntityHeader action presentation', () => {
  it('renders an icon-only action as an icon button named by its label', () => {
    renderHeader({
      title: 'Northwind Supplies',
      actions: [
        { key: 'edit', label: 'Edit' },
        { key: 'call', label: 'Call', icon: 'phone', display: 'icon' },
      ],
      primaryActionKey: 'edit',
      onAction: noop,
    })
    const call = screen.getByRole('button', { name: 'Call' })
    expect(call).toHaveAttribute('data-slot', 'icon-button')
    expect(call).toHaveAttribute('data-display', 'icon')
    expect(call.textContent).toBe('')
    expect(call.querySelector('svg')).not.toBeNull()
    expect(call.className).toContain('size-10')
    expect(call.className).toContain('sm:size-8')
  })

  it('calls onAction from an icon-only action and renders it as a link when it has an href', () => {
    const onAction = jest.fn()
    renderHeader({
      title: 'Northwind Supplies',
      actions: [
        { key: 'call', label: 'Call', icon: 'phone', display: 'icon' },
        { key: 'pdf', label: 'Download PDF', icon: 'download', display: 'icon', href: '/invoice.pdf' },
      ],
      onAction,
    })
    fireEvent.click(screen.getByRole('button', { name: 'Call' }))
    expect(onAction).toHaveBeenCalledWith('call')
    const pdf = screen.getByRole('link', { name: 'Download PDF' })
    expect(pdf).toHaveAttribute('href', '/invoice.pdf')
    expect(pdf).toHaveAttribute('data-slot', 'icon-button')
    expect(fireEvent.click(pdf, { ctrlKey: true })).toBe(true)
    expect(fireEvent.click(pdf)).toBe(false)
    expect(onAction).toHaveBeenLastCalledWith('pdf')
  })

  it('falls back to the label when the icon of an icon-only action does not resolve', () => {
    renderHeader({
      title: 'Northwind Supplies',
      actions: [{ key: 'call', label: 'Call', icon: 'missing-icon-for-display', display: 'icon' }],
      onAction: noop,
    })
    const call = screen.getByRole('button', { name: 'Call' })
    expect(call).toHaveAttribute('data-slot', 'button')
    expect(call.textContent).toBe('Call')
  })

  it('shows the label in the overflow menu for an icon-only action', () => {
    renderHeader({
      title: 'Northwind Supplies',
      actions: [
        { key: 'a', label: 'Call', icon: 'phone', display: 'icon' },
        { key: 'b', label: 'Send email', icon: 'mail', display: 'icon' },
        { key: 'c', label: 'Share', icon: 'share-2', display: 'icon' },
      ],
      onAction: noop,
    })
    expect(screen.queryByRole('button', { name: 'Share' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    expect(screen.getByText('Share')).toBeInTheDocument()
  })

  it('keeps destructive actions in the menu by default', () => {
    renderHeader({
      title: 'Northwind Supplies',
      actions: [{ key: 'delete', label: 'Delete', tone: 'destructive' }],
      onAction: noop,
    })
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'More actions' })).toBeInTheDocument()
  })

  it('shows destructive actions as quiet destructive buttons when destructivePlacement is inline', () => {
    const onAction = jest.fn()
    renderHeader({
      title: 'Northwind Supplies',
      actions: [
        { key: 'edit', label: 'Edit' },
        { key: 'delete', label: 'Delete', tone: 'destructive' },
      ],
      primaryActionKey: 'edit',
      destructivePlacement: 'inline',
      onAction,
    })
    const remove = screen.getByRole('button', { name: 'Delete' })
    expect(remove.className).toContain('text-destructive')
    expect(remove.className).toContain('border-destructive')
    expect(remove).toHaveAttribute('data-action-emphasis', 'secondary')
    expect(screen.queryByRole('button', { name: 'More actions' })).not.toBeInTheDocument()
    fireEvent.click(remove)
    expect(onAction).toHaveBeenCalledWith('delete')
  })

  it('renders an inline destructive icon-only action with the destructive text colour', () => {
    renderHeader(entityHeaderFixtures.iconActions)
    const remove = screen.getByRole('button', { name: 'Delete' })
    expect(remove).toHaveAttribute('data-display', 'icon')
    expect(remove.className).toContain('text-destructive')
    expect(screen.getByRole('link', { name: 'Download PDF' })).toHaveAttribute('data-display', 'icon')
  })

  it('still moves inline destructive actions to the menu once two secondary actions are visible', () => {
    renderHeader({
      title: 'Northwind Supplies',
      actions: [
        { key: 'share', label: 'Share' },
        { key: 'copy', label: 'Duplicate' },
        { key: 'delete', label: 'Delete', tone: 'destructive' },
      ],
      destructivePlacement: 'inline',
      onAction: noop,
    })
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'More actions' })).toBeInTheDocument()
  })
})

describe('EntityHeader avatar variant', () => {
  it('keeps the default avatar look without a variant and applies monochrome when asked', () => {
    const { unmount } = renderHeader({ title: 'Northwind Supplies', avatar: { initials: 'NS' } })
    expect(screen.getByRole('img', { name: 'NS' }).className).toContain('bg-primary/10')
    unmount()
    renderHeader({ title: 'Northwind Supplies', avatar: { initials: 'NS', variant: 'monochrome' } })
    const avatar = screen.getByRole('img', { name: 'NS' })
    expect(avatar.className).toContain('bg-muted')
    expect(avatar.className).not.toContain('bg-primary/10')
  })
})

describe('EntityHeader defaults after the contract additions', () => {
  it('renders the same markup with and without the new optional props left at their defaults', () => {
    const first = renderHeader(entityHeaderFixtures.default)
    const before = first.container.innerHTML
    first.unmount()
    const second = renderHeader({
      ...entityHeaderFixtures.default,
      destructivePlacement: 'overflow',
      badges: [],
      avatar: { initials: 'AC', variant: 'default' },
      actions: entityHeaderFixtures.default.actions?.map((action) => ({ ...action, display: 'label' as const })),
    })
    const normalize = (html: string) => html.replace(/id="[^"]*"|aria-controls="[^"]*"|aria-describedby="[^"]*"/g, '')
    expect(normalize(second.container.innerHTML)).toBe(normalize(before))
  })

  it('adds no link, suffix, overflow badge or icon-only button to the earlier fixtures', () => {
    for (const name of ['default', 'readOnly', 'minimal', 'withSlots', 'disabledAction', 'listPage']) {
      const view = renderHeader(entityHeaderFixtures[name])
      expect({ name, links: view.container.querySelectorAll('a').length }).toEqual({ name, links: 0 })
      expect(slot('entity-header-meta-suffix')).toBeNull()
      expect(slot('entity-header-badges-overflow')).toBeNull()
      expect(view.container.querySelector('[data-display="icon"]')).toBeNull()
      view.unmount()
    }
  })

  it('parses the new fixtures against the contract schema', () => {
    for (const name of ['recordWithLinks', 'iconActions']) {
      expect({ name, ok: entityHeaderPropsSchema.safeParse(entityHeaderFixtures[name]).success }).toEqual({ name, ok: true })
    }
  })
})
