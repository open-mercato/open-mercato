"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { translateWithFallback } from '@open-mercato/shared/lib/i18n/translate'

type AddStageLaneProps = {
  onClick: () => void
  disabled?: boolean
}

export function AddStageLane({ onClick, disabled = false }: AddStageLaneProps): React.ReactElement {
  const t = useT()
  const label = translateWithFallback(t, 'customers.deals.kanban.cta.newStage', 'New stage')

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="group flex w-[308px] min-h-[60vh] flex-none flex-col items-center justify-center gap-[7px] rounded-[14px] border border-dashed border-muted-foreground/60 bg-muted/40 px-[14px] py-[19px] text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <span className="text-[27px] font-bold leading-none">+</span>
      <span className="text-[16px] font-semibold leading-[normal]">{label}</span>
    </button>
  )
}

export default AddStageLane
