"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { translateWithFallback } from '@open-mercato/shared/lib/i18n/translate'
import { DashedTileButton } from './DashedTileButton'
import { LANE_WIDTH_CLASS } from './constants'

type AddStageLaneProps = {
  onClick: () => void
  disabled?: boolean
}

export function AddStageLane({ onClick, disabled = false }: AddStageLaneProps): React.ReactElement {
  const t = useT()
  const label = translateWithFallback(t, 'customers.deals.kanban.cta.newStage', 'New stage')

  return (
    <DashedTileButton
      onClick={onClick}
      disabled={disabled}
      ariaLabel={label}
      className={`${LANE_WIDTH_CLASS} flex-none flex-col rounded-xl px-3.5 py-5 text-muted-foreground hover:text-foreground min-h-[60vh]`}
    >
      <span className="text-3xl font-bold leading-none">+</span>
      <span className="text-base font-semibold leading-normal">{label}</span>
    </DashedTileButton>
  )
}

export default AddStageLane
