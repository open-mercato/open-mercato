"use client"

import * as React from 'react'
import { resolveProjectColorHex } from './colors'

export type ProjectColorDotSize = 'xs' | 'sm' | 'md'

export type ProjectColorDotProps = {
  colorKey: string | null | undefined
  projectName: string | null | undefined
  size?: ProjectColorDotSize
  className?: string
  title?: string
}

const SIZE_CLASS: Record<ProjectColorDotSize, string> = {
  xs: 'h-2 w-2',
  sm: 'h-2.5 w-2.5',
  md: 'h-3 w-3',
}

export function ProjectColorDot({
  colorKey,
  projectName,
  size = 'sm',
  className,
  title,
}: ProjectColorDotProps) {
  const hex = resolveProjectColorHex(colorKey, projectName)
  const base = 'inline-block shrink-0 rounded-full'
  const classes = [base, SIZE_CLASS[size], className].filter(Boolean).join(' ')
  return (
    <span
      aria-hidden="true"
      title={title}
      className={classes}
      style={{ backgroundColor: hex }}
    />
  )
}
