"use client"

import * as React from 'react'
import { Medal } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'

export type TierMedalProps = {
  /** Position in the ascending ladder, exactly as `resolveTier` reports it. `-1` means no tier yet. */
  rank: number
  className?: string
}

/**
 * The medal beside a loyalty tier.
 *
 * Driven by the RANK, never by the key. A tenant may rename the ladder — "basic / pro / elite" is as
 * legitimate as bronze / silver / gold — so matching on the word `gold` would leave every renamed ladder
 * without a medal while looking like it worked on the default one.
 *
 * Capped at the third rung: a ladder longer than three has no fourth metal, and everything above gold reading
 * as gold is the honest simplification. A rank below zero is not a tier, so it gets nothing rather than a
 * medal for having no medal.
 *
 * Colours come from the categorical `chart-*` family rather than status tokens, because a tier is a category
 * and not an outcome — a bronze customer is not a warning. Silver is the neutral foreground, which is the one
 * place the design system's grey happens to be exactly the right metal.
 */
export function TierMedal({ rank, className }: TierMedalProps) {
  if (rank < 0) return null
  const tone = rank === 0
    ? 'text-chart-orange'
    : rank === 1
      ? 'text-muted-foreground'
      : 'text-chart-amber'
  return <Medal aria-hidden="true" className={cn('size-4 shrink-0', tone, className)} />
}
