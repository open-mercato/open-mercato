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
  "inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium cursor-pointer transition-all disabled:pointer-events-none disabled:bg-bg-disabled disabled:text-text-disabled disabled:border-border-disabled disabled:shadow-none [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-5 [&_svg]:shrink-0 outline-none focus-visible:outline-none focus-visible:shadow-focus"

const filledByBrand: Record<SocialBrand, string> = {
  apple: 'bg-brand-apple text-white hover:bg-brand-apple/90',
  github: 'bg-brand-github text-white hover:bg-brand-github/90',
  x: 'bg-brand-x text-white hover:bg-brand-x/90',
  google: 'bg-background text-foreground border border-brand-google-stroke hover:bg-accent',
  facebook: 'bg-brand-facebook text-white hover:bg-brand-facebook/90',
  dropbox: 'bg-brand-dropbox text-white hover:bg-brand-dropbox/90',
  linkedin: 'bg-brand-linkedin text-white hover:bg-brand-linkedin/90',
}

const strokeByBrand: Record<SocialBrand, string> = {
  apple: 'bg-background text-brand-apple border border-brand-apple/30 hover:bg-brand-apple/5',
  github: 'bg-background text-brand-github border border-brand-github/30 hover:bg-brand-github/5',
  x: 'bg-background text-brand-x border border-brand-x/30 hover:bg-brand-x/5',
  google: 'bg-background text-foreground border border-brand-google-stroke hover:bg-accent',
  facebook: 'bg-background text-brand-facebook border border-brand-facebook/40 hover:bg-brand-facebook/5',
  dropbox: 'bg-background text-brand-dropbox border border-brand-dropbox/40 hover:bg-brand-dropbox/5',
  linkedin: 'bg-background text-brand-linkedin border border-brand-linkedin/40 hover:bg-brand-linkedin/5',
}

const socialButtonVariants = cva(baseClasses, {
  variants: {
    iconOnly: {
      true: 'w-10 px-0',
      false: 'px-4',
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
    style?: 'filled' | 'stroke'
  }

export function SocialButton({
  className,
  brand,
  style = 'filled',
  iconOnly,
  asChild = false,
  ...props
}: SocialButtonProps) {
  const Comp = asChild ? Slot : 'button'
  const brandClasses = style === 'stroke' ? strokeByBrand[brand] : filledByBrand[brand]
  return (
    <Comp
      data-slot="social-button"
      data-brand={brand}
      data-style={style}
      type={asChild ? undefined : 'button'}
      className={cn(socialButtonVariants({ iconOnly, className }), brandClasses)}
      {...props}
    />
  )
}

export { socialButtonVariants }
