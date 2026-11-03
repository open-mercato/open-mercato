import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'

export type HintTextProps = React.HTMLAttributes<HTMLParagraphElement> & {
  state?: 'default' | 'error' | 'disabled'
  leading?: React.ReactNode
}

export function HintText({ state = 'default', leading, children, className, role, ...props }: HintTextProps) {
  return <p data-slot="hint-text" data-state={state} role={role ?? (state === 'error' ? 'alert' : undefined)} className={cn('flex items-start gap-1 text-xs leading-4', state === 'error' ? 'text-status-error-text' : state === 'disabled' ? 'text-text-disabled' : 'text-muted-foreground', className)} {...props}>
    {leading ? <span aria-hidden="true" className="inline-flex size-4 shrink-0 items-center justify-center [&>svg]:size-full [&>span]:size-full">{leading}</span> : null}<span className="min-w-0 flex-1">{children}</span>
  </p>
}
