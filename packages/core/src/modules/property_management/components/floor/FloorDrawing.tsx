"use client"

import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'
import { formatMetres, type LayoutRect } from './types'
import { rectStyle } from './scale'

export type FloorDrawingProps = {
  sizeX: number
  sizeY: number
  pxPerMetre: number
  ariaLabel: string
  floorRef?: React.Ref<HTMLDivElement>
  interactive?: boolean
  children?: React.ReactNode
}

export function FloorDrawing({ sizeX, sizeY, pxPerMetre, ariaLabel, floorRef, interactive, children }: FloorDrawingProps) {
  const style: React.CSSProperties = {
    width: `${sizeX * pxPerMetre}px`,
    height: `${sizeY * pxPerMetre}px`,
    backgroundImage:
      'linear-gradient(to right, var(--border) 1px, transparent 1px), linear-gradient(to bottom, var(--border) 1px, transparent 1px)',
    backgroundSize: `${pxPerMetre}px ${pxPerMetre}px`,
  }
  return (
    <div className="overflow-x-auto pb-2">
      <div className="inline-flex flex-col gap-1">
        <span className="pl-6 text-center text-xs text-muted-foreground">{formatMetres(sizeX)} m</span>
        <div className="flex gap-1">
          <span className="flex w-5 items-center justify-center text-xs text-muted-foreground" style={{ writingMode: 'vertical-rl' }}>
            {formatMetres(sizeY)} m
          </span>
          <div
            ref={floorRef}
            role={interactive ? 'group' : 'img'}
            aria-label={ariaLabel}
            data-testid="floor-drawing"
            className="relative border-2 border-foreground/60 bg-background"
            style={style}
          >
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}

export type LayoutTileVariant = 'space' | 'leasable' | 'bookable' | 'unit' | 'commonArea' | 'target'

const VARIANT_CLASSES: Record<LayoutTileVariant, string> = {
  space: 'border-2 border-dashed border-muted-foreground/60',
  leasable: 'border border-foreground/50 bg-card',
  bookable: 'border border-accent-indigo bg-accent-indigo/10',
  unit: 'border border-foreground/50 bg-card',
  commonArea: 'border border-border bg-muted',
  target: 'z-10 border-2 border-primary bg-primary/10',
}

export type LayoutTileProps = {
  rect: LayoutRect
  sizeX: number
  sizeY: number
  variant: LayoutTileVariant
  label?: string
  sublabel?: string | null
  faded?: boolean
  flagged?: boolean
  className?: string
  children?: React.ReactNode
  tileProps?: React.HTMLAttributes<HTMLDivElement> & Record<`data-${string}`, string | undefined>
}

export function LayoutTile({ rect, sizeX, sizeY, variant, label, sublabel, faded, flagged, className, children, tileProps }: LayoutTileProps) {
  return (
    <div
      {...tileProps}
      className={cn(
        'absolute overflow-hidden rounded-sm',
        VARIANT_CLASSES[variant],
        faded ? 'opacity-40' : null,
        flagged ? 'ring-2 ring-status-error-border' : null,
        className,
      )}
      style={rectStyle(rect, sizeX, sizeY)}
    >
      {label ? (
        <span className={cn('block truncate px-1 text-xs', variant === 'space' ? 'font-medium text-muted-foreground' : 'text-foreground')}>
          {sublabel ? <span className="block truncate text-muted-foreground">{sublabel}</span> : null}
          {label}
        </span>
      ) : null}
      {children}
    </div>
  )
}
