"use client"
import * as React from 'react'
import { Lightbulb, Info } from 'lucide-react'

export type ContextHelpProps = {
  title: React.ReactNode
  children: React.ReactNode
  defaultOpen?: boolean
  bulb?: boolean
  className?: string
}

export function ContextHelp({ title, children, defaultOpen = false, bulb = true, className = '' }: ContextHelpProps) {
  const [open, setOpen] = React.useState<boolean>(defaultOpen)
  const Icon = bulb ? Lightbulb : Info
  return (
    <div className={`rounded-md border bg-card ${className}`}>
      <button
        type="button"
        className="w-full flex items-center gap-2 px-4 py-3 text-left hover:bg-accent/40 transition-colors"
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
      >
        <Icon size={16} className={`shrink-0 ${open ? 'text-amber-500' : 'text-muted-foreground'}`} />
        <span className="font-medium">{title}</span>
        <span className="ml-auto text-xs text-muted-foreground">{open ? 'Hide' : 'Show'}</span>
      </button>
      {open ? (
        <div className="px-4 pb-4 pt-1 border-t text-sm leading-relaxed">
          {children}
        </div>
      ) : null}
    </div>
  )
}

