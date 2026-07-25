"use client"

import * as React from 'react'
import { Mail } from 'lucide-react'

type ContactEmailDisplayProps = {
  value: string | null | undefined
  emptyLabel: string
}

export function ContactEmailDisplay({ value, emptyLabel }: ContactEmailDisplayProps) {
  const emailValue = typeof value === 'string' ? value.trim() : ''
  if (!emailValue.length) {
    return <span className="text-sm text-muted-foreground">{emptyLabel}</span>
  }
  return (
    <a
      className="inline-flex max-w-full items-center gap-2 text-sm text-primary hover:text-primary/80 hover:underline"
      href={`mailto:${emailValue}`}
    >
      <Mail className="h-4 w-4 shrink-0" aria-hidden />
      <span className="min-w-0 truncate" title={emailValue}>
        {emailValue}
      </span>
    </a>
  )
}
