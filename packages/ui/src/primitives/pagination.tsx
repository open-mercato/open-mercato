"use client"

import * as React from 'react'
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  CompactSelectTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectValue,
} from './compact-select'

/**
 * Page navigation primitive per Figma `Pagination Group [1.1]` (DS Open
 * Mercato componentSet `199985:4135`).
 *
 * Layout (Figma `Basic` variant):
 *
 *   [Left] "Page 2 of 16"
 *   [Center] ⏮  ◀  [1][2]…[N-1][N]  ▶  ⏭
 *   [Right] "7 / page" CompactSelect
 *
 * Figma's three boolean variant props are mapped 1:1 to React props:
 *
 *   🥇 First / Last       → `showFirstLast` (default true)
 *   ⏭️ Next / Previous    → `showPrevNext`  (default true)
 *   🧪 Advanced           → `showInfo` + `showPageSize` (default both true)
 *
 * The numeric page list uses the same ellipsis algorithm Material /
 * MUI / shadcn ship: `boundaryCount` pages at each end (default 1),
 * `siblingCount` pages on either side of the current page (default 1),
 * collapse the rest into `…` placeholders.
 *
 * ```tsx
 * const [page, setPage] = React.useState(1)
 * const [pageSize, setPageSize] = React.useState(25)
 * <Pagination
 *   page={page}
 *   pageSize={pageSize}
 *   total={items.length}
 *   onPageChange={setPage}
 *   onPageSizeChange={setPageSize}
 * />
 *
 * // Compact (no first/last, no page-size select)
 * <Pagination
 *   page={page}
 *   pageSize={20}
 *   total={120}
 *   onPageChange={setPage}
 *   showFirstLast={false}
 *   showPageSize={false}
 * />
 * ```
 */

/**
 * Build a stable list of pages + ellipsis placeholders that fits a
 * pagination row of `boundaryCount + 2 + siblingCount * 2 + 1` cells.
 * Returns `number` entries (1-indexed) and `'ellipsis-left'` /
 * `'ellipsis-right'` placeholders that the renderer paints as `…`.
 *
 * Exported for tests + consumer reuse (e.g. a server-side rendered
 * pagination indicator that needs the same shape).
 */
export function buildPaginationItems(
  page: number,
  totalPages: number,
  siblingCount: number,
  boundaryCount: number,
): Array<number | 'ellipsis-left' | 'ellipsis-right'> {
  if (totalPages <= 0) return []
  // When everything fits, just list every page.
  const totalSlots = boundaryCount * 2 + siblingCount * 2 + 3
  if (totalPages <= totalSlots) {
    return Array.from({ length: totalPages }, (_, i) => i + 1)
  }
  const startPages = Array.from({ length: boundaryCount }, (_, i) => i + 1)
  const endPages = Array.from(
    { length: boundaryCount },
    (_, i) => totalPages - boundaryCount + 1 + i,
  )
  const siblingStart = Math.max(
    Math.min(page - siblingCount, totalPages - boundaryCount - siblingCount * 2 - 1),
    boundaryCount + 2,
  )
  const siblingEnd = Math.min(
    Math.max(page + siblingCount, boundaryCount + siblingCount * 2 + 2),
    endPages.length > 0 ? endPages[0] - 2 : totalPages - 1,
  )
  const middle: Array<number> = []
  for (let i = siblingStart; i <= siblingEnd; i += 1) middle.push(i)

  // Bridge between the start boundary and the sibling window. The
  // ellipsis is only worth showing when ≥2 page numbers fall between
  // them; if exactly 1 page is missing, render that single number
  // instead of "…" (cleaner UX — same width, no information loss).
  const result: Array<number | 'ellipsis-left' | 'ellipsis-right'> = []
  for (const p of startPages) result.push(p)
  if (siblingStart > boundaryCount + 2) {
    result.push('ellipsis-left')
  } else if (siblingStart === boundaryCount + 2) {
    result.push(boundaryCount + 1)
  }
  for (const p of middle) result.push(p)
  const firstEnd = endPages[0] ?? totalPages
  if (siblingEnd < firstEnd - 2) {
    result.push('ellipsis-right')
  } else if (siblingEnd === firstEnd - 2) {
    result.push(firstEnd - 1)
  }
  for (const p of endPages) result.push(p)
  return result
}

const cellVariants = cva(
  'inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-sm font-medium outline-none transition-colors tabular-nums ' +
    'focus-visible:shadow-focus ' +
    'disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      selected: {
        true: 'bg-muted text-foreground',
        false: 'bg-background text-foreground hover:bg-muted/40',
      },
    },
    defaultVariants: { selected: false },
  },
)

const navButtonVariants = cva(
  'inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground outline-none transition-colors ' +
    'hover:bg-muted/40 hover:text-foreground ' +
    'focus-visible:shadow-focus ' +
    'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground',
)

export type PaginationProps = React.HTMLAttributes<HTMLDivElement> & {
  /** Current 1-indexed page. */
  page: number
  /** Items per page. */
  pageSize: number
  /** Total item count. Used to derive `Math.ceil(total / pageSize)` pages. */
  total: number
  /** Called when the user changes page. */
  onPageChange: (next: number) => void
  /** Called when the user changes page size. Optional — when omitted,
   *  the "X / page" select is hidden. */
  onPageSizeChange?: (next: number) => void
  /** Page size options for the select. Default `[10, 25, 50, 100]`. */
  pageSizeOptions?: readonly number[]
  /** Show the left "Page X of Y" indicator. Default `true`. */
  showInfo?: boolean
  /** Show the right "X / page" select. Default `true` when
   *  `onPageSizeChange` is provided; ignored otherwise. */
  showPageSize?: boolean
  /** Show ⏮ / ⏭ first / last buttons. Default `true`. */
  showFirstLast?: boolean
  /** Show ◀ / ▶ prev / next buttons. Default `true`. */
  showPrevNext?: boolean
  /** Pages on either side of the current page in the page list. Default `1`. */
  siblingCount?: number
  /** Pages pinned at each end of the page list. Default `1`. */
  boundaryCount?: number
  /** Block all interactions. Default `false`. */
  disabled?: boolean
  /** ARIA label for the navigation landmark. Default `"Pagination"`. */
  'aria-label'?: string
  /** Format the "Page X of Y" label. */
  formatPageInfo?: (page: number, totalPages: number) => string
  /** Format the "X / page" label. */
  formatPageSizeLabel?: (pageSize: number) => string
}

export const Pagination = React.forwardRef<HTMLDivElement, PaginationProps>(
  (
    {
      className,
      page,
      pageSize,
      total,
      onPageChange,
      onPageSizeChange,
      pageSizeOptions = [10, 25, 50, 100],
      showInfo = true,
      showPageSize: showPageSizeProp,
      showFirstLast = true,
      showPrevNext = true,
      siblingCount = 1,
      boundaryCount = 1,
      disabled = false,
      formatPageInfo,
      formatPageSizeLabel,
      ...props
    },
    ref,
  ) => {
    const t = useT()
    const resolvedFormatPageInfo =
      formatPageInfo ??
      ((p: number, total: number) =>
        t('ui.pagination.info.pageOf', 'Page {page} of {total}', { page: p, total }))
    const resolvedFormatPageSizeLabel =
      formatPageSizeLabel ??
      ((size: number) =>
        t('ui.pagination.itemsPerPage.label', '{size} / page', { size }))
    const totalPages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)))
    const safePage = Math.min(Math.max(1, page), totalPages)
    const items = React.useMemo(
      () => buildPaginationItems(safePage, totalPages, siblingCount, boundaryCount),
      [safePage, totalPages, siblingCount, boundaryCount],
    )
    const showPageSize = showPageSizeProp ?? Boolean(onPageSizeChange)

    const goTo = React.useCallback(
      (next: number) => {
        if (disabled) return
        const bounded = Math.min(Math.max(1, next), totalPages)
        if (bounded !== safePage) onPageChange(bounded)
      },
      [disabled, onPageChange, safePage, totalPages],
    )

    return (
      <nav
        ref={ref}
        data-slot="pagination"
        aria-label={props['aria-label'] ?? t('ui.pagination.landmark.ariaLabel', 'Pagination')}
        className={cn('flex w-full flex-wrap items-center justify-between gap-x-6 gap-y-2', className)}
        {...props}
      >
        {showInfo ? (
          <div
            data-slot="pagination-info"
            className="shrink-0 text-sm text-muted-foreground tabular-nums"
          >
            {resolvedFormatPageInfo(safePage, totalPages)}
          </div>
        ) : (
          <div />
        )}

        <div
          data-slot="pagination-controls"
          className="flex flex-wrap items-center justify-center gap-2"
        >
          {showFirstLast ? (
            <button
              type="button"
              data-slot="pagination-first"
              aria-label={t('ui.pagination.first.ariaLabel', 'First page')}
              disabled={disabled || safePage <= 1}
              onClick={() => goTo(1)}
              className={cn(navButtonVariants())}
            >
              <ChevronsLeft aria-hidden="true" className="size-5" />
            </button>
          ) : null}
          {showPrevNext ? (
            <button
              type="button"
              data-slot="pagination-prev"
              aria-label={t('ui.pagination.previous.ariaLabel', 'Previous page')}
              disabled={disabled || safePage <= 1}
              onClick={() => goTo(safePage - 1)}
              className={cn(navButtonVariants())}
            >
              <ChevronLeft aria-hidden="true" className="size-5" />
            </button>
          ) : null}

          <ol
            data-slot="pagination-pages"
            className="flex flex-wrap items-center justify-center gap-2 list-none"
          >
            {items.map((entry, index) => {
              if (entry === 'ellipsis-left' || entry === 'ellipsis-right') {
                return (
                  <li
                    key={`${entry}-${index}`}
                    data-slot="pagination-ellipsis"
                    aria-hidden="true"
                    className="inline-flex size-8 items-center justify-center text-sm text-muted-foreground"
                  >
                    …
                  </li>
                )
              }
              const selected = entry === safePage
              return (
                <li key={entry}>
                  <button
                    type="button"
                    data-slot="pagination-page"
                    data-state={selected ? 'on' : 'off'}
                    aria-current={selected ? 'page' : undefined}
                    aria-label={
                      selected
                        ? t('ui.pagination.page.currentAriaLabel', 'Page {page}, current page', { page: entry })
                        : t('ui.pagination.page.goToAriaLabel', 'Go to page {page}', { page: entry })
                    }
                    disabled={disabled}
                    onClick={() => goTo(entry)}
                    className={cn(cellVariants({ selected }))}
                  >
                    {entry}
                  </button>
                </li>
              )
            })}
          </ol>

          {showPrevNext ? (
            <button
              type="button"
              data-slot="pagination-next"
              aria-label={t('ui.pagination.next.ariaLabel', 'Next page')}
              disabled={disabled || safePage >= totalPages}
              onClick={() => goTo(safePage + 1)}
              className={cn(navButtonVariants())}
            >
              <ChevronRight aria-hidden="true" className="size-5" />
            </button>
          ) : null}
          {showFirstLast ? (
            <button
              type="button"
              data-slot="pagination-last"
              aria-label={t('ui.pagination.last.ariaLabel', 'Last page')}
              disabled={disabled || safePage >= totalPages}
              onClick={() => goTo(totalPages)}
              className={cn(navButtonVariants())}
            >
              <ChevronsRight aria-hidden="true" className="size-5" />
            </button>
          ) : null}
        </div>

        {showPageSize && onPageSizeChange ? (
          <div data-slot="pagination-page-size" className="shrink-0">
            <Select
              value={String(pageSize)}
              onValueChange={(next) => onPageSizeChange(Number(next))}
              disabled={disabled}
            >
              <CompactSelectTrigger aria-label={t('ui.pagination.itemsPerPage.ariaLabel', 'Items per page')}>
                <SelectValue />
              </CompactSelectTrigger>
              <SelectContent>
                {pageSizeOptions.map((option) => (
                  <SelectItem key={option} value={String(option)}>
                    {resolvedFormatPageSizeLabel(option)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <div />
        )}
      </nav>
    )
  },
)
Pagination.displayName = 'Pagination'

export { cellVariants as paginationCellVariants, navButtonVariants as paginationNavVariants }
