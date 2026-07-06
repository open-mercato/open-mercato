"use client"

import * as React from 'react'

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
 */

type TableContextValue = {
  variant: 'default' | 'striped'
}

const TableContext = React.createContext<TableContextValue>({ variant: 'default' })

export type TableVariant = 'default' | 'striped'

export type TableProps = React.HTMLAttributes<HTMLTableElement> & {
  /** `striped` adds even-row `bg-muted/20` tint per Figma. */
  variant?: TableVariant
}

export function Table({ className, variant = 'default', ...props }: TableProps) {
  const contextValue = React.useMemo(() => ({ variant }), [variant])
  return (
    <TableContext.Provider value={contextValue}>
      <table
        data-slot="table"
        data-variant={variant}
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
  return (
    <th
      ref={ref}
      data-slot="table-head"
      className={cn(
        'text-left font-medium px-4 py-2 whitespace-nowrap text-muted-foreground',
        className,
      )}
      {...props}
    />
  )
}

export function TableCell({
  className,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      data-slot="table-cell"
      className={cn('px-4 py-2', className)}
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
