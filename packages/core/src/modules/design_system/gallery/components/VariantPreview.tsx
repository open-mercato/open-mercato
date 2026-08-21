'use client'

import * as React from 'react'

/**
 * Bordered stage a variant renders inside. Chrome uses semantic tokens only —
 * the stage must never impose colors of its own on the previewed component.
 */
export function VariantPreview({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-background p-4">
      {children}
    </div>
  )
}
