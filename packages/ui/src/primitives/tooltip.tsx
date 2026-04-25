"use client"

import * as React from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@open-mercato/shared/lib/utils'

export const TooltipProvider = TooltipPrimitive.Provider

export const Tooltip = TooltipPrimitive.Root

export const TooltipTrigger = TooltipPrimitive.Trigger

const tooltipContentVariants = cva(
  'z-tooltip overflow-hidden rounded-sm max-w-xs break-words shadow-md animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
  {
    variants: {
      variant: {
        dark: 'bg-foreground text-background',
        light: 'bg-popover text-popover-foreground border border-input',
      },
      size: {
        sm: 'px-1.5 py-0.5 text-xs leading-4',
        default: 'px-2 py-0.5 text-xs leading-4',
        lg: 'px-3 py-2 text-sm leading-5',
      },
    },
    defaultVariants: {
      variant: 'dark',
      size: 'default',
    },
  }
)

export type TooltipContentProps = React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content> &
  VariantProps<typeof tooltipContentVariants> & {
    /** Show a small arrow pointing at the trigger. */
    arrow?: boolean
  }

export const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  TooltipContentProps
>(({ className, sideOffset = 4, variant, size, arrow = true, children, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(tooltipContentVariants({ variant, size }), className)}
      {...props}
    >
      {children}
      {arrow ? (
        <TooltipPrimitive.Arrow
          width={10}
          height={5}
          className={cn(variant === 'light' ? 'fill-popover stroke-input' : 'fill-foreground')}
        />
      ) : null}
    </TooltipPrimitive.Content>
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
  variant?: 'dark' | 'light'
  size?: 'sm' | 'default' | 'lg'
  arrow?: boolean
}

/**
 * Simple tooltip wrapper component for common use cases.
 *
 * @example
 * <SimpleTooltip content="Full text here">
 *   <span>Truncated...</span>
 * </SimpleTooltip>
 *
 * @example with arrow + light variant
 * <SimpleTooltip content="Help text" variant="light" arrow>
 *   <InfoIcon />
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
  variant,
  size,
  arrow,
}: TooltipProps) {
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
      <TooltipContent side={side} align={align} variant={variant} size={size} arrow={arrow}>
        {content}
      </TooltipContent>
    </Tooltip>
  )
}

export { tooltipContentVariants }
