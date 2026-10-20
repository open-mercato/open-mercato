"use client"

import * as React from 'react'
import { Clock, EyeOff, TriangleAlert, Users } from 'lucide-react'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { formatCount, formatXrayDateTime } from '../../lib/client/xray/format'

export type XrayResultMetaView = {
  n: number
  lowConfidence?: boolean
  computedThrough: string | null
  incomplete: boolean
  kAnonymity?: number
  suppressed?: { cells: number; complementary: number }
  window?: { from: string; to: string }
}

/**
 * The statistical and privacy context every X-Ray result is shown with: the population size
 * `n`, the low-confidence flag (n < 30), cells hidden for privacy, the analysed window and
 * whether the projection is complete (`computedThrough`) or still catching up (`incomplete`).
 * Meaning is carried by text and icons, never by color alone.
 */
export function XrayResultMeta({ meta, nLabelKey = 'insights.xray.ui.meta.cases' }: { meta: XrayResultMetaView; nLabelKey?: string }) {
  const t = useT()
  const locale = useLocale()
  const through = formatXrayDateTime(meta.computedThrough, locale)
  const from = meta.window ? formatXrayDateTime(meta.window.from, locale) : null
  const to = meta.window ? formatXrayDateTime(meta.window.to, locale) : null
  const hiddenCells = meta.suppressed?.cells ?? 0
  return (
    <div className="space-y-2" data-testid="xray-result-meta">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1 text-sm font-medium text-foreground" data-testid="xray-result-n">
          <Users className="size-4 text-muted-foreground" aria-hidden="true" />
          {t(nLabelKey, { count: formatCount(meta.n, locale) })}
        </span>
        {meta.lowConfidence ? (
          <span data-testid="xray-low-confidence">
            <StatusBadge variant="warning">
              <TriangleAlert className="size-3" aria-hidden="true" />
              {t('insights.xray.ui.meta.lowConfidence')}
            </StatusBadge>
          </span>
        ) : null}
        {hiddenCells > 0 ? (
          <span data-testid="xray-suppressed">
            <StatusBadge variant="neutral">
              <EyeOff className="size-3" aria-hidden="true" />
              {t('insights.xray.ui.meta.suppressed', { count: formatCount(hiddenCells, locale) })}
            </StatusBadge>
          </span>
        ) : null}
        {from && to ? <span>{t('insights.xray.ui.meta.window', { from, to })}</span> : null}
        {!meta.incomplete && through ? (
          <span className="inline-flex items-center gap-1" data-testid="xray-computed-through">
            <Clock className="size-3" aria-hidden="true" />
            {t('insights.xray.ui.meta.computedThrough', { at: through })}
          </span>
        ) : null}
      </div>
      {hiddenCells > 0 ? (
        <p className="text-xs text-muted-foreground">
          {t('insights.xray.ui.meta.suppressedHelp', { k: formatCount(meta.kAnonymity ?? 0, locale) })}
        </p>
      ) : null}
      {meta.lowConfidence ? (
        <p className="text-xs text-muted-foreground">{t('insights.xray.ui.meta.lowConfidenceHelp')}</p>
      ) : null}
      {meta.incomplete ? (
        <Alert status="warning" size="default" data-testid="xray-incomplete">
          <AlertTitle>{t('insights.xray.ui.meta.incompleteTitle')}</AlertTitle>
          <AlertDescription>{t('insights.xray.ui.meta.incompleteDescription')}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  )
}
