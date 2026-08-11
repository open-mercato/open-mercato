"use client"

import * as React from 'react'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import type { RunParameter } from '../lib/adapter'

/**
 * Form-state representation of a run parameter value. Numbers are held as
 * strings while the operator types; the run API coerces them to the declared
 * type via `normalizeRunParameters`.
 */
export type RunParameterFormValue = string | boolean

export function buildDefaultRunParameterValues(
  params: RunParameter[],
): Record<string, RunParameterFormValue> {
  const values: Record<string, RunParameterFormValue> = {}
  for (const param of params) {
    if (param.type === 'boolean') {
      values[param.key] = param.defaultValue === true
    } else {
      values[param.key] = param.defaultValue !== undefined && param.defaultValue !== null
        ? String(param.defaultValue)
        : ''
    }
  }
  return values
}

export function buildRunParametersPayload(
  params: RunParameter[],
  values: Record<string, RunParameterFormValue>,
): Record<string, RunParameterFormValue> {
  const payload: Record<string, RunParameterFormValue> = {}
  for (const param of params) {
    if (param.key in values) payload[param.key] = values[param.key]
  }
  return payload
}

/**
 * True when a run cannot be started without operator input — a required
 * parameter with no default to fall back on. Surfaces that cannot render the
 * full parameter form (the integration schedule table) use this to point the
 * operator at the Data Sync dashboard instead of failing with a 422.
 */
export function hasRequiredRunParameterWithoutDefault(params: RunParameter[]): boolean {
  return params.some((param) => param.required && param.defaultValue === undefined)
}

export type RunParameterErrorEntry = {
  key?: string
  code?: string
  params?: { label?: string; type?: string; min?: number; max?: number; options?: string }
  message?: string
}

export type RunFailureBody = {
  error?: string
  details?: { parameters?: RunParameterErrorEntry[] }
}

type Translate = TranslateFn

/** Resolves an optional i18n key, falling back to the adapter's literal. */
export function resolveRunParameterText(
  t: Translate,
  key: string | undefined,
  literal: string | undefined,
): string | undefined {
  if (key) {
    const translated = t(key, literal ?? key)
    if (translated && translated !== key) return translated
  }
  return literal
}

const ERROR_FALLBACKS: Record<string, string> = {
  required: '{label} is required.',
  type: '{label} must be a {type}.',
  min: '{label} must be at least {min}.',
  max: '{label} must be at most {max}.',
  select: '{label} must be one of: {options}.',
}

/**
 * Picks the most specific message out of a failed run response and renders it
 * in the operator's language. The run API reports invalid parameters per key
 * under `details.parameters` with a machine-readable `code`; surfacing only the
 * top-level `error` would say "Invalid run parameters" without saying which one
 * or why, and using the server's pre-rendered `message` would put an English
 * sentence next to a translated dashboard.
 */
export function buildRunFailureMessage(
  failure: RunFailureBody | null | undefined,
  fallback: string,
  t?: Translate,
): string {
  const rendered = (failure?.details?.parameters ?? [])
    .map((entry) => {
      if (t && entry?.code && ERROR_FALLBACKS[entry.code]) {
        return t(`data_sync.runParameters.errors.${entry.code}`, ERROR_FALLBACKS[entry.code], {
          ...(entry.params ?? {}),
        })
      }
      return entry?.message
    })
    .filter((message): message is string => typeof message === 'string' && message.trim().length > 0)
  if (rendered.length > 0) return rendered.join(' ')
  return failure?.error ?? fallback
}

export type RunParameterFieldsProps = {
  params: RunParameter[]
  values: Record<string, RunParameterFormValue>
  onChange: (key: string, value: RunParameterFormValue) => void
}

export function RunParameterFields({ params, values, onChange }: RunParameterFieldsProps) {
  const t = useT()
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {params.map((param) => {
        const value = values[param.key]
        const fieldId = `run-param-${param.key}`
        const describedById = `${fieldId}-description`
        const label = resolveRunParameterText(t, param.labelKey, param.label) ?? param.key
        const description = resolveRunParameterText(t, param.descriptionKey, param.description)
        const placeholder = resolveRunParameterText(t, param.placeholderKey, param.placeholder)
        // No required marker on booleans: a switch always submits true/false,
        // so `required` can never fail for them (see RunParameter.required).
        if (param.type === 'boolean') {
          return (
            <div key={param.key} className="rounded-lg border bg-card p-3 sm:col-span-2">
              <div className="flex items-center justify-between gap-3">
                <div className="space-y-1">
                  <Label htmlFor={fieldId} className="text-sm font-medium">{label}</Label>
                  {description ? (
                    <p id={describedById} className="text-xs text-muted-foreground">{description}</p>
                  ) : null}
                </div>
                <Switch
                  id={fieldId}
                  aria-describedby={description ? describedById : undefined}
                  checked={value === true}
                  onCheckedChange={(checked) => onChange(param.key, checked)}
                />
              </div>
            </div>
          )
        }
        return (
          <div key={param.key} className="space-y-2">
            <Label htmlFor={fieldId} className="text-sm font-medium">
              {label}
              {param.required ? <span className="text-status-error-text"> *</span> : null}
            </Label>
            {param.type === 'select' ? (
              <Select
                value={typeof value === 'string' && value.length > 0 ? value : undefined}
                onValueChange={(next) => onChange(param.key, next ?? '')}
              >
                <SelectTrigger id={fieldId} aria-describedby={description ? describedById : undefined}>
                  <SelectValue placeholder={placeholder ?? undefined} />
                </SelectTrigger>
                <SelectContent>
                  {(param.options ?? []).map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label ?? option.value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                id={fieldId}
                aria-describedby={description ? describedById : undefined}
                value={typeof value === 'string' ? value : ''}
                onChange={(event) => onChange(param.key, event.target.value)}
                placeholder={placeholder ?? undefined}
                inputMode={param.type === 'number' ? 'numeric' : undefined}
              />
            )}
            {description ? (
              <p id={describedById} className="text-xs text-muted-foreground">{description}</p>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
