"use client"

import * as React from 'react'

export function InspectorCard({
  title,
  hint,
  sampleLabel,
  children,
}: {
  title: string
  hint?: string
  sampleLabel?: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          {sampleLabel ? (
            <span className="rounded-md border border-border bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
              {sampleLabel}
            </span>
          ) : null}
        </div>
        {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
      </div>
      {children}
    </section>
  )
}
