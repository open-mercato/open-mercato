"use client"

import * as React from 'react'
import { Spinner } from '@open-mercato/ui/primitives/spinner'

export type PlotMapPreviewProps = {
  features: unknown[]
  height?: number
}

type PlotMapPreviewComponent = (props: PlotMapPreviewProps) => React.ReactElement

export function PlotMapPreview(props: PlotMapPreviewProps): React.ReactElement {
  const [Impl, setImpl] = React.useState<PlotMapPreviewComponent | null>(null)
  const height = props.height ?? 280

  React.useEffect(() => {
    let cancelled = false
    void import('./PlotMapPreviewImpl').then((mod) => {
      if (!cancelled) setImpl(() => mod.default)
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (!Impl) {
    return (
      <div
        data-testid="eudr-plot-map-preview"
        className="flex items-center justify-center rounded-md border border-border bg-muted/30"
        style={{ minHeight: height }}
      >
        <Spinner className="size-6 text-muted-foreground" />
      </div>
    )
  }

  return (
    <div data-testid="eudr-plot-map-preview">
      <Impl {...props} />
    </div>
  )
}

export default PlotMapPreview
