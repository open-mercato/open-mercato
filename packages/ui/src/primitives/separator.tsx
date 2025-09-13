import * as React from 'react'

export function Separator({ className = '' }: { className?: string }) {
  return <div role="separator" className={`h-px w-full bg-border ${className}`} />
}

