"use client"

import * as React from 'react'
import { X } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { translateWithFallback } from '@open-mercato/shared/lib/i18n/translate'

type FilterPopoverShellProps = {
  /** Title rendered in the header (e.g. "Filter · Status", "Sort by") */
  title: React.ReactNode
  /** Optional icon rendered before the title (Sort by uses a tag icon per Figma) */
  leadingIcon?: React.ReactNode
  /** Body content — sits between header and footer */
  children: React.ReactNode
  /** Footer left content — usually a "N selected" hint or "Default: …" subtitle */
  footerLeft?: React.ReactNode
  /** Called when the X close button is clicked */
  onClose: () => void
  /** Called when Cancel is clicked */
  onCancel: () => void
  /** Called when Apply (primary CTA) is clicked */
  onApply: () => void
  /** Override the primary CTA label (e.g. "Add" on the +Add-filter popover) */
  applyLabel?: string
  /** Body wrapper className override — defaults to standard padded white block */
  bodyClassName?: string
}

/**
 * Shared chrome for every kanban filter popover (Status, Pipeline, Sort, Owner, People,
 * Companies, Close). Matches the SPEC-048 Figma popover surfaces (nodes 1045:11861,
 * 1045:11917, 1045:12090): rounded-2xl outer, white header w/ bold title + close button,
 * white body, muted footer with Cancel + Apply.
 *
 * Each consumer renders its own body — checkboxes, pills, radio rows, date picker, etc. —
 * inside this shell, so the chrome stays identical across every filter surface and the
 * styling delta lives only inside `children`.
 */
export function FilterPopoverShell({
  title,
  leadingIcon,
  children,
  footerLeft,
  onClose,
  onCancel,
  onApply,
  applyLabel,
  bodyClassName,
}: FilterPopoverShellProps): React.ReactElement {
  const t = useT()
  return (
    <div className="flex flex-col overflow-hidden rounded-2xl bg-muted/30">
      <div className="flex items-center justify-between border-b border-border bg-card px-5 py-4">
        <div className="flex items-center gap-2">
          {leadingIcon ? (
            <span className="flex size-4 items-center justify-center text-muted-foreground" aria-hidden="true">
              {leadingIcon}
            </span>
          ) : null}
          <span className="text-base font-bold leading-normal text-foreground">{title}</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={translateWithFallback(t, 'customers.deals.kanban.filter.close', 'Close')}
          className="flex size-7 items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      </div>

      <div className={bodyClassName ?? 'flex flex-col gap-4 bg-card px-5 py-4'}>{children}</div>

      <div className="flex items-center justify-between border-t border-border bg-muted/30 px-5 py-3.5">
        <div className="text-xs leading-normal text-muted-foreground">{footerLeft ?? null}</div>
        <div className="flex items-center gap-6">
          <Button
            variant="outline"
            type="button"
            onClick={onCancel}
            className="h-auto rounded-lg border-input bg-card px-4 py-2 text-sm font-semibold text-foreground"
          >
            {translateWithFallback(t, 'customers.deals.kanban.filter.cancel', 'Cancel')}
          </Button>
          <Button
            type="button"
            onClick={onApply}
            className="h-auto rounded-lg bg-foreground px-5 py-2 text-sm font-semibold text-background hover:bg-foreground/90"
          >
            {applyLabel ?? translateWithFallback(t, 'customers.deals.kanban.filter.apply', 'Apply')}
          </Button>
        </div>
      </div>
    </div>
  )
}

export default FilterPopoverShell
