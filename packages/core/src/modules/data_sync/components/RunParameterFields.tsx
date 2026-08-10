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

export type RunParameterFieldsProps = {
  params: RunParameter[]
  values: Record<string, RunParameterFormValue>
  onChange: (key: string, value: RunParameterFormValue) => void
}

export function RunParameterFields({ params, values, onChange }: RunParameterFieldsProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {params.map((param) => {
        const value = values[param.key]
        // No required marker on booleans: a switch always submits true/false,
        // so `required` can never fail for them (see RunParameter.required).
        if (param.type === 'boolean') {
          return (
            <div key={param.key} className="rounded-lg border bg-card p-3 sm:col-span-2">
              <div className="flex items-center justify-between gap-3">
                <div className="space-y-1">
                  <Label className="text-sm font-medium">{param.label}</Label>
                  {param.description ? (
                    <p className="text-xs text-muted-foreground">{param.description}</p>
                  ) : null}
                </div>
                <Switch
                  checked={value === true}
                  onCheckedChange={(checked) => onChange(param.key, checked)}
                />
              </div>
            </div>
          )
        }
        return (
          <div key={param.key} className="space-y-2">
            <Label className="text-sm font-medium">
              {param.label}
              {param.required ? <span className="text-status-error-text"> *</span> : null}
            </Label>
            {param.type === 'select' ? (
              <Select
                value={typeof value === 'string' && value.length > 0 ? value : undefined}
                onValueChange={(next) => onChange(param.key, next ?? '')}
              >
                <SelectTrigger>
                  <SelectValue placeholder={param.placeholder ?? undefined} />
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
                value={typeof value === 'string' ? value : ''}
                onChange={(event) => onChange(param.key, event.target.value)}
                placeholder={param.placeholder ?? undefined}
                inputMode={param.type === 'number' ? 'numeric' : undefined}
              />
            )}
            {param.description ? (
              <p className="text-xs text-muted-foreground">{param.description}</p>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
