'use client'

import * as React from 'react'

export function HorizontalDropBar({ position }: { position: 'top' | 'bottom' }) {
  return (
    <span
      aria-hidden="true"
      className={[
        'pointer-events-none absolute left-0 right-0 h-0.5 rounded-full bg-primary transition-opacity duration-150',
        position === 'top' ? '-top-1' : '-bottom-1',
      ].join(' ')}
    />
  )
}

export function VerticalDropBar({ position }: { position: 'left' | 'right' }) {
  return (
    <span
      aria-hidden="true"
      className={[
        'pointer-events-none absolute top-1 bottom-1 w-0.5 rounded-full bg-primary transition-opacity duration-150',
        position === 'left' ? '-left-1' : '-right-1',
      ].join(' ')}
    />
  )
}

export function GhostCell() {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 rounded-md border border-dashed border-primary bg-primary/10 ring-1 ring-primary/30 transition-opacity duration-150"
    />
  )
}
