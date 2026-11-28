'use client'

import * as React from 'react'
import { CircleCheck, CircleX } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { hasUsageVisuals, usagePairsFor, visibleUsageRules } from './usage-visuals/registry'
import type { UsagePair, UsageSide } from './usage-visuals/types'

export { hasUsageVisuals, visibleUsageRules }

function Tile({ tone, side }: { tone: 'do' | 'avoid'; side: UsageSide }) {
  const t = useT()
  const Mark = tone === 'do' ? CircleCheck : CircleX
  const markTone = tone === 'do' ? 'text-status-success-icon' : 'text-status-error-icon'
  const verdict = tone === 'do' ? t('design.usageVisuals.recommended', 'Recommended') : t('design.usageVisuals.avoided', 'Avoid')
  return (
    <figure className="flex min-w-0 flex-col gap-2" data-usage-visual={tone}>
      <div aria-hidden inert className="pointer-events-none flex h-24 select-none items-center justify-center overflow-hidden rounded-md bg-muted/50 p-2">
        {side.specimen}
      </div>
      <figcaption className="flex gap-1 text-sm leading-5 text-muted-foreground">
        <Mark aria-hidden className={`size-4 shrink-0 ${markTone}`} />
        <span className="min-w-0">
          <span className="sr-only">{verdict}: </span>
          {t(side.caption.key, side.caption.fallback)}
        </span>
      </figcaption>
    </figure>
  )
}

function Pair({ entryId, pair }: { entryId: string; pair: UsagePair }) {
  const t = useT()
  const titleId = `usage-visual-${entryId}-${pair.id}`
  return (
    <div role="group" aria-labelledby={titleId} className="flex min-w-0 flex-col gap-2" data-usage-pair={pair.id}>
      <h3 id={titleId} className="truncate text-sm font-normal leading-5 text-foreground">{t(pair.title.key, pair.title.fallback)}</h3>
      <div className="grid grid-cols-2 gap-2">
        <Tile tone="do" side={pair.do} />
        <Tile tone="avoid" side={pair.avoid} />
      </div>
    </div>
  )
}

export function UsageVisuals({ entryId }: { entryId: string }) {
  const pairs = usagePairsFor(entryId)
  if (pairs.length === 0) return null
  return (
    <div className="@container" data-usage-visuals={entryId}>
      <div className="grid gap-x-4 gap-y-6 @xl:grid-cols-2 @3xl:grid-cols-3">
        {pairs.map((pair) => <Pair key={pair.id} entryId={entryId} pair={pair} />)}
      </div>
    </div>
  )
}
