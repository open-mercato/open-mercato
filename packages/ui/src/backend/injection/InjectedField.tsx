'use client'

import * as React from 'react'
import type { InjectionFieldDefinition, FieldContext } from '@open-mercato/shared/modules/widgets/injection'
import { evaluateInjectedVisibility } from './visibility-utils'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type InjectedFieldProps = {
  field: InjectionFieldDefinition
  value: unknown
  onChange: (fieldId: string, value: unknown) => void
  context: FieldContext
  formData: Record<string, unknown>
  readOnly?: boolean
}

type Option = { value: string; label: string }

const optionsCache = new Map<string, { expiresAt: number; options: Option[] }>()

export function InjectedField({ field, value, onChange, context, formData, readOnly = false }: InjectedFieldProps) {
  const t = useT()
  const [dynamicOptions, setDynamicOptions] = React.useState<Option[] | null>(null)
  const [optionsError, setOptionsError] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    const loadOptions = async () => {
      if (typeof field.optionsLoader !== 'function') return
      const ttl = Math.max(1, field.optionsCacheTtl ?? 60)
      const cacheKey = `${field.id}:${context.organizationId ?? ''}:${context.tenantId ?? ''}`
      const cached = optionsCache.get(cacheKey)
      if (cached && cached.expiresAt > Date.now()) {
        setDynamicOptions(cached.options)
        return
      }
      try {
        const loaded = await field.optionsLoader(context)
        if (cancelled) return
        const normalized = Array.isArray(loaded) ? loaded : []
        setDynamicOptions(normalized)
        setOptionsError(false)
        optionsCache.set(cacheKey, { options: normalized, expiresAt: Date.now() + ttl * 1000 })
      } catch {
        if (cancelled) return
        setDynamicOptions(Array.isArray(field.options) ? field.options : null)
        setOptionsError(true)
      }
    }
    void loadOptions()
    return () => {
      cancelled = true
    }
  }, [context, field.id, field.options, field.optionsCacheTtl, field.optionsLoader])

  if (!evaluateInjectedVisibility(field.visibleWhen, formData, context)) return null

  const label = t(field.label, field.label)
  const disabled = readOnly || field.readOnly
  const options = dynamicOptions ?? field.options ?? []

  if (field.type === 'custom' && field.customComponent) {
    const CustomComponent = field.customComponent
    return (
      <CustomComponent
        value={value}
        onChange={(next) => onChange(field.id, next)}
        context={context}
        disabled={disabled}
      />
    )
  }

  if (field.type === 'textarea') {
    return (
      <div className="space-y-2" data-crud-field-id={field.id}>
        <label className="text-sm font-medium" htmlFor={field.id}>{label}</label>
        <textarea
          id={field.id}
          className="w-full min-h-[96px] rounded border px-3 py-2 text-sm"
          value={typeof value === 'string' ? value : ''}
          disabled={disabled}
          onChange={(event) => onChange(field.id, event.target.value)}
        />
      </div>
    )
  }

  if (field.type === 'select') {
    return (
      <div className="space-y-2" data-crud-field-id={field.id}>
        <label className="text-sm font-medium" htmlFor={field.id}>{label}</label>
        <select
          id={field.id}
          className="h-9 w-full rounded border bg-background px-2 text-sm"
          value={typeof value === 'string' ? value : ''}
          disabled={disabled || (options.length === 0 && !field.options?.length)}
          onChange={(event) => onChange(field.id, event.target.value || undefined)}
        >
          <option value="">{t('ui.filters.select.placeholder', 'Select...')}</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        {optionsError ? (
          <div className="text-xs text-muted-foreground">{t('ui.forms.optionsUnavailable', 'Options unavailable')}</div>
        ) : null}
      </div>
    )
  }

  if (field.type === 'boolean') {
    return (
      <label className="flex items-center gap-2 text-sm" data-crud-field-id={field.id}>
        <input
          type="checkbox"
          checked={value === true}
          disabled={disabled}
          onChange={(event) => onChange(field.id, event.target.checked)}
        />
        <span>{label}</span>
      </label>
    )
  }

  return (
    <div className="space-y-2" data-crud-field-id={field.id}>
      <label className="text-sm font-medium" htmlFor={field.id}>{label}</label>
      <input
        id={field.id}
        type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
        className="h-9 w-full rounded border px-3 text-sm"
        value={typeof value === 'string' || typeof value === 'number' ? String(value) : ''}
        disabled={disabled}
        onChange={(event) => {
          if (field.type === 'number') {
            onChange(field.id, event.target.value === '' ? undefined : Number(event.target.value))
            return
          }
          onChange(field.id, event.target.value)
        }}
      />
    </div>
  )
}

export default InjectedField
