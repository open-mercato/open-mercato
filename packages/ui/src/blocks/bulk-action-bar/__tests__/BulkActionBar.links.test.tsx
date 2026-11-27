import * as React from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { resolveRegisteredLucideIcon } from '@open-mercato/ui/backend/icons/lucideRegistryRuntime'
import { BulkActionBar } from '../BulkActionBar'
import { bulkActionBarFixtures } from '../fixtures'
import type { BulkActionBarProps } from '../../contracts/bulk-action-bar'

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
  ui: { blocks: { bulkActionBar: { label: 'Bulk actions', clear: 'Clear selection', selected: '{count} selected', moreActions: 'More actions' } } },
}

function renderBar(props: BulkActionBarProps) {
  return renderWithProviders(<BulkActionBar {...props} />, { dict })
}

function collectIconNames(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectIconNames)
  if (!value || typeof value !== 'object' || React.isValidElement(value)) return []
  return Object.entries(value).flatMap(([key, entry]) =>
    key === 'icon' && typeof entry === 'string' ? [entry] : collectIconNames(entry),
  )
}

const noop = () => undefined
const base = { selectedCount: 3, position: 'inline', onClear: noop } satisfies Partial<BulkActionBarProps>

describe('BulkActionBar actions as links', () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = jest.fn()
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: (query: string) => ({
        matches: true,
        media: query,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }),
    })
  })

  it('renders an action with an href as a link that keeps the button look and slot', () => {
    renderBar({ ...base, actions: [{ key: 'export', label: 'Export', href: '/export?ids=1,2,3' }], onAction: noop })
    const link = screen.getByRole('link', { name: 'Export' })
    expect(link).toHaveAttribute('href', '/export?ids=1,2,3')
    expect(link).toHaveAttribute('data-slot', 'bulk-action-bar-action')
    expect(link.className).toContain('h-10 min-w-0 shrink sm:h-8')
  })

  it('hands plain clicks to onAction and leaves modified clicks to the browser', () => {
    const onAction = jest.fn()
    renderBar({ ...base, actions: [{ key: 'export', label: 'Export', href: '#export' }], onAction })
    const link = screen.getByRole('link', { name: 'Export' })
    expect(fireEvent.click(link, { metaKey: true })).toBe(true)
    expect(fireEvent.click(link, { button: 1 })).toBe(true)
    expect(onAction).not.toHaveBeenCalled()
    expect(fireEvent.click(link)).toBe(false)
    expect(onAction).toHaveBeenCalledWith('export')
  })

  it('renders a disabled action with an href as a disabled button', () => {
    renderBar({ ...base, actions: [{ key: 'export', label: 'Export', href: '#export', disabled: true }], onAction: noop })
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled()
  })

  it('makes link actions inert while another action is pending', async () => {
    let resolve: () => void = () => undefined
    const pending = new Promise<void>((res) => {
      resolve = res
    })
    const onAction = jest.fn((key: string) => (key === 'assign' ? pending : undefined))
    renderBar({
      ...base,
      actions: [
        { key: 'assign', label: 'Assign owner' },
        { key: 'export', label: 'Export', href: '#export' },
      ],
      onAction,
    })
    fireEvent.click(screen.getByRole('button', { name: 'Assign owner' }))
    const link = screen.getByRole('link', { name: 'Export' })
    expect(link).toHaveAttribute('aria-disabled', 'true')
    expect(fireEvent.click(link)).toBe(false)
    expect(fireEvent.click(link, { metaKey: true })).toBe(false)
    expect(onAction).toHaveBeenCalledTimes(1)
    await act(async () => {
      resolve()
      await pending
    })
    await waitFor(() => expect(screen.getByRole('link', { name: 'Export' })).not.toHaveAttribute('aria-disabled'))
  })

  it('renders overflow actions with an href as links inside the menu', () => {
    const onAction = jest.fn()
    renderBar({
      ...base,
      maxVisibleActions: 1,
      actions: [
        { key: 'assign', label: 'Assign owner' },
        { key: 'export', label: 'Export', href: '#export' },
      ],
      onAction,
    })
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    const link = screen.getByRole('link', { name: 'Export' })
    expect(link).toHaveAttribute('data-slot', 'bulk-action-bar-menu-link')
    expect(fireEvent.click(link, { ctrlKey: true })).toBe(true)
    expect(onAction).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
    expect(fireEvent.click(screen.getByRole('link', { name: 'Export' }))).toBe(false)
    expect(onAction).toHaveBeenCalledWith('export')
  })

  it('renders no link for the existing fixtures', () => {
    for (const [name, fixture] of Object.entries(bulkActionBarFixtures)) {
      const view = renderBar(fixture)
      expect({ name, links: view.container.querySelectorAll('a').length }).toEqual({ name, links: 0 })
      view.unmount()
    }
  })
})

describe('BulkActionBar icon names', () => {
  beforeEach(() => mockWarn.mockClear())

  it('warns once per unknown icon name', () => {
    const props: BulkActionBarProps = {
      ...base,
      actions: [{ key: 'export', label: 'Export', icon: 'no-such-icon-bulk-action-bar' }],
      onAction: noop,
    }
    const { rerender } = renderBar(props)
    rerender(<BulkActionBar {...props} />)
    expect(mockWarn).toHaveBeenCalledTimes(1)
    expect(mockWarn.mock.calls[0][1]).toEqual({ icon: 'no-such-icon-bulk-action-bar' })
  })

  it('uses only registered icon names in its fixtures', () => {
    const names = [...new Set(collectIconNames(bulkActionBarFixtures))]
    expect(names.length).toBeGreaterThan(0)
    expect(names.filter((name) => resolveRegisteredLucideIcon(name) === null)).toEqual([])
  })
})
