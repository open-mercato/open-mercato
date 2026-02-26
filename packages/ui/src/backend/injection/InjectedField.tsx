'use client'

import * as React from 'react'
import type {
  InjectionFieldDefinition,
  FieldContext,
} from '@open-mercato/shared/modules/widgets/injection'
import { Input } from '../../primitives/input'
import { Label } from '../../primitives/label'
import { Checkbox } from '../../primitives/checkbox'
import { Textarea } from '../../primitives/textarea'
import { Spinner } from '../../primitives/spinner'

export type InjectedFieldProps = {
  field: InjectionFieldDefinition
  value: unknown
  onChange: (fieldId: string, value: unknown) => void
  values: Record<string, unknown>
  context?: FieldContext
  disabled?: boolean
}

const optionsCache = new Map<string, { data: { value: string; label: string }[]; expiry: number }>()

export function InjectedField({ field, value, onChange, values, context, disabled }: InjectedFieldProps) {
  const [dynamicOptions, setDynamicOptions] = React.useState<{ value: string; label: string }[] | null>(null)
  const [optionsLoading, setOptionsLoading] = React.useState(false)

  const isDisabled = disabled || field.readOnly

  React.useEffect(() => {
    if (!field.optionsLoader) return
    const cacheKey = `${field.id}:${JSON.stringify(context)}`
    const cached = optionsCache.get(cacheKey)
    if (cached && cached.expiry > Date.now()) {
      setDynamicOptions(cached.data)
      return
    }
    setOptionsLoading(true)
    field.optionsLoader(context ?? {}).then((opts) => {
      const ttl = (field.optionsCacheTtl ?? 60) * 1000
      optionsCache.set(cacheKey, { data: opts, expiry: Date.now() + ttl })
      setDynamicOptions(opts)
      setOptionsLoading(false)
    }).catch(() => {
      setOptionsLoading(false)
    })
  }, [field.id, field.optionsLoader, field.optionsCacheTtl, context])

  if (field.visibleWhen && !field.visibleWhen(values, context ?? {})) {
    return null
  }

  const options = dynamicOptions ?? field.options ?? []
  const handleChange = (newValue: unknown) => onChange(field.id, newValue)

  const selectClassName = 'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50'

  const renderInput = () => {
    switch (field.type) {
      case 'text':
        return (
          <Input
            type="text"
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => handleChange(e.target.value)}
            disabled={isDisabled}
          />
        )

      case 'number':
        return (
          <Input
            type="number"
            value={typeof value === 'number' ? value : (typeof value === 'string' ? value : '')}
            onChange={(e) => handleChange(e.target.value ? Number(e.target.value) : null)}
            disabled={isDisabled}
          />
        )

      case 'date':
        return (
          <Input
            type="date"
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => handleChange(e.target.value || null)}
            disabled={isDisabled}
          />
        )

      case 'textarea':
        return (
          <Textarea
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => handleChange(e.target.value)}
            disabled={isDisabled}
            rows={3}
          />
        )

      case 'select':
        if (optionsLoading) {
          return (
            <div className="flex items-center gap-2 h-9 px-3">
              <Spinner size="sm" />
              <span className="text-sm text-muted-foreground">Loading options...</span>
            </div>
          )
        }
        return (
          <select
            value={typeof value === 'string' ? value : ''}
            onChange={(e) => handleChange(e.target.value || null)}
            disabled={isDisabled}
            className={selectClassName}
          >
            <option value="">{'\u2014'}</option>
            {options.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        )

      case 'boolean':
        return null // handled separately below

      case 'custom': {
        const CustomComp = field.customComponent
        if (!CustomComp) return null
        return (
          <React.Suspense fallback={<div className="h-9 animate-pulse rounded-md bg-muted" />}>
            <CustomComp
              value={value}
              onChange={handleChange}
              context={context ?? {}}
              disabled={isDisabled}
            />
          </React.Suspense>
        )
      }

      default:
        return null
    }
  }

  if (field.type === 'boolean') {
    return (
      <div className="space-y-1" data-injected-field-id={field.id}>
        <div className="flex items-center gap-2">
          <Checkbox
            id={`injected-${field.id}`}
            checked={Boolean(value)}
            onCheckedChange={(checked) => handleChange(Boolean(checked))}
            disabled={isDisabled}
          />
          <Label htmlFor={`injected-${field.id}`}>{field.label}</Label>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-1" data-injected-field-id={field.id}>
      <Label htmlFor={`injected-${field.id}`}>{field.label}</Label>
      {renderInput()}
    </div>
  )
}
