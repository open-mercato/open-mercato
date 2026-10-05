"use client"

import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'

/**
 * One row in the small record lists that sit inside panels and asides.
 *
 * Six of these existed as the same hand-copied class string — four on the customer profile, one in the
 * segment members aside, one in the campaign history aside — so changing how a row looks meant six edits and
 * six chances to miss one. They stay lists rather than becoming `DataTable`s because each is a short, capped
 * panel in a narrow column, not a surface anybody pages, sorts or exports.
 */
export function RecordRow({ children, className, ...rest }: React.LiHTMLAttributes<HTMLLIElement>) {
  return (
    <li
      {...rest}
      className={cn(
        'flex items-baseline justify-between gap-2 border-b border-border py-1 text-sm last:border-b-0',
        className,
      )}
    >
      {children}
    </li>
  )
}
