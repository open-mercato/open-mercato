'use client'

import * as React from 'react'
import dynamic from 'next/dynamic'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import type { CampaignCanvasProps } from './CampaignCanvasImpl'

/**
 * `@xyflow/react` is several megabytes and has no business in the server bundle, so the canvas
 * is loaded behind `next/dynamic({ ssr: false })` — the same boundary the workflow editor uses.
 */
const CampaignCanvasImpl = dynamic(() => import('./CampaignCanvasImpl'), {
  ssr: false,
  loading: () => (
    <div className="flex h-[70vh] items-center justify-center rounded-md border border-border bg-background">
      <Spinner />
    </div>
  ),
})

export function CampaignCanvas(props: CampaignCanvasProps) {
  return <CampaignCanvasImpl {...props} />
}

export type { CampaignCanvasProps }
