"use client"

import * as React from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { cn } from '@open-mercato/shared/lib/utils'

export const TooltipProvider = TooltipPrimitive.Provider

export const Tooltip = TooltipPrimitive.Root

export const TooltipTrigger = TooltipPrimitive.Trigger

export const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        'z-50 overflow-hidden rounded-md bg-slate-900 px-3 py-1.5 text-xs text-slate-50 animate-in fade-in-0 zoom-in-95',
        'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
        'data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2',
        'data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
        'max-w-xs break-words',
        className
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
))
TooltipContent.displayName = TooltipPrimitive.Content.displayName

export type TooltipProps = {
  content: React.ReactNode
  children: React.ReactNode
  delayDuration?: number
  side?: 'top' | 'right' | 'bottom' | 'left'
  align?: 'start' | 'center' | 'end'
  open?: boolean
  onOpenChange?: (open: boolean) => void
  disabled?: boolean
}

/**
 * Simple tooltip wrapper component for common use cases.
 *
 * @example
 * <SimpleTooltip content="Full text here">
 *   <span>Truncated...</span>
 * </SimpleTooltip>
 */
export function SimpleTooltip({
  content,
  children,
  delayDuration = 300,
  side = 'top',
  align = 'center',
  open,
  onOpenChange,
  disabled = false,
}: TooltipProps) {
  // If disabled or no content, just render children without tooltip
  const isDisabled = disabled || !content

  if (isDisabled) {
    return <>{children}</>
  }

  return (
    <Tooltip
      open={open}
      onOpenChange={onOpenChange}
      delayDuration={delayDuration}
    >
      <TooltipTrigger asChild>
        {children}
      </TooltipTrigger>
      <TooltipContent side={side} align={align}>
        {content}
      </TooltipContent>
    </Tooltip>
  )
}
