"use client"

import * as React from 'react'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import type { FilterOptionTone } from '@open-mercato/shared/lib/query/advanced-filter'

export type MapCenter = {
  latitude: number
  longitude: number
}

export type DealsMapCanvasDeal = {
  id: string
  latitude: number
  longitude: number
  tone: FilterOptionTone | null
}

export type DealsMapLegendStage = {
  id: string
  label: string
  tone: FilterOptionTone | null
}

export type DealsMapPreview = {
  id: string
  title: string
  companyLabel: string | null
  locationLine: string | null
  valueAmount: number | null
  valueCurrency: string | null
  probability: number | null
  expectedCloseAt: string | null
  stageLabel: string | null
  stageTone: FilterOptionTone | null
  ownerName: string | null
}

export type DealsMapCanvasProps = {
  deals: DealsMapCanvasDeal[]
  legendStages: DealsMapLegendStage[]
  preview: DealsMapPreview | null
  selectedDealId: string | null
  onSelect: (dealId: string | null) => void
  onCenterChange: (center: MapCenter) => void
  className?: string
}

type DealsMapCanvasComponent = (props: DealsMapCanvasProps) => React.ReactElement

/**
 * Lazy shell around the Leaflet implementation. Leaflet touches `window` at import time and ships
 * its own CSS, so the impl chunk (JS + stylesheets) is imported client-side only — on first mount,
 * inside an effect — which keeps it out of SSR while rendering a prop-sized placeholder until it
 * resolves. A single dynamic `import()` drives both the lazy load and the fallback.
 */
export function DealsMapCanvas(props: DealsMapCanvasProps): React.ReactElement {
  const [Impl, setImpl] = React.useState<DealsMapCanvasComponent | null>(null)
  React.useEffect(() => {
    let cancelled = false
    void import('./DealsMapCanvasImpl').then((mod) => {
      if (!cancelled) setImpl(() => mod.default)
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (!Impl) {
    return (
      <div className={`flex items-center justify-center bg-muted/30 ${props.className ?? ''}`.trim()}>
        <Spinner className="size-6 text-muted-foreground" />
      </div>
    )
  }
  return <Impl {...props} />
}

export default DealsMapCanvas
