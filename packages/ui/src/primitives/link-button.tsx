import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@open-mercato/shared/lib/utils'

const linkButtonVariants = cva(
  'inline-flex items-center justify-center gap-1 cursor-pointer font-medium transition-colors outline-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 focus-visible:underline',
  {
    variants: {
      variant: {
        gray: 'text-muted-foreground hover:text-foreground',
        black: 'text-foreground hover:text-foreground/80',
        primary: 'text-primary hover:text-primary-hover',
        error: 'text-destructive hover:text-destructive/80',
        modifiable: 'text-current hover:opacity-80',
      },
      size: {
        sm: 'text-xs leading-4 [&_svg:not([class*=size-])]:size-3',
        default: 'text-sm leading-5 [&_svg:not([class*=size-])]:size-4',
      },
      underline: {
        always: 'underline underline-offset-4',
        hover: 'underline-offset-4 hover:underline',
        none: '',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'default',
      underline: 'hover',
    },
  }
)

export function LinkButton({
  className,
  variant,
  size,
  underline,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof linkButtonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'button'
  return (
    <Comp
      data-slot="link-button"
      type={asChild ? undefined : 'button'}
      className={cn(linkButtonVariants({ variant, size, underline, className }))}
      {...props}
    />
  )
}

export { linkButtonVariants }
