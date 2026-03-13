'use client'

import * as React from 'react'
import { ChevronRight } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'

type MfaProviderListRowProps = {
  title: string
  description: string
  icon: React.ReactNode
  badge?: React.ReactNode
  onClick: () => void
}

export default function MfaProviderListRow({
  title,
  description,
  icon,
  badge,
  onClick,
}: MfaProviderListRowProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      className="h-auto w-full justify-between rounded-md border border-slate-800 bg-slate-950 px-4 py-3 hover:bg-slate-900"
      onClick={onClick}
    >
      <span className="min-w-0 text-left">
        <span className="flex items-center gap-2">
          <span className="text-slate-100" aria-hidden>{icon}</span>
          <span className="truncate text-sm font-semibold text-slate-100">{title}</span>
          {badge}
        </span>
        <span className="mt-1 block text-xs text-slate-300">{description}</span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-slate-400" aria-hidden />
    </Button>
  )
}
