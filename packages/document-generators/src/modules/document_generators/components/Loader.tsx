"use client"

import { Spinner } from '@open-mercato/ui/primitives/spinner'

export function Loader({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground" role="status">
      <Spinner />
      <span>{label}</span>
    </div>
  )
}
