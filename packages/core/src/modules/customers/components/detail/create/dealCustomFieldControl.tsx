"use client"

import * as React from 'react'
import { format } from 'date-fns/format'
import { parseISO } from 'date-fns/parseISO'
import type { CrudField, CrudFieldOption } from '@open-mercato/ui/backend/CrudForm'
import { Label } from '@open-mercato/ui/primitives/label'
import { Input } from '@open-mercato/ui/primitives/input'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { CheckboxField } from '@open-mercato/ui/primitives/checkbox-field'
import { DatePicker } from '@open-mercato/ui/primitives/date-picker'
import { TagInput } from '@open-mercato/ui/primitives/tag-input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'

export type DealCustomFieldControlProps = {
  field: CrudField
  value: unknown
  onChange: (value: unknown) => void
  error?: string
  disabled?: boolean
}

const SELECT_CLEAR_SENTINEL = '__deal_custom_field_select_clear__'

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date) return value
  if (typeof value === 'string' && value) {
    const parsed = parseISO(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
  }
  return null
}

function useResolvedOptions(field: CrudField): CrudFieldOption[] {
  const builtin = field.type === 'custom' ? null : field
  const staticOptions = builtin?.options
  const loadOptions = builtin?.loadOptions
  const [loadedOptions, setLoadedOptions] = React.useState<CrudFieldOption[]>([])

  React.useEffect(() => {
    if (staticOptions && staticOptions.length > 0) return
    if (typeof loadOptions !== 'function') return
    let cancelled = false
    loadOptions()
      .then((options) => {
        if (!cancelled) setLoadedOptions(options)
      })
      .catch(() => {
        if (!cancelled) setLoadedOptions([])
      })
    return () => {
      cancelled = true
    }
  }, [staticOptions, loadOptions])

  if (staticOptions && staticOptions.length > 0) return staticOptions
  return loadedOptions
}

function FieldShell({
  label,
  required,
  description,
  error,
  children,
}: {
  label: string
  required?: boolean
  description?: React.ReactNode
  error?: string
  children: React.ReactNode
}) {
  const fieldId = React.useId()
  const control = React.isValidElement(children)
    ? React.cloneElement(children as React.ReactElement<{ id?: string }>, { id: fieldId })
    : children
  return (
    <div className="space-y-1">
      {label.trim().length > 0 ? (
        <Label htmlFor={fieldId}>
          {label}
          {required ? <span className="text-destructive"> *</span> : null}
        </Label>
      ) : null}
      {control}
      {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      {error ? <p className="text-xs text-status-error-text">{error}</p> : null}
    </div>
  )
}

export function DealCustomFieldControl({
  field,
  value,
  onChange,
  error,
  disabled = false,
}: DealCustomFieldControlProps) {
  const options = useResolvedOptions(field)
  const ariaInvalid = error ? true : undefined

  if (field.type === 'checkbox') {
    return (
      <div className="space-y-1">
        <CheckboxField
          label={field.label}
          description={field.description}
          checked={value === true}
          onCheckedChange={(next) => onChange(next === true)}
          disabled={disabled}
          aria-invalid={ariaInvalid}
        />
        {error ? <p className="text-xs text-status-error-text">{error}</p> : null}
      </div>
    )
  }

  if (field.type === 'custom') {
    return (
      <FieldShell
        label={field.label}
        required={field.required}
        description={field.description}
        error={error}
      >
        {field.component({
          id: field.id,
          value,
          error,
          setValue: onChange,
          disabled,
          autoFocus: false,
        })}
      </FieldShell>
    )
  }

  let control: React.ReactNode

  switch (field.type) {
    case 'number':
      control = (
        <Input
          type="number"
          inputMode="numeric"
          value={typeof value === 'number' || typeof value === 'string' ? String(value) : ''}
          placeholder={field.placeholder}
          disabled={disabled}
          aria-invalid={ariaInvalid}
          onChange={(event) => {
            const raw = event.target.value
            if (raw === '') {
              onChange(undefined)
              return
            }
            const parsed = Number(raw)
            onChange(Number.isNaN(parsed) ? raw : parsed)
          }}
        />
      )
      break
    case 'date':
    case 'datepicker':
      control = (
        <DatePicker
          value={toDate(value)}
          onChange={(date) => onChange(date ? format(date, 'yyyy-MM-dd') : undefined)}
          disabled={disabled}
          placeholder={field.placeholder}
          aria-invalid={ariaInvalid}
        />
      )
      break
    case 'datetime':
    case 'datetime-local':
      control = (
        <DatePicker
          withTime
          value={toDate(value)}
          onChange={(date) => onChange(date ? date.toISOString() : undefined)}
          disabled={disabled}
          placeholder={field.placeholder}
          aria-invalid={ariaInvalid}
        />
      )
      break
    case 'tags':
      control = (
        <TagInput
          value={toStringArray(value)}
          onChange={(next) => onChange(next)}
          placeholder={field.placeholder}
          disabled={disabled}
          aria-invalid={ariaInvalid}
        />
      )
      break
    case 'richtext':
      control = (
        <Textarea
          value={value == null ? '' : String(value)}
          placeholder={field.placeholder}
          disabled={disabled}
          aria-invalid={ariaInvalid}
          onChange={(event) => onChange(event.target.value)}
        />
      )
      break
    case 'select': {
      if (field.multiple) {
        const selected = toStringArray(value)
        control = (
          <div className="flex flex-wrap gap-3">
            {options.map((option) => {
              const checked = selected.includes(option.value)
              return (
                <label key={option.value} className="inline-flex cursor-pointer items-center gap-2">
                  <Checkbox
                    checked={checked}
                    disabled={disabled}
                    onCheckedChange={(state) => {
                      const next = new Set(selected)
                      if (state === true) next.add(option.value)
                      else next.delete(option.value)
                      onChange(Array.from(next))
                    }}
                  />
                  <span className="text-sm">{option.label}</span>
                </label>
              )
            })}
          </div>
        )
      } else {
        const selectedValue = Array.isArray(value)
          ? String(value[0] ?? '')
          : value == null
            ? ''
            : String(value)
        control = (
          <Select
            value={selectedValue}
            disabled={disabled}
            onValueChange={(next) => {
              if (!next || next === SELECT_CLEAR_SENTINEL) {
                onChange(null)
                return
              }
              onChange(next)
            }}
          >
            <SelectTrigger aria-invalid={ariaInvalid}>
              <SelectValue placeholder={field.placeholder} />
            </SelectTrigger>
            <SelectContent>
              {!field.required && selectedValue ? (
                <SelectItem value={SELECT_CLEAR_SENTINEL}>—</SelectItem>
              ) : null}
              {options
                .filter((option) => option.value !== '')
                .map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        )
      }
      break
    }
    case 'text':
    default:
      control = (
        <Input
          value={value == null ? '' : String(value)}
          placeholder={field.placeholder}
          disabled={disabled}
          aria-invalid={ariaInvalid}
          onChange={(event) => onChange(event.target.value)}
        />
      )
      break
  }

  return (
    <FieldShell
      label={field.label}
      required={field.required}
      description={field.description}
      error={error}
    >
      {control}
    </FieldShell>
  )
}

export default DealCustomFieldControl
