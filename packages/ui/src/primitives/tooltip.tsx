"use client"

import * as React from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@open-mercato/shared/lib/utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { X } from 'lucide-react'
import { Button } from './button'
import { Popover, PopoverArrow, PopoverClose, PopoverContent, PopoverTrigger } from './popover'

export const TooltipProvider = TooltipPrimitive.Provider

export const Tooltip = TooltipPrimitive.Root

export const TooltipTrigger = TooltipPrimitive.Trigger

const tooltipContentVariants = cva(
  'z-tooltip rounded-sm max-w-xs break-words shadow-md animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
  {
    variants: {
      variant: {
        dark: 'bg-foreground text-background',
        light: 'bg-popover text-popover-foreground ring-1 ring-inset ring-input',
      },
      size: {
        sm: 'px-1.5 py-0.5 text-xs leading-4',
        default: 'px-2.5 py-1 text-sm leading-5',
        lg: 'rounded-lg p-3 text-sm leading-5',
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
      data-slot="tooltip-content"
      data-size={size ?? 'default'}
      sideOffset={sideOffset}
      className={cn(tooltipContentVariants({ variant, size }), className)}
      {...props}
    >
      {children}
      {arrow ? (
        <TooltipPrimitive.Arrow
          width={size === 'sm' ? 8 : 12}
          height={size === 'sm' ? 4 : 6}
          data-slot="tooltip-arrow"
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
    <TooltipProvider delayDuration={delayDuration}>
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
    </TooltipProvider>
  )
}

export type TooltipCardProps = Pick<TooltipProps, 'children' | 'open' | 'onOpenChange' | 'side' | 'align' | 'variant'> & {
  title: string
  description: React.ReactNode
  leading?: React.ReactNode
  closeAriaLabel?: string
}

/**
 * Figma's large tooltip contains a dismiss action. Use a focusable popover
 * for this interactive card; SimpleTooltip remains hover/focus help text.
 */
export function TooltipCard({ children, title, description, leading, closeAriaLabel, open, onOpenChange, side = 'bottom', align = 'start', variant = 'light' }: TooltipCardProps) {
  const t = useT()
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent side={side} align={align} sideOffset={6} role="dialog" aria-label={title}
        data-slot="tooltip-card"
        className={cn('flex w-70 min-w-0 gap-3 rounded-lg p-3', variant === 'dark' && 'border-foreground bg-foreground text-background')}>
        {leading ? <span aria-hidden="true" className="inline-flex size-5 shrink-0 items-center justify-center">{leading}</span> : null}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="text-sm font-medium leading-5">{title}</p>
          <div className={cn('text-xs leading-4', variant === 'dark' ? 'text-background/80' : 'text-muted-foreground')}>{description}</div>
        </div>
        <PopoverClose asChild>
          <Button variant="ghost" size="icon" aria-label={closeAriaLabel ?? t('ui.dialog.close.ariaLabel', 'Close')} className="size-6 shrink-0 p-0 text-inherit hover:text-inherit">
            <X aria-hidden="true" className="size-5" />
          </Button>
        </PopoverClose>
        <PopoverArrow className={variant === 'dark' ? 'fill-foreground stroke-foreground' : undefined} />
      </PopoverContent>
    </Popover>
  )
}

export { tooltipContentVariants }
