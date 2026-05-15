"use client"

import * as React from 'react'
import { ChevronDown } from 'lucide-react'

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
    return (
      <button
        ref={ref}
        type="button"
        onClick={onClick}
        aria-label={ariaLabel ?? (label ? `${label}: ${value}` : value)}
        aria-pressed={active}
        className={`inline-flex items-center gap-[6px] rounded-[6px] border border-border bg-card px-[10px] py-[6px] text-[12px] leading-[normal] transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
          active ? 'border-foreground/40 bg-muted text-foreground' : 'text-foreground'
        }`}
      >
        {label ? <span className="font-normal text-muted-foreground">{label}:</span> : null}
        <span className={label ? 'font-semibold text-foreground' : 'font-normal text-foreground'}>
          {value}
        </span>
        {withChevron ? (
          <ChevronDown className="size-[12px] text-muted-foreground" aria-hidden="true" />
        ) : null}
      </button>
    )
  },
)

export default ChipButton
