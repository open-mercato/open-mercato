import * as React from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { resolveRegisteredLucideIcon } from '@open-mercato/ui/backend/icons/lucideRegistryRuntime'
import { ListToolbar } from '../ListToolbar'
import { listToolbarFixtures } from '../fixtures'
import { listToolbarPropsSchema, type ListToolbarProps } from '../../contracts/list-toolbar'

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
      listToolbar: {
        label: 'List toolbar',
        searchLabel: 'Search',
        appliedFilters: 'Applied filters',
        removeFilter: 'Remove filter {label}',
        moreActions: 'More actions',
      },
    },
  },
}

function renderToolbar(props: ListToolbarProps) {
  return renderWithProviders(<ListToolbar {...props} />, { dict })
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

describe('ListToolbar actions as links', () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = jest.fn()
  })

  it('renders primary and secondary actions with an href as links that keep the button look', () => {
    renderToolbar(listToolbarFixtures.withLinkActions)
    const create = screen.getByRole('link', { name: 'New deal' })
    expect(create).toHaveAttribute('href', '#new-deal')
    expect(create).toHaveAttribute('data-slot', 'list-toolbar-action')
    expect(create).toHaveAttribute('data-action-emphasis', 'primary')
    expect(create.className).toContain('bg-primary')
    expect(create.className).toContain('h-10 md:h-8')
    const importLink = screen.getByRole('link', { name: 'Import' })
    expect(importLink).toHaveAttribute('data-action-emphasis', 'secondary')
    expect(importLink.className).toContain('hidden lg:inline-flex')
    expect(screen.getByRole('button', { name: 'Export' })).toBeInTheDocument()
  })

  it('uses the same click rule as views: plain clicks go to onAction, modified clicks to the browser', () => {
    const onAction = jest.fn()
    renderToolbar({ ...listToolbarFixtures.withLinkActions, onAction })
    const create = screen.getByRole('link', { name: 'New deal' })
    expect(fireEvent.click(create, { metaKey: true })).toBe(true)
    expect(fireEvent.click(create, { ctrlKey: true })).toBe(true)
    expect(fireEvent.click(create, { shiftKey: true })).toBe(true)
    expect(fireEvent.click(create, { button: 1 })).toBe(true)
    expect(onAction).not.toHaveBeenCalled()
    expect(fireEvent.click(create)).toBe(false)
    expect(onAction).toHaveBeenCalledWith('create')
  })

  it('renders a disabled action with an href as a disabled button', () => {
    renderToolbar({
      primaryAction: { key: 'create', label: 'New deal', href: '#new-deal', disabled: true },
      onAction: noop,
    })
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New deal' })).toBeDisabled()
  })

  it('keeps a link action inert while its promise is pending', async () => {
    let resolve: () => void = () => undefined
    const pending = new Promise<void>((res) => {
      resolve = res
    })
    const onAction = jest.fn(() => pending)
    renderToolbar({ primaryAction: { key: 'create', label: 'New deal', href: '#new-deal' }, onAction })
    fireEvent.click(screen.getByRole('link', { name: 'New deal' }))
    const busy = screen.getByRole('link', { name: /New deal/ })
    expect(busy).toHaveAttribute('aria-disabled', 'true')
    expect(busy).toHaveAttribute('aria-busy', 'true')
    expect(fireEvent.click(busy)).toBe(false)
    expect(onAction).toHaveBeenCalledTimes(1)
    await act(async () => {
      resolve()
      await pending
    })
    await waitFor(() => expect(screen.getByRole('link', { name: 'New deal' })).not.toHaveAttribute('aria-busy'))
  })

  it('renders menu actions with an href as links and keeps the compact-only class', () => {
    const onAction = jest.fn()
    renderToolbar({ ...listToolbarFixtures.withLinkActions, onAction })
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    const item = document.querySelector('[data-action-key="import"]') as HTMLElement
    expect(item.className).toContain('lg:hidden')
    const link = item.querySelector('a') as HTMLAnchorElement
    expect(link).toHaveAttribute('href', '#import')
    expect(link).toHaveAttribute('data-slot', 'list-toolbar-menu-link')
    expect(fireEvent.click(link, { metaKey: true })).toBe(true)
    expect(onAction).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    const reopened = document.querySelector('[data-action-key="import"] a') as HTMLAnchorElement
    expect(fireEvent.click(reopened)).toBe(false)
    expect(onAction).toHaveBeenCalledTimes(1)
    expect(onAction).toHaveBeenCalledWith('import')
  })

  it('renders the same action markup as before when no action has an href', () => {
    renderToolbar(listToolbarFixtures.withActions)
    expect(document.querySelector('[data-slot="list-toolbar"] a')).toBeNull()
    const create = screen.getByRole('button', { name: 'New deal' })
    expect(create).toHaveAttribute('type', 'button')
    expect(create).toHaveAttribute('data-slot', 'list-toolbar-action')
  })
})

describe('ListToolbar icon names', () => {
  beforeEach(() => mockWarn.mockClear())

  it('warns once per unknown icon name', () => {
    const props: ListToolbarProps = {
      primaryAction: { key: 'create', label: 'New deal', icon: 'no-such-icon-list-toolbar' },
      secondaryActions: [{ key: 'export', label: 'Export', icon: 'download' }],
      onAction: noop,
    }
    const { rerender } = renderToolbar(props)
    rerender(<ListToolbar {...props} />)
    expect(mockWarn).toHaveBeenCalledTimes(1)
    expect(mockWarn.mock.calls[0][1]).toEqual({ icon: 'no-such-icon-list-toolbar' })
  })

  it('uses only registered icon names in its fixtures', () => {
    const names = [...new Set(collectIconNames(listToolbarFixtures))]
    expect(names.length).toBeGreaterThan(0)
    expect(names.filter((name) => resolveRegisteredLucideIcon(name) === null)).toEqual([])
  })
})

describe('ListToolbar filter bar', () => {
  it('renders the filterBar slot as its own row between the main row and the applied filters', () => {
    renderToolbar({
      ...listToolbarFixtures.appliedFilters,
      filterBar: <button type="button">Stage</button>,
    })
    const root = slot('list-toolbar') as HTMLElement
    const order = Array.from(root.children).map((child) => child.getAttribute('data-slot'))
    expect(order).toEqual(['list-toolbar-main', 'list-toolbar-filter-bar', 'list-toolbar-chips'])
    const row = slot('list-toolbar-filter-bar') as HTMLElement
    expect(row.className).toContain('w-full')
    expect(row).toContainElement(screen.getByRole('button', { name: 'Stage' }))
  })

  it('renders no filter bar row without the slot', () => {
    renderToolbar(listToolbarFixtures.appliedFilters)
    expect(slot('list-toolbar-filter-bar')).toBeNull()
    const root = slot('list-toolbar') as HTMLElement
    expect(Array.from(root.children).map((child) => child.getAttribute('data-slot'))).toEqual([
      'list-toolbar-main',
      'list-toolbar-chips',
    ])
  })

  it('does not render the filter bar while loading', () => {
    renderToolbar({ status: 'loading', filterBar: <button type="button">Stage</button> })
    expect(slot('list-toolbar-filter-bar')).toBeNull()
  })
})

describe('ListToolbar chip anchor', () => {
  it('hands the chip element to onChipOpen as the second argument', () => {
    const onChipOpen = jest.fn()
    renderToolbar({ ...listToolbarFixtures.appliedFilters, onChipOpen })
    const label = screen.getByRole('button', { name: 'Owner: Maria Lindqvist' })
    fireEvent.click(label)
    const chip = label.closest('[data-slot="list-toolbar-chip"]')
    expect(chip).not.toBeNull()
    expect(onChipOpen).toHaveBeenCalledWith('owner', chip)
  })

  it('keeps working with a handler that only reads the id', () => {
    const opened: string[] = []
    renderToolbar({ ...listToolbarFixtures.appliedFilters, onChipOpen: (id: string) => opened.push(id) })
    fireEvent.click(screen.getByRole('button', { name: 'Stage: Negotiation' }))
    expect(opened).toEqual(['stage'])
  })

  it('parses the new fixture against the contract schema', () => {
    expect(listToolbarPropsSchema.safeParse(listToolbarFixtures.withLinkActions).success).toBe(true)
  })
})
