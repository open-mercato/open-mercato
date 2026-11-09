"use client"

import * as React from 'react'
import { Label } from '@open-mercato/ui/primitives/label'

export type DealFormFieldProps = {
  label: string
  /**
   * Stable field key exposed as `data-crud-field-id` and used as the control's `id`.
   * Lets Playwright target the control via the project's `data-crud-field-id` convention
   * (see .ai/lessons.md). Falls back to a generated id for label/control association only.
   */
  fieldId?: string
  /**
   * Id of the control the label names, for a child that only lays the control out. The child
   * is then rendered untouched and must put this id on the control itself.
   */
  controlId?: string
  required?: boolean
  hint?: string
  error?: string
  children: React.ReactNode
}

export function DealFormField({ label, fieldId, controlId, required, hint, error, children }: DealFormFieldProps) {
  const generatedId = React.useId()
  const labelTargetId = controlId ?? fieldId ?? generatedId
  const control = !controlId && React.isValidElement(children)
    ? React.cloneElement(children as React.ReactElement<{ id?: string }>, { id: labelTargetId })
    : children
  return (
    <div className="space-y-2" data-crud-field-id={fieldId}>
      <Label htmlFor={labelTargetId}>
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
