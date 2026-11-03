'use client'

import * as React from 'react'

/**
 * Bordered stage a variant renders inside. Chrome uses semantic tokens only —
 * the stage must never impose colors of its own on the previewed component.
 */
export function VariantPreview({ children, framed = true }: { children: React.ReactNode; framed?: boolean }) {
  return (
    <div className={framed ? 'flex min-w-0 flex-wrap items-start gap-4 rounded-lg border border-border bg-background p-4 sm:p-6 [&>*]:min-w-0' : 'min-w-0 [&>*]:min-w-0'}>
      {children}
    </div>
  )
}
