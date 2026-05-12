'use client'
import * as React from 'react'
import { GripVertical } from 'lucide-react'
import { cn } from '@open-mercato/shared/lib/utils'
import { IconButton } from '../../primitives/icon-button'

export type SortableGroupHandleProps = {
  ref: (node: HTMLElement | null) => void
  attributes: Record<string, unknown>
  listeners: Record<string, unknown> | undefined
  isDragging: boolean
  disabled: boolean
}

const SortableGroupHandleContext = React.createContext<SortableGroupHandleProps | null>(null)

export const SortableGroupHandleProvider = SortableGroupHandleContext.Provider

export function useSortableGroupHandle(): SortableGroupHandleProps | null {
  return React.useContext(SortableGroupHandleContext)
}

export interface SortableGroupHandleButtonProps {
  ariaLabel: string
  className?: string
}

export function SortableGroupHandle({ ariaLabel, className }: SortableGroupHandleButtonProps) {
  const handle = useSortableGroupHandle()
  if (!handle) return null
  const { ref, attributes, listeners, disabled } = handle
  return (
    <IconButton
      type="button"
      variant="ghost"
      size="xs"
      ref={ref as unknown as React.Ref<HTMLButtonElement>}
      aria-label={ariaLabel}
      disabled={disabled}
      className={cn(
        'cursor-grab text-muted-foreground hover:text-foreground active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm',
        className,
      )}
      {...(attributes as Record<string, unknown>)}
      {...((listeners ?? {}) as Record<string, unknown>)}
    >
      <GripVertical className="size-4" />
    </IconButton>
  )
}
