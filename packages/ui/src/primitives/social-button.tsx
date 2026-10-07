import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@open-mercato/shared/lib/utils'

export type SocialBrand =
  | 'apple'
  | 'github'
  | 'x'
  | 'google'
  | 'facebook'
  | 'dropbox'
  | 'linkedin'

const baseClasses =
  "inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium cursor-pointer transition-all disabled:pointer-events-none disabled:bg-bg-disabled disabled:text-text-disabled disabled:border-border-disabled disabled:shadow-none [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-5 [&_svg]:shrink-0 outline-none focus-visible:outline-none focus-visible:shadow-focus"

const filledByBrand: Record<SocialBrand, string> = {
  apple: 'bg-brand-apple text-white hover:bg-brand-apple/90',
  github: 'bg-brand-github text-white hover:bg-brand-github/90',
  x: 'bg-brand-x text-white hover:bg-brand-x/90',
  google: 'bg-brand-google text-white hover:bg-brand-google/90',
  facebook: 'bg-brand-facebook text-white hover:bg-brand-facebook/90',
  dropbox: 'bg-brand-dropbox text-white hover:bg-brand-dropbox/90',
  linkedin: 'bg-brand-linkedin text-white hover:bg-brand-linkedin/90',
}

const strokeClasses = 'bg-background text-foreground border border-input shadow-xs hover:bg-muted hover:border-transparent hover:shadow-none focus-visible:border-foreground'

const socialButtonVariants = cva(baseClasses, {
  variants: {
    iconOnly: {
      true: 'w-10 px-0',
      false: 'pl-2.5 pr-4',
    },
  },
  defaultVariants: {
    iconOnly: false,
  },
})

export type SocialButtonProps = React.ComponentProps<'button'> &
  VariantProps<typeof socialButtonVariants> & {
    asChild?: boolean
    brand: SocialBrand
    /** Visual treatment of the button. Renamed from `style` to avoid shadowing the native HTML/React `style` (CSSProperties) attribute. */
    appearance?: 'filled' | 'stroke'
  }

export function SocialButton({
  className,
  brand,
  appearance = 'filled',
  iconOnly,
  asChild = false,
  ...props
}: SocialButtonProps) {
  const Comp = asChild ? Slot : 'button'
  const brandClasses = appearance === 'stroke'
    ? strokeClasses
    : brand === 'google' && !iconOnly
      ? 'bg-brand-google-text-bg text-white hover:shadow-sm'
      : filledByBrand[brand]
  return (
    <Comp
      data-slot="social-button"
      data-brand={brand}
      data-appearance={appearance}
      type={asChild ? undefined : 'button'}
      className={cn(socialButtonVariants({ iconOnly, className }), brandClasses)}
      {...props}
    />
  )
}

export { socialButtonVariants }
