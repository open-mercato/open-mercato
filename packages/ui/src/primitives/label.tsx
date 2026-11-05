"use client"
import * as React from 'react'
import * as LabelPrimitive from '@radix-ui/react-label'
import { cn } from '@open-mercato/shared/lib/utils'

export function Label({ className, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        'flex items-center gap-2 text-sm leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50',
        className
      )}
      {...props}
    />
  )
}

export type FieldLabelProps = React.ComponentProps<typeof LabelPrimitive.Root> & {
  required?: boolean
  sublabel?: React.ReactNode
  information?: React.ReactNode
  action?: React.ReactNode
  disabled?: boolean
}

export function FieldLabel({ children, required = false, sublabel, information, action, disabled = false, className, ...props }: FieldLabelProps) {
  return <div data-slot="field-label" data-disabled={disabled} className={cn('flex min-h-5 items-center gap-px text-sm leading-5', disabled ? 'text-text-disabled' : 'text-foreground', className)}>
    <Label className={cn('gap-px leading-5', disabled && 'cursor-not-allowed')} {...props}>{children}{required ? <span aria-hidden="true" className={disabled ? 'text-text-disabled' : 'text-accent-indigo'}>*</span> : null}</Label>
    {sublabel ? <span className={cn('font-normal', disabled ? 'text-text-disabled' : 'text-muted-foreground')}>{sublabel}</span> : null}
    {information ? <span className="inline-flex size-5 shrink-0 items-center justify-center">{information}</span> : null}
    {action ? <span className="ml-auto inline-flex shrink-0 items-center justify-end">{action}</span> : null}
  </div>
}
