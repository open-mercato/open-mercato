'use client'

import * as React from 'react'
import { cn } from '../lib/cn'
import { ChevronLeftIcon, ChevronRightIcon } from '../lib/icons'
import { Button } from './button'

export type PaginationLabels = {
  navigation: string
  previous: string
  next: string
  /** Accessible name for a page link, for example `(n) => \`Page ${n}\``. */
  page: (page: number) => string
}

export type PaginationProps = Omit<React.ComponentPropsWithoutRef<'nav'>, 'children'> & {
  page: number
  pageCount: number
  onPageChange: (page: number) => void
  labels: PaginationLabels
  /** Pages shown around the current one before an ellipsis. */
  siblings?: number
}

function range(page: number, pageCount: number, siblings: number): Array<number | 'gap'> {
  const pages = new Set<number>([1, pageCount])
  for (let index = page - siblings; index <= page + siblings; index += 1) {
    if (index >= 1 && index <= pageCount) pages.add(index)
  }
  const sorted = Array.from(pages).sort((a, b) => a - b)
  const out: Array<number | 'gap'> = []
  sorted.forEach((value, index) => {
    if (index > 0 && value - sorted[index - 1] > 1) out.push('gap')
    out.push(value)
  })
  return out
}

/** Numbered pagination for tables and B2B lists; storefront listings use `Pagination.LoadMore`. */
const PaginationRoot = React.forwardRef<HTMLElement, PaginationProps>(function Pagination(
  { page, pageCount, onPageChange, labels, siblings = 1, className, ...props },
  ref,
) {
  if (pageCount <= 1) return null
  const itemClass = 'flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-sf-chip text-sf-body-sm text-foreground outline-none transition-colors hover:bg-muted focus-visible:shadow-focus disabled:cursor-not-allowed disabled:text-text-disabled [&_svg]:size-4'
  return (
    <nav ref={ref} aria-label={labels.navigation} data-slot="pagination" className={cn('flex items-center justify-center', className)} {...props}>
      <ul className="flex items-center gap-1">
        <li>
          <button type="button" className={itemClass} aria-label={labels.previous} disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
            <ChevronLeftIcon />
          </button>
        </li>
        {range(page, pageCount, siblings).map((item, index) =>
          item === 'gap' ? (
            <li key={`gap-${index}`} aria-hidden="true" className="flex size-9 items-center justify-center text-muted-foreground">…</li>
          ) : (
            <li key={item}>
              <button
                type="button"
                className={cn(itemClass, item === page && 'bg-primary text-primary-foreground hover:bg-primary')}
                aria-label={labels.page(item)}
                aria-current={item === page ? 'page' : undefined}
                onClick={() => onPageChange(item)}
              >
                {item}
              </button>
            </li>
          ),
        )}
        <li>
          <button type="button" className={itemClass} aria-label={labels.next} disabled={page >= pageCount} onClick={() => onPageChange(page + 1)}>
            <ChevronRightIcon />
          </button>
        </li>
      </ul>
    </nav>
  )
})

export type PaginationLoadMoreProps = Omit<React.ComponentPropsWithoutRef<'div'>, 'children'> & {
  shown: number
  total: number
  /** Renders the action as a link, so the next page works without JavaScript and is crawlable. */
  href?: string
  onLoadMore?: (event: React.MouseEvent<HTMLElement>) => void
  loading?: boolean
  /** Overrides the shown >= total check when the server decides continuation, for example `page < totalPages`. */
  hasMore?: boolean
  /** Omit `showing` when the total is not exact: the count and the bar are then hidden. */
  labels: { showing?: React.ReactNode; loadMore: React.ReactNode }
}

/** "Showing X of Y", a thin progress bar and one button; the app moves focus to the first new item after loading. */
const PaginationLoadMore = React.forwardRef<HTMLDivElement, PaginationLoadMoreProps>(function PaginationLoadMore(
  { shown, total, hasMore, href, onLoadMore, loading, labels, className, ...props },
  ref,
) {
  const done = hasMore === undefined ? shown >= total : !hasMore
  const percent = total > 0 ? Math.min(100, Math.round((shown / total) * 100)) : 100
  return (
    <div ref={ref} data-slot="pagination-load-more" className={cn('flex flex-col items-center gap-3', className)} {...props}>
      {labels.showing ? (
        <>
            <p aria-live="polite" className="text-sf-body-xs text-muted-foreground">{labels.showing}</p>
            <div aria-hidden="true" className="h-1 w-50 overflow-hidden rounded-full bg-border">
              <div className="h-full bg-foreground transition-[width] duration-(--sf-motion-slow)" style={{ width: `${percent}%` }} />
            </div>
        </>
      ) : null}
      {done ? null : (
        href ? (
          <Button asChild variant="outline" aria-busy={loading || undefined}>
            <a href={href} onClick={onLoadMore}>{labels.loadMore}</a>
          </Button>
        ) : (
          <Button variant="outline" loading={loading} onClick={onLoadMore}>
            {labels.loadMore}
          </Button>
        )
      )}
    </div>
  )
})

export const Pagination = Object.assign(PaginationRoot, { LoadMore: PaginationLoadMore })
