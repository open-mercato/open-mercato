'use client'

import * as React from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export type CollapsibleSectionProps = {
  title: string
  children: React.ReactNode
  defaultOpen?: boolean
  icon?: LucideIcon
  actions?: React.ReactNode
}

export function CollapsibleSection({
  title,
  children,
  defaultOpen = true,
  icon: Icon,
  actions,
}: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = React.useState(defaultOpen)

  return (
    <div className="bg-white border border-gray-200 rounded mb-3">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-3 hover:bg-gray-50"
      >
        <div className="flex items-center gap-2">
          {Icon && <Icon className="w-4 h-4 text-gray-600" />}
          <h2 className="text-xs uppercase text-gray-700 font-semibold">{title}</h2>
        </div>
        <div className="flex items-center gap-2">
          {actions && (
            <div onClick={(e) => e.stopPropagation()} className="flex items-center gap-2">
              {actions}
            </div>
          )}
          {isOpen ? (
            <ChevronDown className="w-4 h-4 text-gray-500" />
          ) : (
            <ChevronRight className="w-4 h-4 text-gray-500" />
          )}
        </div>
      </button>
      {isOpen && <div className="px-3 pb-3">{children}</div>}
    </div>
  )
}
