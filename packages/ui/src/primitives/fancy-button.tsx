import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@open-mercato/shared/lib/utils'

export type FancyButtonType = 'neutral' | 'basic' | 'primary' | 'destructive'

const sheenGradient =
  'linear-gradient(180deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0) 100%)'

const fancyTypeStyles: Record<
  FancyButtonType,
  { className: string; style: React.CSSProperties }
> = {
  neutral: {
    className:
      'border border-white/[0.12] text-white shadow-[0px_1px_2px_0px_rgba(27,28,29,0.48),0px_0px_0px_1px_#242628] hover:brightness-110',
    style: {
      backgroundImage: `${sheenGradient}, linear-gradient(90deg, #171717 0%, #171717 100%)`,
    },
  },
  basic: {
    className:
      'bg-background text-muted-foreground shadow-[0px_1px_3px_0px_rgba(14,18,27,0.12),0px_0px_0px_1px_var(--border,#ebebeb)] hover:bg-accent',
    style: {},
  },
  primary: {
    className: 'text-foreground hover:brightness-105',
    style: {
      backgroundImage:
        'linear-gradient(161.7deg, var(--brand-lime, #B4F372) 0%, #EEFB63 35.36%, var(--brand-violet, #BC9AFF) 70.72%)',
    },
  },
  destructive: {
    className:
      'border border-white/[0.12] text-white shadow-[0px_1px_2px_0px_rgba(14,18,27,0.24),0px_0px_0px_1px_var(--destructive,#dc2626)] hover:brightness-110',
    style: {
      backgroundImage: `${sheenGradient}, linear-gradient(90deg, var(--destructive, #dc2626) 0%, var(--destructive, #dc2626) 100%)`,
    },
  },
}

const fancyButtonVariants = cva(
  "inline-flex items-center justify-center gap-1 whitespace-nowrap font-medium cursor-pointer transition-all overflow-hidden disabled:pointer-events-none disabled:bg-bg-disabled disabled:text-text-disabled disabled:border-border-disabled disabled:shadow-none disabled:[background-image:none] [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-5 [&_svg]:shrink-0 outline-none focus-visible:outline-none focus-visible:shadow-focus",
  {
    variants: {
      size: {
        default: 'h-10 px-3 text-sm rounded-md',
        sm: 'h-9 px-2 text-sm rounded-md',
        xs: 'h-8 px-2 text-xs rounded-md',
      },
    },
    defaultVariants: {
      size: 'default',
    },
  }
)

export type FancyButtonProps = Omit<React.ComponentProps<'button'>, 'type'> &
  VariantProps<typeof fancyButtonVariants> & {
    asChild?: boolean
    intent?: FancyButtonType
    htmlType?: 'button' | 'submit' | 'reset'
  }

export function FancyButton({
  className,
  size,
  intent = 'neutral',
  htmlType = 'button',
  asChild = false,
  style,
  ...props
}: FancyButtonProps) {
  const Comp = asChild ? Slot : 'button'
  const { className: typeClassName, style: typeStyle } = fancyTypeStyles[intent]
  return (
    <Comp
      data-slot="fancy-button"
      data-fancy-intent={intent}
      type={asChild ? undefined : htmlType}
      className={cn(fancyButtonVariants({ size, className }), typeClassName)}
      style={{ ...typeStyle, ...style }}
      {...props}
    />
  )
}

export { fancyButtonVariants }
