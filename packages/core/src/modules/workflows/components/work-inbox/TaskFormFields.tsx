"use client"

/**
 * The task's data-entry form.
 *
 * Lifted out of `backend/tasks/[id]/page.tsx` unchanged when that page became a
 * two-column decision surface: the renderer is the same JSON-Schema walk it has
 * always been, and keeping it here leaves the page about the decision, the
 * context and the routing rather than about input types.
 *
 * Radix `Select` cannot carry HTML `required`, so constraint validation is
 * enforced by the caller and surfaced here through `invalidField` +
 * `aria-invalid`.
 */

import * as React from 'react'
import { Input } from '@open-mercato/ui/primitives/input'
import { EmailInput } from '@open-mercato/ui/primitives/email-input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { JsonSchema, JsonSchemaField } from '../../data/types'

export type TaskFormValues = Record<string, string | number | boolean>

export type TaskFormFieldsProps = {
  formSchema: JsonSchema | null | undefined
  values: TaskFormValues
  invalidField: string | null
  disabled?: boolean
  onFieldChange: (fieldName: string, value: string | number | boolean) => void
}

const INPUT_CLASSES =
  'w-full px-3 py-2 border border-border rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
const LABEL_CLASSES = 'block text-sm font-medium text-foreground mb-1'

function FieldLabel({
  fieldName,
  title,
  required,
}: {
  fieldName: string
  title: string
  required: boolean
}) {
  return (
    <label htmlFor={fieldName} className={LABEL_CLASSES}>
      {title}
      {required ? <span className="text-status-error-text ml-1">*</span> : null}
    </label>
  )
}

export function TaskFormFields({
  formSchema,
  values,
  invalidField,
  disabled,
  onFieldChange,
}: TaskFormFieldsProps) {
  const t = useT()
  const properties = formSchema?.properties

  const fieldValue = (fieldName: string): string | number => {
    const value = values[fieldName]
    if (value == null || value === false) return ''
    if (typeof value === 'boolean') return ''
    return value
  }

  const renderField = (fieldName: string, fieldSchema: JsonSchemaField) => {
    const fieldType = fieldSchema.type || 'string'
    const fieldTitle = fieldSchema.title || fieldName
    const fieldDescription = fieldSchema.description
    const required = formSchema?.required?.includes(fieldName) || false
    const enumValues = fieldSchema.enum

    if (enumValues && Array.isArray(enumValues)) {
      return (
        <div key={fieldName} className="space-y-2">
          <FieldLabel fieldName={fieldName} title={fieldTitle} required={required} />
          {fieldDescription ? <p className="text-xs text-muted-foreground">{fieldDescription}</p> : null}
          <Select
            value={fieldValue(fieldName) ? String(fieldValue(fieldName)) : undefined}
            onValueChange={(value) => onFieldChange(fieldName, value ?? '')}
            disabled={disabled}
          >
            <SelectTrigger
              id={fieldName}
              className={`${INPUT_CLASSES} ${invalidField === fieldName ? 'ring-2 ring-status-error-border border-status-error-border' : ''}`}
              aria-required={required}
              aria-invalid={invalidField === fieldName ? true : undefined}
            >
              <SelectValue placeholder={t('workflows.tasks.detail.form.selectOption')} />
            </SelectTrigger>
            <SelectContent>
              {enumValues.map((value) => (
                <SelectItem key={value} value={value}>
                  {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )
    }

    switch (fieldType) {
      case 'string':
        if (fieldSchema.format === 'email') {
          return (
            <div key={fieldName} className="space-y-2">
              <FieldLabel fieldName={fieldName} title={fieldTitle} required={required} />
              {fieldDescription ? <p className="text-xs text-muted-foreground">{fieldDescription}</p> : null}
              <EmailInput
                id={fieldName}
                value={fieldValue(fieldName)}
                onChange={(event) => onFieldChange(fieldName, event.target.value)}
                required={required}
                disabled={disabled}
              />
            </div>
          )
        }
        if (fieldSchema.format === 'date') {
          return (
            <div key={fieldName} className="space-y-2">
              <FieldLabel fieldName={fieldName} title={fieldTitle} required={required} />
              {fieldDescription ? <p className="text-xs text-muted-foreground">{fieldDescription}</p> : null}
              <input
                type="date"
                id={fieldName}
                value={fieldValue(fieldName)}
                onChange={(event) => onFieldChange(fieldName, event.target.value)}
                required={required}
                disabled={disabled}
                className={INPUT_CLASSES}
              />
            </div>
          )
        }
        if (fieldSchema.maxLength && fieldSchema.maxLength > 200) {
          return (
            <div key={fieldName} className="space-y-2">
              <FieldLabel fieldName={fieldName} title={fieldTitle} required={required} />
              {fieldDescription ? <p className="text-xs text-muted-foreground">{fieldDescription}</p> : null}
              <textarea
                id={fieldName}
                value={fieldValue(fieldName)}
                onChange={(event) => onFieldChange(fieldName, event.target.value)}
                required={required}
                disabled={disabled}
                rows={4}
                className={INPUT_CLASSES}
              />
            </div>
          )
        }
        return (
          <div key={fieldName} className="space-y-2">
            <FieldLabel fieldName={fieldName} title={fieldTitle} required={required} />
            {fieldDescription ? <p className="text-xs text-muted-foreground">{fieldDescription}</p> : null}
            <Input
              type="text"
              id={fieldName}
              value={fieldValue(fieldName)}
              onChange={(event) => onFieldChange(fieldName, event.target.value)}
              required={required}
              disabled={disabled}
            />
          </div>
        )

      case 'number':
      case 'integer':
        return (
          <div key={fieldName} className="space-y-2">
            <FieldLabel fieldName={fieldName} title={fieldTitle} required={required} />
            {fieldDescription ? <p className="text-xs text-muted-foreground">{fieldDescription}</p> : null}
            <Input
              type="number"
              id={fieldName}
              value={fieldValue(fieldName)}
              onChange={(event) =>
                onFieldChange(fieldName, event.target.value ? Number(event.target.value) : '')
              }
              required={required}
              disabled={disabled}
              step={fieldType === 'integer' ? 1 : 'any'}
            />
          </div>
        )

      case 'boolean':
        return (
          <div key={fieldName} className="space-y-2">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id={fieldName}
                checked={!!values[fieldName]}
                onChange={(event) => onFieldChange(fieldName, event.target.checked)}
                disabled={disabled}
                className="w-4 h-4 text-primary border-border rounded focus-visible:ring-ring"
              />
              <label htmlFor={fieldName} className="text-sm font-medium text-foreground">
                {fieldTitle}
                {required ? <span className="text-status-error-text ml-1">*</span> : null}
              </label>
            </div>
            {fieldDescription ? (
              <p className="text-xs text-muted-foreground ml-6">{fieldDescription}</p>
            ) : null}
          </div>
        )

      default:
        return (
          <div key={fieldName} className="space-y-2">
            <FieldLabel fieldName={fieldName} title={fieldTitle} required={required} />
            {fieldDescription ? <p className="text-xs text-muted-foreground">{fieldDescription}</p> : null}
            <Input
              type="text"
              id={fieldName}
              value={fieldValue(fieldName)}
              onChange={(event) => onFieldChange(fieldName, event.target.value)}
              required={required}
              disabled={disabled}
            />
          </div>
        )
    }
  }

  if (!properties) {
    return (
      <div className="bg-status-info-bg border border-status-info-border rounded-lg p-4">
        <p className="text-sm text-status-info-text">{t('workflows.tasks.detail.noFormSchema')}</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">{t('workflows.tasks.detail.sections.form')}</h2>
      {Object.keys(properties).map((fieldName) => renderField(fieldName, properties[fieldName]))}
    </div>
  )
}

export default TaskFormFields
