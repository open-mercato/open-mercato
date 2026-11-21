'use client'

import * as React from 'react'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { cn } from '../lib/cn'

const TooltipContent = React.forwardRef<React.ElementRef<typeof TooltipPrimitive.Content>, React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>>(
  function TooltipContent({ className, sideOffset = 6, ...props }, ref) {
    return (
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          ref={ref}
          data-slot="tooltip"
          sideOffset={sideOffset}
          className={cn(
            'z-tooltip max-w-64 rounded-sf-badge bg-foreground px-3 py-1.5 text-sf-body-xs text-background shadow-md',
            'data-[state=delayed-open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=delayed-open]:fade-in-0',
            className,
          )}
          {...props}
        />
      </TooltipPrimitive.Portal>
    )
  },
)

function TooltipProvider({ delayDuration = 300, ...props }: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return <TooltipPrimitive.Provider delayDuration={delayDuration} {...props} />
}

/** Short text on hover and focus only. Anything a user must read belongs in visible text or a Popover. */
// Own root on purpose: Object.assign on the Radix root would mutate an object other primitives share.
function TooltipRoot(props: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return <TooltipPrimitive.Root {...props} />
}

export const Tooltip = Object.assign(TooltipRoot, {
  Provider: TooltipProvider,
  Trigger: TooltipPrimitive.Trigger,
  Content: TooltipContent,
})
