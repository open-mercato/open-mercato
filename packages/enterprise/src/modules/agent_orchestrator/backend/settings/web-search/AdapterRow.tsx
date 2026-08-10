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

export type AdapterHealth = {
  id: string
  enabled: boolean
  ready: boolean
  ok: boolean
  detail: string | null
  latencyMs: number | null
  /** False when the row reports configuration only, with no call made. */
  probed?: boolean
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
  /** Per-adapter budget; falls back to the policy-wide one when unset. */
  timeoutMs?: number
  /** Hourly call ceiling for this tenant; empty means no ceiling. */
  maxCallsPerHour?: number
  meta?: InstalledAdapter
  health?: AdapterHealth
  options: Record<string, unknown>
  onToggle: (enabled: boolean) => void
  onWeight: (weight: number) => void
  onTimeout: (timeoutMs: number | undefined) => void
  onMaxCalls: (maxCallsPerHour: number | undefined) => void
  onOption: (field: string, value: unknown) => void
  /** True when this adapter's options differ from what is stored. */
}

export function AdapterRow({
  id,
  enabled,
  weight,
  timeoutMs,
  maxCallsPerHour,
  meta,
  health,
  options,
  onToggle,
  onWeight,
  onTimeout,
  onMaxCalls,
  onOption,
}: AdapterRowProps) {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const fields = meta?.fields ?? []

  // Health is shown per row rather than in a separate card: a standalone summary
  // goes stale the moment an adapter is toggled or reordered, and it separated a
  // fact from the control that changes it.
  const needsConfig = meta ? !meta.configured : false
  const statusDetail =
    (needsConfig ? meta?.configurationHint : null) ??
    health?.detail ??
    (health?.ok && health.latencyMs !== null ? `${health.latencyMs}ms` : null)

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
            {needsConfig ? (
              <span className="text-xs text-status-warning-text">
                {t('agent_orchestrator.settings.webSearch.needsConfig', 'Configuration required')}
              </span>
            ) : enabled && health?.probed ? (
              <span
                className={
                  health.ok ? 'text-xs text-status-success-text' : 'text-xs text-status-warning-text'
                }
              >
                {health.ok
                  ? t('agent_orchestrator.settings.webSearch.healthOk', 'Healthy')
                  : t('agent_orchestrator.settings.webSearch.healthProblem', 'Problem')}
              </span>
            ) : enabled ? (
              // Configured is not the same claim as working. Saying "Healthy" for
              // an adapter nobody called would be a guess dressed as a fact.
              <span className="text-xs text-muted-foreground">
                {t('agent_orchestrator.settings.webSearch.healthUntested', 'Not tested')}
              </span>
            ) : null}
          </div>
          <p className="truncate text-xs text-muted-foreground">
            <span className="font-mono">{meta?.packageName ?? '—'}</span>
            {statusDetail ? <span className="ml-2">{statusDetail}</span> : null}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {/* Always available: an adapter has engine-level knobs even when its
              package exposes no options of its own. */}
          <Button variant="ghost" size="sm" onClick={() => setOpen((current) => !current)}>
            {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
            {t('agent_orchestrator.settings.webSearch.showConfig', 'Configure')}
          </Button>
        </div>
      </div>

      {open ? (
        <div className="space-y-4 border-t border-border p-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>{t('agent_orchestrator.settings.webSearch.weight', 'Weight')}</Label>
              <Input
                type="number"
                min={0}
                max={10}
                step={0.5}
                autoComplete="off"
                value={weight}
                onChange={(event) => onWeight(Number(event.target.value) || 0)}
              />
              <p className="text-xs text-muted-foreground">
                {t(
                  'agent_orchestrator.settings.webSearch.weightHint',
                  'How much this source pulls in the merged ranking.',
                )}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>{t('agent_orchestrator.settings.webSearch.timeout', 'Timeout')}</Label>
              <Input
                type="number"
                min={250}
                max={120000}
                step={1000}
                autoComplete="off"
                value={timeoutMs ?? ''}
                placeholder={t('agent_orchestrator.settings.webSearch.timeoutDefault', 'default')}
                onChange={(event) => {
                  const raw = event.target.value.trim()
                  onTimeout(raw === '' ? undefined : Number(raw))
                }}
              />
              {/* Latency is not uniform across kinds: a SERP read finishes in about
                  a second while a model running its own web search takes tens. */}
              <p className="text-xs text-muted-foreground">
                {t(
                  'agent_orchestrator.settings.webSearch.timeoutHint',
                  'Milliseconds this adapter alone may take. Leave empty to use the policy-wide budget.',
                )}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>{t('agent_orchestrator.settings.webSearch.maxCalls', 'Calls/h')}</Label>
              <Input
                type="number"
                min={1}
                step={10}
                autoComplete="off"
                value={maxCallsPerHour ?? ''}
                placeholder={t('agent_orchestrator.settings.webSearch.maxCallsDefault', 'unlimited')}
                onChange={(event) => {
                  const raw = event.target.value.trim()
                  onMaxCalls(raw === '' ? undefined : Number(raw))
                }}
              />
              <p className="text-xs text-muted-foreground">
                {t(
                  'agent_orchestrator.settings.webSearch.maxCallsHint',
                  'Most calls this adapter may make per hour for this tenant. Once reached it sits searches out, including as last resort. Leave empty for no ceiling.',
                )}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
          {/* Committed by the page's single Save, not here: a card of its own
              was the second button operators could not tell apart from it. */}
        </div>
      ) : null}
    </div>
  )
}
