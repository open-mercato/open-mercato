import * as React from 'react'
import * as VisuallyHiddenPrimitive from '@radix-ui/react-visually-hidden'

export type VisuallyHiddenProps = React.ComponentPropsWithoutRef<typeof VisuallyHiddenPrimitive.Root>

export const VisuallyHidden = React.forwardRef<React.ElementRef<typeof VisuallyHiddenPrimitive.Root>, VisuallyHiddenProps>(
  function VisuallyHidden(props, ref) {
    return <VisuallyHiddenPrimitive.Root ref={ref} data-slot="visually-hidden" {...props} />
  },
)
