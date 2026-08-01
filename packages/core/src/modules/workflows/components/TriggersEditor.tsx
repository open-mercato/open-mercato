'use client'

import { useState } from 'react'
import { ChevronDown, MousePointerClick, Pencil, Plus, Trash2 } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { Tag } from '@open-mercato/ui/primitives/tag'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { WorkflowDefinitionTrigger } from '../data/entities'

/** Technical operator identifiers — labels are intentionally terse and untranslated (they mirror the query grammar). */
const FILTER_OPERATORS: { value: string; label: string }[] = [
  { value: 'eq', label: 'equals' },
  { value: 'neq', label: 'not equals' },
  { value: 'gt', label: '>' },
  { value: 'gte', label: '>=' },
  { value: 'lt', label: '<' },
  { value: 'lte', label: '<=' },
  { value: 'contains', label: 'contains' },
  { value: 'startsWith', label: 'starts with' },
  { value: 'endsWith', label: 'ends with' },
  { value: 'in', label: 'in' },
  { value: 'notIn', label: 'not in' },
  { value: 'exists', label: 'exists' },
  { value: 'notExists', label: 'not exists' },
  { value: 'regex', label: 'regex' },
]

type FilterCondition = { field: string; operator: string; value: unknown }
type ContextMapping = { targetKey: string; sourceExpression: string; defaultValue?: unknown }

let triggerIdSeq = 0
function newTriggerId(): string {
  triggerIdSeq += 1
  return `trigger_${Date.now().toString(36)}_${triggerIdSeq.toString(36)}`
}

export interface TriggersEditorProps {
  value: WorkflowDefinitionTrigger[]
  onChange: (triggers: WorkflowDefinitionTrigger[]) => void
}

/**
 * Lighter, inline trigger editor for the Triggers modal (fidelity gap #5,
 * Direction A). Each trigger is a row with a Switch toggle and click-to-expand
 * inline editing — no nested drawer — plus a "Manual / API — built-in" row that
 * states the always-available start path. Reuses the existing
 * `workflows.triggers.*` translations. `DefinitionTriggersEditor` (the older
 * drawer-based editor) is retained for the deprecated mobile sheet.
 */
export function TriggersEditor({ value, onChange }: TriggersEditorProps) {
  const t = useT()
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const patch = (id: string, next: Partial<WorkflowDefinitionTrigger>) =>
    onChange(value.map((trigger) => (trigger.triggerId === id ? { ...trigger, ...next } : trigger)))
  const patchConfig = (id: string, next: Record<string, unknown>) =>
    onChange(
      value.map((trigger) =>
        trigger.triggerId === id ? { ...trigger, config: { ...(trigger.config ?? {}), ...next } } : trigger,
      ),
    )
  const remove = (id: string) => {
    onChange(value.filter((trigger) => trigger.triggerId !== id))
    if (expandedId === id) setExpandedId(null)
  }
  const add = () => {
    const id = newTriggerId()
    onChange([
      ...value,
      { triggerId: id, name: '', eventPattern: '', enabled: true, priority: 100, config: {} },
    ])
    setExpandedId(id)
  }

  const parseNumber = (raw: string): number | undefined => {
    const parsed = Number.parseInt(raw, 10)
    return Number.isFinite(parsed) ? parsed : undefined
  }

  return (
    <div className="space-y-2">
      {value.map((trigger) => {
        const expanded = expandedId === trigger.triggerId
        const config = (trigger.config ?? {}) as {
          filterConditions?: FilterCondition[]
          contextMapping?: ContextMapping[]
          debounceMs?: number
          maxConcurrentInstances?: number
        }
        const filters = config.filterConditions ?? []
        const mappings = config.contextMapping ?? []
        const setFilters = (nextFilters: FilterCondition[]) => patchConfig(trigger.triggerId, { filterConditions: nextFilters })
        const setMappings = (nextMappings: ContextMapping[]) => patchConfig(trigger.triggerId, { contextMapping: nextMappings })

        return (
          <div
            key={trigger.triggerId}
            data-testid="trigger-row"
            className={`rounded-md border bg-card ${expanded ? 'border-accent-indigo' : 'border-border'}`}
          >
            <div className="flex items-center gap-3 px-3 py-2.5">
              <Switch
                checked={!!trigger.enabled}
                onCheckedChange={(checked) => patch(trigger.triggerId, { enabled: checked })}
                aria-label={t('workflows.triggers.fields.enabled', 'Enabled')}
              />
              <button
                type="button"
                onClick={() => setExpandedId(expanded ? null : trigger.triggerId)}
                className="flex min-w-0 flex-1 flex-col items-start text-left focus-visible:outline-none"
              >
                <span className="truncate text-sm font-semibold text-foreground">
                  {trigger.name || t('workflows.triggers.placeholders.name', 'New trigger')}
                </span>
                <code className="truncate font-mono text-xs text-muted-foreground">
                  {trigger.eventPattern || '—'}
                </code>
              </button>
              {!trigger.enabled ? <Tag variant="neutral">{t('common.disabled', 'disabled')}</Tag> : null}
              <IconButton
                type="button"
                variant="ghost"
                aria-label={t('workflows.triggers.actions.edit', 'Edit')}
                onClick={() => setExpandedId(expanded ? null : trigger.triggerId)}
              >
                <Pencil className="size-4" />
              </IconButton>
              <IconButton
                type="button"
                variant="ghost"
                aria-label={t('workflows.triggers.actions.delete', 'Delete')}
                onClick={() => remove(trigger.triggerId)}
              >
                <Trash2 className="size-4 text-status-error-icon" />
              </IconButton>
            </div>

            {expanded ? (
              <div className="space-y-3 border-t border-border px-3 py-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`trigger-${trigger.triggerId}-name`}>
                      {t('workflows.triggers.fields.name', 'Name')}
                    </Label>
                    <Input
                      id={`trigger-${trigger.triggerId}-name`}
                      value={trigger.name}
                      placeholder={t('workflows.triggers.placeholders.name', 'New trigger')}
                      onChange={(event) => patch(trigger.triggerId, { name: event.target.value })}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`trigger-${trigger.triggerId}-event`}>
                      {t('workflows.triggers.fields.eventPattern', 'Event pattern')}
                    </Label>
                    <Input
                      id={`trigger-${trigger.triggerId}-event`}
                      className="font-mono"
                      value={trigger.eventPattern}
                      placeholder={t('workflows.triggers.placeholders.eventPattern', 'module.entity.action')}
                      onChange={(event) => patch(trigger.triggerId, { eventPattern: event.target.value })}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>{t('workflows.triggers.fields.filterConditions', 'Filter conditions')}</Label>
                  {filters.map((condition, index) => (
                    <div key={index} className="grid grid-cols-[1fr_auto_1fr_auto] items-center gap-2">
                      <Input
                        value={condition.field}
                        placeholder={t('workflows.triggers.placeholders.orderId', 'field')}
                        onChange={(event) =>
                          setFilters(filters.map((item, i) => (i === index ? { ...item, field: event.target.value } : item)))
                        }
                      />
                      <Select
                        value={condition.operator}
                        onValueChange={(operator) =>
                          setFilters(filters.map((item, i) => (i === index ? { ...item, operator } : item)))
                        }
                      >
                        <SelectTrigger className="w-32">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {FILTER_OPERATORS.map((operator) => (
                            <SelectItem key={operator.value} value={operator.value}>
                              {operator.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        value={String(condition.value ?? '')}
                        placeholder={t('workflows.triggers.values.placeholder', 'value')}
                        onChange={(event) =>
                          setFilters(filters.map((item, i) => (i === index ? { ...item, value: event.target.value } : item)))
                        }
                      />
                      <IconButton
                        type="button"
                        variant="ghost"
                        aria-label={t('workflows.triggers.actions.delete', 'Delete')}
                        onClick={() => setFilters(filters.filter((_, i) => i !== index))}
                      >
                        <Trash2 className="size-4 text-status-error-icon" />
                      </IconButton>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setFilters([...filters, { field: '', operator: 'eq', value: '' }])}
                  >
                    <Plus className="size-4" />
                    {t('workflows.triggers.addCondition', 'Add condition')}
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    {t('workflows.triggers.hints.filterConditions', 'Only start when the event payload matches.')}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`trigger-${trigger.triggerId}-debounce`}>
                      {t('workflows.triggers.fields.debounceMs', 'Debounce (ms)')}
                    </Label>
                    <Input
                      id={`trigger-${trigger.triggerId}-debounce`}
                      type="number"
                      value={config.debounceMs ?? ''}
                      placeholder={t('workflows.triggers.placeholders.debounce', '0')}
                      onChange={(event) => patchConfig(trigger.triggerId, { debounceMs: parseNumber(event.target.value) })}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor={`trigger-${trigger.triggerId}-max`}>
                      {t('workflows.triggers.fields.maxConcurrent', 'Max concurrent')}
                    </Label>
                    <Input
                      id={`trigger-${trigger.triggerId}-max`}
                      type="number"
                      value={config.maxConcurrentInstances ?? ''}
                      placeholder={t('workflows.triggers.placeholders.unlimited', 'unlimited')}
                      onChange={(event) => patchConfig(trigger.triggerId, { maxConcurrentInstances: parseNumber(event.target.value) })}
                    />
                  </div>
                </div>

                <details className="rounded-md border border-border px-3 py-2">
                  <summary className="flex cursor-pointer items-center gap-1 text-xs font-semibold text-muted-foreground">
                    <ChevronDown className="size-3" />
                    {t('workflows.triggers.fields.contextMapping', 'Context mapping')} ·{' '}
                    {t('workflows.triggers.fields.priority', 'Priority')}
                  </summary>
                  <div className="mt-3 space-y-3">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor={`trigger-${trigger.triggerId}-priority`}>
                        {t('workflows.triggers.fields.priority', 'Priority')}
                      </Label>
                      <Input
                        id={`trigger-${trigger.triggerId}-priority`}
                        type="number"
                        value={trigger.priority ?? ''}
                        onChange={(event) => patch(trigger.triggerId, { priority: parseNumber(event.target.value) ?? 100 })}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>{t('workflows.triggers.fields.contextMapping', 'Context mapping')}</Label>
                      {mappings.map((mapping, index) => (
                        <div key={index} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
                          <Input
                            value={mapping.targetKey}
                            placeholder={t('workflows.triggers.placeholders.status', 'target key')}
                            onChange={(event) =>
                              setMappings(mappings.map((item, i) => (i === index ? { ...item, targetKey: event.target.value } : item)))
                            }
                          />
                          <Input
                            value={mapping.sourceExpression}
                            placeholder={t('workflows.triggers.placeholders.sourceExpression', 'payload.field')}
                            onChange={(event) =>
                              setMappings(mappings.map((item, i) => (i === index ? { ...item, sourceExpression: event.target.value } : item)))
                            }
                          />
                          <IconButton
                            type="button"
                            variant="ghost"
                            aria-label={t('workflows.triggers.actions.delete', 'Delete')}
                            onClick={() => setMappings(mappings.filter((_, i) => i !== index))}
                          >
                            <Trash2 className="size-4 text-status-error-icon" />
                          </IconButton>
                        </div>
                      ))}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setMappings([...mappings, { targetKey: '', sourceExpression: '' }])}
                      >
                        <Plus className="size-4" />
                        {t('workflows.triggers.addMapping', 'Add mapping')}
                      </Button>
                    </div>
                  </div>
                </details>
              </div>
            ) : null}
          </div>
        )
      })}

      <div className="flex items-center gap-3 rounded-md border border-dashed border-border bg-card px-3 py-2.5">
        <MousePointerClick className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-foreground">
            {t('workflows.triggerNode.manual', 'manual / API start')}
          </div>
          <div className="text-xs text-muted-foreground">
            {t('workflows.triggers.manualBuiltInHint', 'always available')}
          </div>
        </div>
        <Tag variant="success">{t('workflows.triggers.builtIn', 'built-in')}</Tag>
      </div>

      <Button type="button" variant="outline" size="sm" onClick={add} data-testid="add-trigger">
        <Plus className="size-4" />
        {t('workflows.triggers.add', 'Add trigger')}
      </Button>
    </div>
  )
}
