import * as React from 'react'

export function Separator({ className = '', orientation = 'horizontal' }: { className?: string; orientation?: 'horizontal' | 'vertical' }) {
  const base = orientation === 'vertical' ? 'w-px h-full' : 'h-px w-full'
  return <div role="separator" aria-orientation={orientation} className={`${base} bg-border ${className}`} />
}

