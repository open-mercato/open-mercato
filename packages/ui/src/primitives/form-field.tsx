"use client"

import * as React from 'react'
import { Label } from './label'
import { cn } from '@open-mercato/shared/lib/utils'

export type FormFieldProps = {
  /** Visible label text */
  label?: string
  /** Auto-generated if not provided. Links label → input via htmlFor/id */
  id?: string
  /** Show required indicator (*) next to label */
  required?: boolean
  /** Help text below input */
  description?: React.ReactNode
  /** Error message — replaces description when present */
  error?: string
  /** Layout: vertical (default) or horizontal (label beside input) */
  orientation?: 'vertical' | 'horizontal'
  /** Disabled styling on label */
  disabled?: boolean
  /** The input element (slot) */
  children: React.ReactNode
  /** Additional className on root wrapper */
  className?: string
}

export function FormField({
  label,
  id: idProp,
  required = false,
  description,
  error,
  orientation = 'vertical',
  disabled = false,
  children,
  className,
}: FormFieldProps) {
  const generatedId = React.useId()
  const fieldId = idProp ?? generatedId
  const descriptionId = description && !error ? `${fieldId}-desc` : undefined
  const errorId = error ? `${fieldId}-error` : undefined
  const ariaDescribedBy = [descriptionId, errorId].filter(Boolean).join(' ') || undefined

  // Clone child to inject accessibility props
  const enhancedChild = React.isValidElement(children)
    ? React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
        id: fieldId,
        'aria-describedby': ariaDescribedBy,
        'aria-invalid': error ? true : undefined,
        'aria-required': required ? true : undefined,
        disabled: disabled || undefined,
      })
    : children

  const isHorizontal = orientation === 'horizontal'

  return (
    <div
      className={cn(
        isHorizontal
          ? 'flex items-center justify-between gap-4'
          : 'flex flex-col gap-1.5',
        disabled && 'opacity-50',
        className,
      )}
      data-slot="form-field"
    >
      {label ? (
        <Label
          htmlFor={fieldId}
          className={cn(
            isHorizontal && 'min-w-0 shrink-0',
            disabled && 'cursor-not-allowed',
          )}
        >
          {label}
          {required && (
            <span className="text-status-error-icon ml-0.5" aria-hidden="true">*</span>
          )}
        </Label>
      ) : null}

      <div className={cn(isHorizontal && 'flex-1')}>
        {enhancedChild}
      </div>

      {error ? (
        <p
          id={errorId}
          role="alert"
          className="text-xs text-status-error-text"
        >
          {error}
        </p>
      ) : description ? (
        <p
          id={descriptionId}
          className="text-xs text-muted-foreground"
        >
          {description}
        </p>
      ) : null}
    </div>
  )
}
