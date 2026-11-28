"use client"

import * as React from 'react'
import { ChevronDown } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'

export type ChipButtonProps = {
  label?: string
  value: string
  active?: boolean
  ariaLabel?: string
  onClick?: () => void
  /** Show the chevron-down affordance — true for popover-backed chips, false for plain chips like "+ More" */
  withChevron?: boolean
}

export const ChipButton = React.forwardRef<HTMLButtonElement, ChipButtonProps>(
  function ChipButton(
    { label, value, active = false, ariaLabel, onClick, withChevron = true },
    ref,
  ) {
    const showValue = !label || active
    return (
      <Button
        variant="ghost"
        size="sm"
        ref={ref}
        type="button"
        onClick={onClick}
        aria-label={ariaLabel ?? (label ? `${label}: ${value}` : value)}
        aria-pressed={active}
        className={`inline-flex shrink-0 items-center gap-1.5 rounded-sm border border-border bg-card px-2.5 py-1.5 text-xs leading-normal transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
          active ? 'border-foreground/40 bg-muted text-foreground' : 'text-foreground'
        }`}
      >
        {label ? (
          <span className={`shrink-0 font-normal ${showValue ? 'text-muted-foreground' : 'text-foreground'}`}>
            {showValue ? `${label}:` : label}
          </span>
        ) : null}
        {showValue ? (
          <span className={`max-w-40 truncate ${label ? 'font-semibold text-foreground' : 'font-normal text-foreground'}`}>
            {value}
          </span>
        ) : null}
        {withChevron ? (
          <ChevronDown className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
        ) : null}
      </Button>
    )
  },
)

export default ChipButton
