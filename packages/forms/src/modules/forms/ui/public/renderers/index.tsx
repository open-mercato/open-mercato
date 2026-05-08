"use client"

import * as React from 'react'
import type { ComponentType } from 'react'
import { Lock } from 'lucide-react'
import { FormField } from '@open-mercato/ui/primitives/form-field'
import { Input } from '@open-mercato/ui/primitives/input'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import {
  defaultFieldTypeRegistry,
  FieldTypeRegistry,
} from '../../../schema/field-type-registry'
import {
  resolveLocaleString,
  type RunnerFieldNode,
  type RunnerFieldRendererProps,
  type RunnerOption,
} from '../types'

const labelFor = (
  node: RunnerFieldNode | undefined,
  locale: string,
  defaultLocale: string,
  fallback: string,
): string => resolveLocaleString(node?.['x-om-label'], locale, defaultLocale, fallback)

const helpFor = (
  node: RunnerFieldNode | undefined,
  locale: string,
  defaultLocale: string,
): string | undefined => {
  if (!node?.['x-om-help']) return undefined
  return resolveLocaleString(node['x-om-help'], locale, defaultLocale, '')
}

const SensitiveBadge = React.memo(function SensitiveBadge({ label }: { label: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md border border-border bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
      title={label}
      aria-label={label}
    >
      <Lock aria-hidden="true" className="h-3 w-3" />
      <span>{label}</span>
    </span>
  )
})

function FieldShell(
  props: RunnerFieldRendererProps & {
    children: React.ReactNode
    sensitiveLabel?: string
  },
) {
  const { field, fieldNode, locale, defaultLocale, error, sensitiveLabel, children } = props
  const label = labelFor(fieldNode, locale, defaultLocale, field.key)
  const help = helpFor(fieldNode, locale, defaultLocale)
  const description: React.ReactNode = field.sensitive && sensitiveLabel ? (
    <span className="flex flex-wrap items-center gap-2">
      <SensitiveBadge label={sensitiveLabel} />
      {help ? <span>{help}</span> : null}
    </span>
  ) : help

  return (
    <FormField
      label={label}
      required={field.required}
      description={description ?? undefined}
      error={error ?? undefined}
      id={props.inputId}
    >
      {children}
    </FormField>
  )
}

function asString(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  return String(value)
}

function asNumberOrEmpty(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function asArrayOfStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string')
}

function optionsOf(node: RunnerFieldNode): RunnerOption[] {
  const options = node['x-om-options']
  return Array.isArray(options) ? (options as RunnerOption[]) : []
}

const SENSITIVE_KEY = 'forms.runner.encrypted_label'

// ---------- Renderers ----------

export const TextRenderer: ComponentType<RunnerFieldRendererProps> = (props) => {
  const { value, onChange, onBlur, disabled, fieldNode } = props
  const minLength = typeof fieldNode.minLength === 'number' ? fieldNode.minLength : undefined
  const maxLength = typeof fieldNode.maxLength === 'number' ? fieldNode.maxLength : undefined
  const pattern = typeof fieldNode.pattern === 'string' ? fieldNode.pattern : undefined
  return (
    <FieldShell {...props} sensitiveLabel={SENSITIVE_KEY}>
      <Input
        type="text"
        value={asString(value)}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        disabled={disabled}
        minLength={minLength}
        maxLength={maxLength}
        pattern={pattern}
      />
    </FieldShell>
  )
}

export const TextareaRenderer: ComponentType<RunnerFieldRendererProps> = (props) => {
  const { value, onChange, onBlur, disabled } = props
  return (
    <FieldShell {...props} sensitiveLabel={SENSITIVE_KEY}>
      <Textarea
        value={asString(value)}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        disabled={disabled}
        rows={4}
      />
    </FieldShell>
  )
}

const NumericLikeRenderer: (allowDecimal: boolean) => ComponentType<RunnerFieldRendererProps> = (
  allowDecimal,
) => {
  const Renderer: ComponentType<RunnerFieldRendererProps> = (props) => {
    const { value, onChange, onBlur, disabled, fieldNode } = props
    const min = typeof fieldNode['x-om-min'] === 'number' ? (fieldNode['x-om-min'] as number) : undefined
    const max = typeof fieldNode['x-om-max'] === 'number' ? (fieldNode['x-om-max'] as number) : undefined
    return (
      <FieldShell {...props} sensitiveLabel={SENSITIVE_KEY}>
        <Input
          type="number"
          value={asNumberOrEmpty(value)}
          onChange={(event) => {
            const raw = event.target.value
            if (raw === '') {
              onChange(undefined)
              return
            }
            const parsed = allowDecimal ? Number.parseFloat(raw) : Number.parseInt(raw, 10)
            if (Number.isFinite(parsed)) {
              onChange(parsed)
            }
          }}
          onBlur={onBlur}
          disabled={disabled}
          min={min}
          max={max}
          step={allowDecimal ? 'any' : 1}
        />
      </FieldShell>
    )
  }
  return Renderer
}

export const NumberRenderer = NumericLikeRenderer(true)
export const IntegerRenderer = NumericLikeRenderer(false)

export const BooleanRenderer: ComponentType<RunnerFieldRendererProps> = (props) => {
  const { value, onChange, disabled } = props
  const checked = value === true
  return (
    <FieldShell {...props} sensitiveLabel={SENSITIVE_KEY}>
      <Checkbox
        checked={checked}
        onCheckedChange={(state) => onChange(state === true)}
        disabled={disabled}
      />
    </FieldShell>
  )
}

export const DateRenderer: ComponentType<RunnerFieldRendererProps> = (props) => {
  const { value, onChange, onBlur, disabled } = props
  return (
    <FieldShell {...props} sensitiveLabel={SENSITIVE_KEY}>
      <Input
        type="date"
        value={asString(value)}
        onChange={(event) => onChange(event.target.value || undefined)}
        onBlur={onBlur}
        disabled={disabled}
      />
    </FieldShell>
  )
}

export const DatetimeRenderer: ComponentType<RunnerFieldRendererProps> = (props) => {
  const { value, onChange, onBlur, disabled } = props
  return (
    <FieldShell {...props} sensitiveLabel={SENSITIVE_KEY}>
      <Input
        type="datetime-local"
        value={asString(value)}
        onChange={(event) => onChange(event.target.value || undefined)}
        onBlur={onBlur}
        disabled={disabled}
      />
    </FieldShell>
  )
}

export const SelectOneRenderer: ComponentType<RunnerFieldRendererProps> = (props) => {
  const { value, onChange, disabled, fieldNode, locale, defaultLocale } = props
  const options = optionsOf(fieldNode)
  return (
    <FieldShell {...props} sensitiveLabel={SENSITIVE_KEY}>
      <Select
        value={asString(value)}
        onValueChange={(next) => onChange(next || undefined)}
        disabled={disabled}
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {resolveLocaleString(option.label, locale, defaultLocale, option.value)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FieldShell>
  )
}

export const SelectManyRenderer: ComponentType<RunnerFieldRendererProps> = (props) => {
  const { value, onChange, disabled, fieldNode, locale, defaultLocale } = props
  const options = optionsOf(fieldNode)
  const selected = new Set(asArrayOfStrings(value))
  const toggle = (entry: string) => {
    const next = new Set(selected)
    if (next.has(entry)) next.delete(entry)
    else next.add(entry)
    onChange(Array.from(next))
  }
  return (
    <FieldShell {...props} sensitiveLabel={SENSITIVE_KEY}>
      <div role="group" className="flex flex-col gap-2">
        {options.map((option) => {
          const isChecked = selected.has(option.value)
          const label = resolveLocaleString(option.label, locale, defaultLocale, option.value)
          return (
            <label
              key={option.value}
              className="flex items-center gap-2 text-sm text-foreground"
            >
              <Checkbox
                checked={isChecked}
                onCheckedChange={() => toggle(option.value)}
                disabled={disabled}
              />
              <span>{label}</span>
            </label>
          )
        })}
      </div>
    </FieldShell>
  )
}

export const ScaleRenderer: ComponentType<RunnerFieldRendererProps> = (props) => {
  const { value, onChange, disabled, fieldNode } = props
  const min = typeof fieldNode['x-om-min'] === 'number' ? (fieldNode['x-om-min'] as number) : 0
  const max = typeof fieldNode['x-om-max'] === 'number' ? (fieldNode['x-om-max'] as number) : 10
  const current = typeof value === 'number' && Number.isFinite(value) ? (value as number) : null
  return (
    <FieldShell {...props} sensitiveLabel={SENSITIVE_KEY}>
      <div className="flex items-center gap-2">
        <Input
          type="range"
          min={min}
          max={max}
          step={1}
          value={current ?? min}
          onChange={(event) => onChange(Number.parseInt(event.target.value, 10))}
          disabled={disabled}
          className="flex-1"
          aria-valuenow={current ?? undefined}
          aria-valuemin={min}
          aria-valuemax={max}
        />
        <span className="min-w-8 text-center text-sm text-muted-foreground" aria-live="polite">
          {current ?? '–'}
        </span>
      </div>
    </FieldShell>
  )
}

export const InfoBlockRenderer: ComponentType<RunnerFieldRendererProps> = (props) => {
  const { fieldNode, locale, defaultLocale } = props
  const label = resolveLocaleString(fieldNode['x-om-label'], locale, defaultLocale, '')
  const help = resolveLocaleString(fieldNode['x-om-help'], locale, defaultLocale, '')
  return (
    <div className="rounded-md border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
      {label ? <p className="font-medium text-foreground">{label}</p> : null}
      {help ? <p className="mt-1 whitespace-pre-line">{help}</p> : null}
    </div>
  )
}

export const CORE_RENDERER_MAP: Record<string, ComponentType<RunnerFieldRendererProps>> = {
  text: TextRenderer,
  textarea: TextareaRenderer,
  number: NumberRenderer,
  integer: IntegerRenderer,
  boolean: BooleanRenderer,
  date: DateRenderer,
  datetime: DatetimeRenderer,
  select_one: SelectOneRenderer,
  select_many: SelectManyRenderer,
  scale: ScaleRenderer,
  info_block: InfoBlockRenderer,
}

export function registerCoreRenderers(registry: FieldTypeRegistry = defaultFieldTypeRegistry) {
  for (const [key, component] of Object.entries(CORE_RENDERER_MAP)) {
    registry.setRenderer(key, component as ComponentType<unknown>)
  }
}

export function getCoreRenderer(typeKey: string): ComponentType<RunnerFieldRendererProps> | null {
  return CORE_RENDERER_MAP[typeKey] ?? null
}
