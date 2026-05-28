"use client"

import * as React from 'react'
import { Wand2 } from 'lucide-react'

export type DealTipsCardProps = {
  title: string
  tips: string[]
}

export function DealTipsCard({ title, tips }: DealTipsCardProps) {
  return (
    <div className="rounded-lg border-l-4 border-status-info-border bg-status-info-bg px-5 py-4 space-y-3">
      <div className="flex items-center gap-2">
        <Wand2 className="size-4 text-status-info-icon" />
        <p className="text-sm font-semibold text-status-info-text">{title}</p>
      </div>
      {tips.map((tip, index) => (
        <div key={`${tip}-${index}`} className="flex items-start gap-2">
          <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-status-info-icon" />
          <p className="text-xs text-muted-foreground">{tip}</p>
        </div>
      ))}
    </div>
  )
}
