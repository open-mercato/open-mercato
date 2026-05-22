"use client"

import * as React from 'react'
import { cn } from '@open-mercato/shared/lib/utils'
import { Switch } from './switch'

export type SwitchFieldProps = Omit<React.ComponentProps<typeof Switch>, 'id'> & {
  id?: string
  label: React.ReactNode
  sublabel?: React.ReactNode
  description?: React.ReactNode
  badge?: React.ReactNode
  link?: React.ReactNode
  /** When true, renders the switch on the left of the label content. */
  flip?: boolean
  containerClassName?: string
  contentClassName?: string
}

export const SwitchField = React.forwardRef<
  React.ElementRef<typeof Switch>,
  SwitchFieldProps
>(({
  id: idProp,
  label,
  sublabel,
  description,
  badge,
  link,
  flip = false,
  containerClassName,
  contentClassName,
  className,
  disabled,
  ...switchProps
}, ref) => {
  // useId is SSR/HMR-stable; counter-based fallbacks drift on hydration.
  const fallbackId = React.useId()
  const id = idProp ?? fallbackId

  const hasMultiLine = Boolean(description || sublabel || link)
  const switchEl = (
    <Switch
      ref={ref}
      id={id}
      disabled={disabled}
      className={cn(hasMultiLine && 'mt-0.5', className)}
      {...switchProps}
    />
  )

  const content = (
    <div className={cn('flex flex-1 min-w-0 flex-col gap-2.5', contentClassName)}>
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-1">
          <label
            htmlFor={id}
            className={cn(
              'text-sm font-medium leading-5 text-foreground select-none',
              disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'
            )}
          >
            {label}
          </label>
          {sublabel ? (
            <span className="text-xs leading-4 text-muted-foreground select-none">{sublabel}</span>
          ) : null}
          {badge ? <span className="inline-flex shrink-0">{badge}</span> : null}
        </div>
        {description ? (
          <p className="text-xs leading-4 text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {link ? <div className="flex">{link}</div> : null}
    </div>
  )

  return (
    <div
      className={cn(
        'flex gap-3',
        hasMultiLine ? 'items-start' : 'items-center',
        containerClassName
      )}
    >
      {flip ? (
        <>
          {switchEl}
          {content}
        </>
      ) : (
        <>
          {content}
          {switchEl}
        </>
      )}
    </div>
  )
})
SwitchField.displayName = 'SwitchField'
