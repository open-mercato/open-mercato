import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'

const WIDTH_CLASS = {
  wide: 'max-w-7xl',
  default: 'max-w-5xl',
  narrow: 'max-w-3xl',
} as const

export type ScreenWidth = keyof typeof WIDTH_CLASS

type ScreenFrameProps = {
  width?: ScreenWidth
  className?: string
  children: React.ReactNode
}

export function ScreenFrame({ width = 'wide', className, children }: ScreenFrameProps) {
  return (
    <div
      data-slot="screen-frame"
      className="relative transform-gpu overflow-hidden rounded-card border border-border bg-background text-foreground"
    >
      <div data-slot="screen-page" className={cn('mx-auto flex w-full flex-col gap-section p-page', WIDTH_CLASS[width], className)}>
        {children}
      </div>
    </div>
  )
}

export function wait(milliseconds: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}
