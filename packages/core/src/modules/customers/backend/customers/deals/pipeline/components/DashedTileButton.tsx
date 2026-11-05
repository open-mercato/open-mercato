"use client"

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'

export type DashedTileButtonProps = {
  onClick: () => void
  disabled?: boolean
  ariaLabel?: string
  title?: string
  /**
   * Extra utility classes appended after the shared dashed-tile chrome. Use this for
   * width/height/orientation tweaks that vary per consumer (e.g. AddStageLane needs
   * `min-h-[60vh]` + `flex-col`, quick-add needs `h-11`, show-more needs `px-3 py-2.5`).
   */
  className?: string
  children: React.ReactNode
}

/**
 * Shared chrome for the three dashed-outline CTAs on the kanban board:
 *   - quick-add per lane (Lane.tsx)
 *   - show-more per lane (Lane.tsx)
 *   - new-stage lane (AddStageLane.tsx)
 *
 * Before extraction each consumer hand-rolled the same 8–10 utility classes plus its own
 * focus-ring + dashed-border styling; drift between the three was a Figma compliance risk
 * (and was flagged in the SPEC-048 UX review as item 19). Centralising the styles here
 * keeps the trio in sync.
 */
export function DashedTileButton({
  onClick,
  disabled = false,
  ariaLabel,
  title,
  className,
  children,
}: DashedTileButtonProps): React.ReactElement {
  return (
    <Button
      variant="ghost"
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      title={title}
      className={`group flex items-center justify-center gap-2.5 rounded-lg border border-dashed border-muted-foreground/60 bg-muted/40 text-sm font-semibold leading-normal text-foreground transition-colors hover:bg-muted/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${className ?? ''}`.trim()}
    >
      {children}
    </Button>
  )
}

export default DashedTileButton
