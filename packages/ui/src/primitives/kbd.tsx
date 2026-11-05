import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'

export type KbdProps = React.HTMLAttributes<HTMLElement>

export function Kbd({ children, className, ...props }: KbdProps) {
  return (
    <kbd
      className={cn(
        'inline-flex items-center rounded-sm border border-border bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground shadow-xs',
        className,
      )}
      {...props}
    >
      {children}
    </kbd>
  )
}

export type KbdShortcutProps = {
  keys: string[]
  className?: string
}

export function KbdShortcut({ keys, className }: KbdShortcutProps) {
  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      {keys.map((key, i) => (
        <React.Fragment key={i}>
          <Kbd>{key}</Kbd>
          {i < keys.length - 1 && (
            <span className="text-xs text-muted-foreground">+</span>
          )}
        </React.Fragment>
      ))}
    </span>
  )
}
