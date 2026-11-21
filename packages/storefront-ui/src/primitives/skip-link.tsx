import * as React from 'react'
import { cn } from '../lib/cn'

export type SkipLinkProps = React.ComponentPropsWithoutRef<'a'> & {
  /** Target landmark id, without the hash. */
  targetId?: string
}

/** First focusable element on every page; visible only while focused (storefront-app spec §8). */
export const SkipLink = React.forwardRef<HTMLAnchorElement, SkipLinkProps>(function SkipLink(
  { targetId = 'main', className, children, ...props },
  ref,
) {
  return (
    <a
      ref={ref}
      href={`#${targetId}`}
      data-slot="skip-link"
      className={cn(
        'sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-tooltip focus:inline-flex focus:h-sf-md focus:items-center focus:rounded-sf-button focus:bg-primary focus:px-5 focus:text-sf-body-sm focus:text-primary-foreground focus:shadow-lg focus:outline-none',
        className,
      )}
      {...props}
    >
      {children}
    </a>
  )
})
