"use client"

import * as React from 'react'
import dynamic from 'next/dynamic'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import type { XrayProcessMapCanvasProps } from './XrayProcessMapCanvas'

function XrayProcessMapPlaceholder() {
  return (
    <div className="flex h-80 w-full items-center justify-center rounded-lg border border-border bg-muted/30">
      <Spinner className="size-6 text-muted-foreground" />
    </div>
  )
}

const XrayProcessMapCanvas = dynamic(() => import('./XrayProcessMapCanvas'), {
  ssr: false,
  loading: () => <XrayProcessMapPlaceholder />,
})

/** Client island of the process map: React Flow and dagre load only in the browser. */
export function XrayProcessMap(props: XrayProcessMapCanvasProps) {
  return <XrayProcessMapCanvas {...props} />
}

export type { XrayMapSelection } from './XrayProcessMapCanvas'
