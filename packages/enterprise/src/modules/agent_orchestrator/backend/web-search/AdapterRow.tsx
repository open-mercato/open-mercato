"use client"

/**
 * One draggable adapter row plus its collapsible option form.
 *
 * Split out of the page so the sortable wiring stays legible: the row owns its
 * drag transform and disclosure state, the page owns the list and the policy.
 */

import * as React from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ChevronDown, ChevronRight, GripVertical } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export type OptionField = {
  name: string
  kind: 'string' | 'number' | 'boolean' | 'enum' | 'stringList'
  required: boolean
  secret: boolean
  choices?: string[]
  format?: string
}

export type InstalledAdapter = {
  id: string
  kind: string
  packageName: string
  fields: OptionField[]
  options: Record<string, unknown>
  configured: boolean
  configurationHint: string | null
}

export const SECRET_PLACEHOLDER = '__om_secret_unchanged__'

const ACRONYMS: Readonly<Record<string, string>> = {
  url: 'URL',
  api: 'API',
  ua: 'UA',
  id: 'ID',
  ttl: 'TTL',
  ms: '(ms)',
}

/** `baseUrl` -> `Base URL`, `timeoutMs` -> `Timeout (ms)`. Schema keys are not labels. */
export function humanizeFieldName(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[\s_-]+/)
    .map((word, index) => {
      const lower = word.toLowerCase()
      if (ACRONYMS[lower]) return ACRONYMS[lower]
      return index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : lower
    })
    .join(' ')
    .trim()
}

function OptionInput({
  field,
  value,
  onChange,
  savedHint,
}: {
  field: OptionField
  value: unknown
  onChange: (next: unknown) => void
  savedHint: string
}) {
  if (field.kind === 'boolean') {
    return <Switch checked={value === true} onCheckedChange={onChange} />
  }
  if (field.kind === 'enum') {
    return (
      <Select value={typeof value === 'string' ? value : ''} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(field.choices ?? []).map((choice) => (
            <SelectItem key={choice} value={choice}>
              {choice}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }
  if (field.kind === 'number') {
    return (
      <Input
        type="number"
        inputMode="numeric"
        autoComplete="off"
        value={typeof value === 'number' ? value : ''}
        onChange={(event) => onChange(event.target.value === '' ? undefined : Number(event.target.value))}
      />
    )
  }
  if (field.kind === 'stringList') {
    return (
      <Input
        autoComplete="off"
        value={Array.isArray(value) ? (value as string[]).join(', ') : ''}
        placeholder="a, b, c"
        onChange={(event) => {
          const parts = event.target.value
            .split(',')
            .map((part) => part.trim())
            .filter((part) => part.length > 0)
          onChange(parts.length > 0 ? parts : undefined)
        }}
      />
    )
  }

  // A stored secret arrives as a placeholder token. Render an empty field with an
  // "already saved" hint rather than dots that look like a real value.
  const isStoredSecret = field.secret && value === SECRET_PLACEHOLDER
  return (
    <Input
      type={field.secret ? 'password' : 'text'}
      // Generic inputs in a settings form are irresistible to password managers —
      // one autofilled the operator's email into `userAgent`.
      autoComplete="off"
      data-1p-ignore
      data-lpignore="true"
      name={`om-adapter-${field.name}`}
      value={isStoredSecret ? '' : typeof value === 'string' ? value : ''}
      placeholder={isStoredSecret ? savedHint : field.format === 'url' ? 'https://…' : undefined}
      onChange={(event) =>
        onChange(
          event.target.value === '' ? (field.secret ? SECRET_PLACEHOLDER : undefined) : event.target.value,
        )
      }
    />
  )
}

export type AdapterRowProps = {
  id: string
  enabled: boolean
  weight: number
  meta?: InstalledAdapter
  options: Record<string, unknown>
  onToggle: (enabled: boolean) => void
  onWeight: (weight: number) => void
  onOption: (field: string, value: unknown) => void
}

export function AdapterRow({
  id,
  enabled,
  weight,
  meta,
  options,
  onToggle,
  onWeight,
  onOption,
}: AdapterRowProps) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const fields = meta?.fields ?? []

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`rounded-lg border bg-card transition-colors ${
        isDragging ? 'border-primary shadow-lg' : 'border-border'
      } ${enabled ? '' : 'opacity-70'}`}
    >
      <div className="flex items-center gap-3 p-3">
        <span
          className="cursor-grab text-muted-foreground active:cursor-grabbing"
          aria-label={t('agent_orchestrator.settings.webSearch.dragHandle', 'Reorder')}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="size-4" />
        </span>

        <Switch checked={enabled} onCheckedChange={onToggle} />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{id}</span>
            {meta && !meta.configured ? (
              <StatusBadge variant="warning">
                {t('agent_orchestrator.settings.webSearch.needsConfig', 'Configuration required')}
              </StatusBadge>
            ) : null}
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {meta?.packageName ?? t('agent_orchestrator.settings.webSearch.notInstalled', 'Not installed')}
            {meta && !meta.configured && meta.configurationHint ? ` — ${meta.configurationHint}` : ''}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <Label className="text-xs text-muted-foreground">
            {t('agent_orchestrator.settings.webSearch.weight', 'Weight')}
          </Label>
          <Input
            type="number"
            min={0}
            max={10}
            step={0.5}
            autoComplete="off"
            value={weight}
            className="h-8 w-16"
            onChange={(event) => onWeight(Number(event.target.value) || 0)}
          />
          {fields.length > 0 ? (
            <Button variant="ghost" size="sm" onClick={() => setOpen((current) => !current)}>
              {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
              {t('agent_orchestrator.settings.webSearch.showConfig', 'Configure')}
            </Button>
          ) : null}
        </div>
      </div>

      {open && fields.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 border-t border-border p-4 sm:grid-cols-2">
          {fields.map((field) => (
            <div key={field.name} className="space-y-1.5">
              <Label>
                {humanizeFieldName(field.name)}
                {field.required ? <span className="ml-0.5 text-status-error-text">*</span> : null}
              </Label>
              <OptionInput
                field={field}
                value={options[field.name]}
                savedHint={t('agent_orchestrator.settings.webSearch.secretSaved', 'Saved - type to replace')}
                onChange={(next) => onOption(field.name, next)}
              />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
