import * as React from 'react'
import { cn } from '../lib/cn'

export type SpinnerProps = Omit<React.SVGProps<SVGSVGElement>, 'children'> & {
  /** Pixel size of the ring. */
  size?: 16 | 20 | 24 | 32
  /** Accessible label; when omitted the spinner is decorative and must sit inside a labelled, aria-busy container. */
  label?: string
}

export const Spinner = React.forwardRef<SVGSVGElement, SpinnerProps>(function Spinner(
  { size = 20, label, className, ...props },
  ref,
) {
  return (
    <svg
      ref={ref}
      data-slot="spinner"
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      className={cn('shrink-0 animate-spin text-current motion-reduce:animate-none', className)}
      {...props}
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity={0.25} strokeWidth={3} />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth={3} strokeLinecap="round" />
    </svg>
  )
})
