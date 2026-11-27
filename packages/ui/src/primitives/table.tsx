"use client"

import * as React from 'react'
import { ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react'

import { cn } from '@open-mercato/shared/lib/utils'

/**
 * Low-level table primitive used by `DataTable` and a handful of
 * direct consumers (`DictionaryEntriesEditor.tsx`). Phase B.6 polish
 * aligns the chrome with Figma `Table` page (`553:14955`):
 *
 * - `Table Header Cell [1.1]` (`587:5793`) — subtle `bg-muted/40`
 *   header strip + sortable chevron slot
 * - `Table Row Cell [1.1]` (`553:22175`) — comfortable padding,
 *   hover affordance
 * - `Sorting Icons [1.1]` (`581:2327`) — handled by DataTable
 * - Assembled examples in `Blocks` (167144:147461 et al.) confirm
 *   the chrome.
 *
 * Backward compatibility: every existing export (`Table`,
 * `TableHeader`, `TableBody`, `TableRow`, `TableHead`, `TableCell`)
 * stays callable verbatim. Header now ships a subtle `bg-muted/40`
 * strip — visible-but-soft polish per Figma. Row hover ships
 * `hover:bg-muted/30`. Both default to the new look since the spec
 * scope calls for "row-hover state token" + "header cell padding
 * alignment with Figma".
 *
 * New (additive):
 * - `<Table variant="striped">` — even-row bg-muted/20 tint per
 *   Figma striped block.
 * - `<TableFooter>` — bordered top footer row group.
 * - `<TableCaption>` — accessible caption above the table.
 * - `<TableSortHead>` / `<TableSortButton>` — sortable column header: a flat
 *   label with a direction chevron, `aria-sort` on the header cell.
 */

export type TableSize = 'compact' | 'default' | 'comfortable'

type TableContextValue = {
  variant: 'default' | 'striped'
  size: TableSize
}

const TableContext = React.createContext<TableContextValue>({ variant: 'default', size: 'default' })

const CELL_HEIGHT: Record<TableSize, string> = {
  compact: 'h-8 py-1',
  default: 'h-10 py-2',
  comfortable: 'h-12 py-3',
}

export type TableVariant = 'default' | 'striped'

export type TableProps = React.HTMLAttributes<HTMLTableElement> & {
  /** `striped` adds even-row `bg-muted/20` tint per Figma. */
  variant?: TableVariant
  /** Row height: compact 32, default 40, comfortable 48 px. */
  size?: TableSize
}

export function Table({ className, variant = 'default', size = 'default', ...props }: TableProps) {
  const contextValue = React.useMemo(() => ({ variant, size }), [variant, size])
  return (
    <TableContext.Provider value={contextValue}>
      <table
        data-slot="table"
        data-variant={variant}
        data-size={size}
        className={cn('w-full text-sm', className)}
        {...props}
      />
    </TableContext.Provider>
  )
}

export function TableHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      data-slot="table-header"
      className={cn('bg-muted/40 [&_tr]:border-b', className)}
      {...props}
    />
  )
}

export function TableBody(props: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody data-slot="table-body" {...props} />
}

export function TableFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn('border-t bg-muted/40 font-medium', className)}
      {...props}
    />
  )
}

export type TableRowProps = React.HTMLAttributes<HTMLTableRowElement>

export function TableRow({ className, ...props }: TableRowProps) {
  const { variant } = React.useContext(TableContext)
  return (
    <tr
      data-slot="table-row"
      className={cn(
        'border-b last:border-b-0 transition-colors',
        // Row hover affordance — only applies to body rows (header
        // rows have their own bg-muted/40 strip and shouldn't bounce
        // on hover). Children that are inside <thead> bypass via
        // CSS-attribute selectors at the consumer level if needed.
        '[&:not(thead_*)]:hover:bg-muted/30',
        variant === 'striped' ? '[&:not(thead_*)]:even:bg-muted/20' : '',
        className,
      )}
      {...props}
    />
  )
}

export function TableHead({
  className,
  ref,
  ...props
}: React.ThHTMLAttributes<HTMLTableCellElement> & {
  ref?: React.Ref<HTMLTableCellElement>
}) {
  const { size } = React.useContext(TableContext)
  return (
    <th
      ref={ref}
      data-slot="table-head"
      className={cn(
        'text-left font-medium px-4 whitespace-nowrap text-muted-foreground',
        CELL_HEIGHT[size],
        className,
      )}
      {...props}
    />
  )
}

export type TableSortDirection = 'ascending' | 'descending' | 'none'

export type TableSortButtonProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'type'> & {
  direction?: TableSortDirection
  align?: 'left' | 'right'
}

export function TableSortButton({
  direction = 'none',
  align = 'left',
  className,
  children,
  ...props
}: TableSortButtonProps) {
  const Icon = direction === 'ascending' ? ChevronUp : direction === 'descending' ? ChevronDown : ChevronsUpDown
  return (
    <button
      type="button"
      data-slot="table-sort-button"
      data-direction={direction}
      className={cn(
        '-mx-1 inline-flex min-h-8 max-w-full cursor-pointer select-none items-center gap-1 rounded-sm px-1 text-left outline-none transition-colors',
        'text-muted-foreground hover:text-foreground focus-visible:shadow-focus',
        'disabled:cursor-not-allowed disabled:text-text-disabled disabled:hover:text-text-disabled',
        direction !== 'none' ? 'text-foreground' : '',
        align === 'right' ? 'flex-row-reverse text-right' : '',
        className,
      )}
      {...props}
    >
      <span className="truncate">{children}</span>
      <Icon
        aria-hidden="true"
        className={cn('size-3.5 shrink-0', direction === 'none' ? 'opacity-50' : '')}
      />
    </button>
  )
}

export type TableSortHeadProps = Omit<React.ThHTMLAttributes<HTMLTableCellElement>, 'onClick'> & {
  direction?: TableSortDirection
  onSort?: () => void
  align?: 'left' | 'right'
  disabled?: boolean
  ref?: React.Ref<HTMLTableCellElement>
}

export function TableSortHead({
  direction = 'none',
  onSort,
  align = 'left',
  disabled,
  className,
  children,
  ...props
}: TableSortHeadProps) {
  return (
    <TableHead
      scope="col"
      aria-sort={direction}
      className={cn(align === 'right' ? 'text-right' : '', className)}
      {...props}
    >
      <TableSortButton direction={direction} align={align} disabled={disabled} onClick={onSort}>
        {children}
      </TableSortButton>
    </TableHead>
  )
}

export function TableCell({
  className,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement>) {
  const { size } = React.useContext(TableContext)
  return (
    <td
      data-slot="table-cell"
      className={cn('px-4', CELL_HEIGHT[size], className)}
      {...props}
    />
  )
}

export function TableCaption({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableCaptionElement>) {
  return (
    <caption
      data-slot="table-caption"
      className={cn('mt-2 text-sm text-muted-foreground', className)}
      {...props}
    />
  )
}
