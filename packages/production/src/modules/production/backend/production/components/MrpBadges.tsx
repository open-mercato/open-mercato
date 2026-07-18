'use client'

import * as React from 'react'
import { Badge } from '@open-mercato/ui/primitives/badge'

type Translate = (key: string, fallback?: string) => string

export type MrpRunStatus = 'pending' | 'running' | 'completed' | 'failed'
export type MrpSuggestionType = 'make' | 'buy' | 'reschedule' | 'cancel'
export type MrpSuggestionStatus = 'open' | 'accepted' | 'dismissed' | 'superseded'

const RUN_STATUS_VARIANT: Record<MrpRunStatus, 'neutral' | 'info' | 'warning' | 'success' | 'error'> = {
  pending: 'neutral',
  running: 'info',
  completed: 'success',
  failed: 'error',
}

const SUGGESTION_TYPE_VARIANT: Record<MrpSuggestionType, 'info' | 'brand' | 'warning' | 'error'> = {
  make: 'info',
  buy: 'brand',
  reschedule: 'warning',
  cancel: 'error',
}

const SUGGESTION_STATUS_VARIANT: Record<MrpSuggestionStatus, 'neutral' | 'success' | 'muted' | 'warning'> = {
  open: 'neutral',
  accepted: 'success',
  dismissed: 'muted',
  superseded: 'warning',
}

/** MRP run status pill (task 5.4), same conventions as `OrderStatusBadge`. */
export function MrpRunStatusBadge({ status, t }: { status: MrpRunStatus; t: Translate }) {
  return (
    <Badge variant={RUN_STATUS_VARIANT[status] ?? 'neutral'}>
      {t(`production.mrp.run.status.${status}`, status)}
    </Badge>
  )
}

/** MRP suggestion type pill (make/buy/reschedule/cancel). */
export function MrpSuggestionTypeBadge({ type, t }: { type: MrpSuggestionType; t: Translate }) {
  return (
    <Badge variant={SUGGESTION_TYPE_VARIANT[type] ?? 'info'}>
      {t(`production.mrp.suggestion.type.${type}`, type)}
    </Badge>
  )
}

/** MRP suggestion status pill (open/accepted/dismissed/superseded). */
export function MrpSuggestionStatusBadge({ status, t }: { status: MrpSuggestionStatus; t: Translate }) {
  return (
    <Badge variant={SUGGESTION_STATUS_VARIANT[status] ?? 'neutral'}>
      {t(`production.mrp.suggestion.status.${status}`, status)}
    </Badge>
  )
}
