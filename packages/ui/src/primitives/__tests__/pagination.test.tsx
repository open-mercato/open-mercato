/** @jest-environment jsdom */

import * as React from 'react'
import { render as rtlRender, fireEvent } from '@testing-library/react'
import { I18nProvider } from '@open-mercato/shared/lib/i18n/context'
import { Pagination, buildPaginationItems } from '../pagination'

// Pagination uses useT() for aria-labels; wrap every render in an
// empty-dict I18nProvider so the primitive falls back to its English
// hardcoded defaults ("First page", "Previous page", ...).
const render: typeof rtlRender = (ui: React.ReactElement, options?: Parameters<typeof rtlRender>[1]) =>
  rtlRender(
    <I18nProvider locale="en" dict={{}}>
      {ui}
    </I18nProvider>,
    options,
  )

describe('buildPaginationItems', () => {
  it('returns every page when totalPages <= total slots', () => {
    expect(buildPaginationItems(1, 5, 1, 1)).toEqual([1, 2, 3, 4, 5])
    expect(buildPaginationItems(3, 7, 1, 1)).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('inserts left + right ellipsis around the current page in the middle', () => {
    const items = buildPaginationItems(10, 20, 1, 1)
    expect(items[0]).toBe(1)
    expect(items[items.length - 1]).toBe(20)
    expect(items).toContain('ellipsis-left')
    expect(items).toContain('ellipsis-right')
    expect(items).toContain(10)
  })

  it('omits left ellipsis when current page is near the start', () => {
    const items = buildPaginationItems(2, 20, 1, 1)
    expect(items.includes('ellipsis-left')).toBe(false)
    expect(items.includes('ellipsis-right')).toBe(true)
    expect(items[0]).toBe(1)
    expect(items[items.length - 1]).toBe(20)
  })

  it('omits right ellipsis when current page is near the end', () => {
    const items = buildPaginationItems(19, 20, 1, 1)
    expect(items.includes('ellipsis-right')).toBe(false)
    expect(items.includes('ellipsis-left')).toBe(true)
  })

  it('returns empty array for totalPages = 0', () => {
    expect(buildPaginationItems(1, 0, 1, 1)).toEqual([])
  })
})

describe('Pagination', () => {
  it('renders the navigation landmark with default aria-label', () => {
    const { container } = render(
      <Pagination page={1} pageSize={10} total={100} onPageChange={() => {}} />,
    )
    const nav = container.querySelector('[data-slot="pagination"]') as HTMLElement
    expect(nav.tagName).toBe('NAV')
    expect(nav.getAttribute('aria-label')).toBe('Pagination')
  })

  it('renders "Page X of Y" info by default', () => {
    const { container } = render(
      <Pagination page={2} pageSize={10} total={100} onPageChange={() => {}} />,
    )
    const info = container.querySelector('[data-slot="pagination-info"]') as HTMLElement
    expect(info.textContent).toBe('Page 2 of 10')
  })

  it('hides the page info when showInfo=false', () => {
    const { container } = render(
      <Pagination
        page={1}
        pageSize={10}
        total={100}
        onPageChange={() => {}}
        showInfo={false}
      />,
    )
    expect(container.querySelector('[data-slot="pagination-info"]')).toBeNull()
  })

  it('renders first, prev, next, last buttons by default', () => {
    const { container } = render(
      <Pagination page={5} pageSize={10} total={100} onPageChange={() => {}} />,
    )
    expect(container.querySelector('[data-slot="pagination-first"]')).not.toBeNull()
    expect(container.querySelector('[data-slot="pagination-prev"]')).not.toBeNull()
    expect(container.querySelector('[data-slot="pagination-next"]')).not.toBeNull()
    expect(container.querySelector('[data-slot="pagination-last"]')).not.toBeNull()
  })

  it('hides first/last buttons when showFirstLast=false', () => {
    const { container } = render(
      <Pagination
        page={1}
        pageSize={10}
        total={100}
        onPageChange={() => {}}
        showFirstLast={false}
      />,
    )
    expect(container.querySelector('[data-slot="pagination-first"]')).toBeNull()
    expect(container.querySelector('[data-slot="pagination-last"]')).toBeNull()
  })

  it('hides prev/next buttons when showPrevNext=false', () => {
    const { container } = render(
      <Pagination
        page={1}
        pageSize={10}
        total={100}
        onPageChange={() => {}}
        showPrevNext={false}
      />,
    )
    expect(container.querySelector('[data-slot="pagination-prev"]')).toBeNull()
    expect(container.querySelector('[data-slot="pagination-next"]')).toBeNull()
  })

  it('marks the current page button with aria-current="page" and data-state="on"', () => {
    const { container } = render(
      <Pagination page={3} pageSize={10} total={100} onPageChange={() => {}} />,
    )
    const currentPage = container.querySelector(
      '[data-slot="pagination-page"][data-state="on"]',
    ) as HTMLButtonElement
    expect(currentPage).not.toBeNull()
    expect(currentPage.textContent).toBe('3')
    expect(currentPage.getAttribute('aria-current')).toBe('page')
  })

  it('fires onPageChange when a page button is clicked', () => {
    const onPageChange = jest.fn()
    const { container } = render(
      <Pagination page={1} pageSize={10} total={100} onPageChange={onPageChange} />,
    )
    const pageButtons = container.querySelectorAll('[data-slot="pagination-page"]')
    fireEvent.click(pageButtons[2])
    expect(onPageChange).toHaveBeenCalledWith(3)
  })

  it('disables the first / prev buttons on page 1', () => {
    const { container } = render(
      <Pagination page={1} pageSize={10} total={100} onPageChange={() => {}} />,
    )
    expect(
      (container.querySelector('[data-slot="pagination-first"]') as HTMLButtonElement).disabled,
    ).toBe(true)
    expect(
      (container.querySelector('[data-slot="pagination-prev"]') as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('disables the next / last buttons on the last page', () => {
    const { container } = render(
      <Pagination page={10} pageSize={10} total={100} onPageChange={() => {}} />,
    )
    expect(
      (container.querySelector('[data-slot="pagination-next"]') as HTMLButtonElement).disabled,
    ).toBe(true)
    expect(
      (container.querySelector('[data-slot="pagination-last"]') as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('Last button jumps to the final page', () => {
    const onPageChange = jest.fn()
    const { container } = render(
      <Pagination page={3} pageSize={10} total={100} onPageChange={onPageChange} />,
    )
    const lastButton = container.querySelector(
      '[data-slot="pagination-last"]',
    ) as HTMLButtonElement
    fireEvent.click(lastButton)
    expect(onPageChange).toHaveBeenCalledWith(10)
  })

  it('Prev button jumps to the previous page', () => {
    const onPageChange = jest.fn()
    const { container } = render(
      <Pagination page={5} pageSize={10} total={100} onPageChange={onPageChange} />,
    )
    const prevButton = container.querySelector(
      '[data-slot="pagination-prev"]',
    ) as HTMLButtonElement
    fireEvent.click(prevButton)
    expect(onPageChange).toHaveBeenCalledWith(4)
  })

  it('renders the page-size select when onPageSizeChange is provided', () => {
    const { container } = render(
      <Pagination
        page={1}
        pageSize={25}
        total={100}
        onPageChange={() => {}}
        onPageSizeChange={() => {}}
      />,
    )
    expect(container.querySelector('[data-slot="pagination-page-size"]')).not.toBeNull()
  })

  it('does NOT render the page-size select without onPageSizeChange', () => {
    const { container } = render(
      <Pagination page={1} pageSize={25} total={100} onPageChange={() => {}} />,
    )
    expect(container.querySelector('[data-slot="pagination-page-size"]')).toBeNull()
  })

  it('renders ellipsis placeholders when totalPages is large', () => {
    const { container } = render(
      <Pagination page={10} pageSize={10} total={200} onPageChange={() => {}} />,
    )
    const ellipses = container.querySelectorAll('[data-slot="pagination-ellipsis"]')
    expect(ellipses.length).toBeGreaterThan(0)
    expect(ellipses[0].textContent).toBe('…')
  })

  it('clamps out-of-range page input to [1..totalPages]', () => {
    const { container } = render(
      <Pagination page={999} pageSize={10} total={50} onPageChange={() => {}} />,
    )
    const info = container.querySelector('[data-slot="pagination-info"]') as HTMLElement
    expect(info.textContent).toBe('Page 5 of 5')
  })

  it('disables all controls when disabled prop is set', () => {
    const onPageChange = jest.fn()
    const { container } = render(
      <Pagination
        page={5}
        pageSize={10}
        total={100}
        onPageChange={onPageChange}
        disabled
      />,
    )
    const buttons = container.querySelectorAll('button')
    buttons.forEach((btn) => expect(btn.disabled).toBe(true))
    fireEvent.click(buttons[0])
    expect(onPageChange).not.toHaveBeenCalled()
  })

  it('honors a custom formatPageInfo callback', () => {
    const { container } = render(
      <Pagination
        page={3}
        pageSize={10}
        total={100}
        onPageChange={() => {}}
        formatPageInfo={(p, t) => `Strona ${p} z ${t}`}
      />,
    )
    expect(
      container.querySelector('[data-slot="pagination-info"]')?.textContent,
    ).toBe('Strona 3 z 10')
  })

  it('forwards ref to the root nav element', () => {
    const ref = React.createRef<HTMLDivElement>()
    render(
      <Pagination ref={ref} page={1} pageSize={10} total={100} onPageChange={() => {}} />,
    )
    expect(ref.current?.getAttribute('data-slot')).toBe('pagination')
  })
})
