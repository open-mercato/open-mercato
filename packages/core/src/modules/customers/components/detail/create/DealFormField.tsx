"use client"

import * as React from 'react'
import { Label } from '@open-mercato/ui/primitives/label'

export type DealFormFieldProps = {
  label: string
  required?: boolean
  hint?: string
  error?: string
  children: React.ReactNode
}

export function DealFormField({ label, required, hint, error, children }: DealFormFieldProps) {
  const fieldId = React.useId()
  const control = React.isValidElement(children)
    ? React.cloneElement(children as React.ReactElement<{ id?: string }>, { id: fieldId })
    : children
  return (
    <div className="space-y-2">
      <Label htmlFor={fieldId}>
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </Label>
      {control}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {error ? <p className="text-xs text-status-error-text">{error}</p> : null}
    </div>
  )
}

export default DealFormField
