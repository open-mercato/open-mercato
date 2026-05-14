'use client'

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { Trash2 } from '../lucide-icons'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  type ConditionBuilderModel,
  type ConditionOperator,
  type ConditionRow,
  compilePredicate,
  emptyModel,
  newRow,
  parsePredicate,
} from './condition-model'
import { resolveTypeLabel } from '../type-label'
import type { FormSchema } from '../schema-helpers'

export type ConditionSourceOption = {
  value: string
  label: string
  fieldType?: string | null
  namespace: 'field' | 'hidden' | 'variable'
}

export type ConditionBuilderProps = {
  predicate: unknown | null
  sources: ConditionSourceOption[]
  onChange: (next: unknown | null) => void
}

const OPERATORS_BY_TYPE: Record<string, ConditionOperator[]> = {
  text: ['eq', 'neq', 'contains', 'is_empty', 'is_not_empty'],
  textarea: ['eq', 'neq', 'contains', 'is_empty', 'is_not_empty'],
  date: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is_empty', 'is_not_empty'],
  datetime: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is_empty', 'is_not_empty'],
  number: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'],
  integer: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'],
  scale: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'],
  boolean: ['is_true', 'is_false'],
  yes_no: ['is_true', 'is_false'],
  select_one: ['eq', 'neq'],
  select_many: ['contains'],
}

const FALLBACK_OPERATORS: ConditionOperator[] = ['eq', 'neq']

function operatorOptions(source: ConditionSourceOption | undefined): ConditionOperator[] {
  if (!source) return FALLBACK_OPERATORS
  const fieldType = source.fieldType ?? undefined
  if (fieldType && OPERATORS_BY_TYPE[fieldType]) return OPERATORS_BY_TYPE[fieldType]
  if (source.namespace === 'variable') return ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'is_true', 'is_false']
  if (source.namespace === 'hidden') return ['eq', 'neq', 'contains', 'is_empty', 'is_not_empty']
  return FALLBACK_OPERATORS
}

export function ConditionBuilder({ predicate, sources, onChange }: ConditionBuilderProps) {
  const t = useT()
  const [model, setModel] = React.useState<ConditionBuilderModel>(() => parsePredicate(predicate))

  React.useEffect(() => {
    setModel(parsePredicate(predicate))
  }, [predicate])

  const commit = React.useCallback(
    (nextModel: ConditionBuilderModel) => {
      setModel(nextModel)
      const compiled = compilePredicate(nextModel)
      onChange(compiled)
    },
    [onChange],
  )

  const sourceByValue = React.useMemo(() => {
    const map = new Map<string, ConditionSourceOption>()
    for (const entry of sources) map.set(entry.value, entry)
    return map
  }, [sources])

  if (model.raw !== null && model.rows.length === 0) {
    return (
      <div className="space-y-2">
        <Tag variant="warning">{t('forms.studio.logic.visibility.rawShape')}</Tag>
        <pre className="max-h-40 overflow-auto rounded-md border border-border bg-muted/40 p-2 text-xs">
          {JSON.stringify(model.raw, null, 2)}
        </pre>
        <Button
          variant="outline"
          size="sm"
          type="button"
          onClick={() => commit(emptyModel())}
        >
          {t('forms.studio.logic.visibility.clear')}
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-3" data-testid="condition-builder">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {t('forms.studio.logic.visibility.heading')}
        </h4>
        <Button
          variant="outline"
          size="sm"
          type="button"
          onClick={() => commit({ ...model, rows: [...model.rows, newRow(sources[0]?.value ?? '')] })}
        >
          {t('forms.studio.logic.visibility.addRule')}
        </Button>
      </div>
      {model.rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('forms.studio.logic.visibility.always')}</p>
      ) : null}
      <div className="space-y-2">
        {model.rows.map((row, index) => {
          const sourceOption = sourceByValue.get(row.source)
          const operators = operatorOptions(sourceOption)
          const operator = operators.includes(row.operator) ? row.operator : operators[0] ?? 'eq'
          const valueDisabled =
            operator === 'is_empty' || operator === 'is_not_empty' || operator === 'is_true' || operator === 'is_false'
          const updateRow = (partial: Partial<ConditionRow>) => {
            const nextRows = model.rows.map((entry) => (entry.id === row.id ? { ...entry, ...partial } : entry))
            commit({ ...model, rows: nextRows })
          }
          const removeRow = () => {
            commit({ ...model, rows: model.rows.filter((entry) => entry.id !== row.id) })
          }
          return (
            <div key={row.id} className="flex items-center gap-2" data-testid="condition-row">
              {index > 0 ? (
                <Tag variant="neutral" className="shrink-0 uppercase">
                  {model.combine === 'and'
                    ? t('forms.studio.logic.visibility.combine.and')
                    : t('forms.studio.logic.visibility.combine.or')}
                </Tag>
              ) : null}
              <Select value={row.source} onValueChange={(value) => updateRow({ source: value })}>
                <SelectTrigger className="h-8 flex-1">
                  <SelectValue placeholder={t('forms.studio.logic.visibility.sourcePlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {sources.map((source) => (
                    <SelectItem key={source.value} value={source.value}>
                      {source.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={operator}
                onValueChange={(value) => updateRow({ operator: value as ConditionOperator })}
              >
                <SelectTrigger className="h-8 w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {operators.map((op) => (
                    <SelectItem key={op} value={op}>
                      {t(`forms.studio.logic.visibility.op.${op}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                className="h-8 w-32"
                value={valueDisabled ? '' : String(row.value ?? '')}
                disabled={valueDisabled}
                onChange={(event) => updateRow({ value: event.target.value })}
              />
              <IconButton
                aria-label={t('forms.studio.logic.visibility.remove')}
                variant="ghost"
                size="sm"
                type="button"
                onClick={removeRow}
              >
                <Trash2 className="size-4" />
              </IconButton>
            </div>
          )
        })}
      </div>
      {model.rows.length > 1 ? (
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">{t('forms.studio.logic.visibility.combineLabel')}</span>
          <label className="flex items-center gap-1 text-xs">
            <input
              type="radio"
              name="condition-combine"
              checked={model.combine === 'and'}
              onChange={() => commit({ ...model, combine: 'and' })}
            />
            {t('forms.studio.logic.visibility.combine.and')}
          </label>
          <label className="flex items-center gap-1 text-xs">
            <input
              type="radio"
              name="condition-combine"
              checked={model.combine === 'or'}
              onChange={() => commit({ ...model, combine: 'or' })}
            />
            {t('forms.studio.logic.visibility.combine.or')}
          </label>
        </div>
      ) : null}
      {model.rows.length > 0 ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs font-medium uppercase text-muted-foreground">
            {t('forms.studio.logic.visibility.compiledJson')}
          </summary>
          <pre className="mt-1 max-h-40 overflow-auto rounded-md border border-border bg-muted/40 p-2 text-xs">
            {JSON.stringify(compilePredicate(model), null, 2)}
          </pre>
        </details>
      ) : null}
    </div>
  )
}

/** Convenience builder of source options from a `FormSchema`. */
export function buildFieldSourceOptions(schema: FormSchema, currentLocale: string, t: ReturnType<typeof useT>): ConditionSourceOption[] {
  const result: ConditionSourceOption[] = []
  for (const [key, node] of Object.entries(schema.properties)) {
    const omType = String((node as Record<string, unknown>)['x-om-type'] ?? '')
    if (omType === 'info_block') continue
    const labelMap = (node as Record<string, unknown>)['x-om-label']
    const label =
      labelMap && typeof labelMap === 'object' && !Array.isArray(labelMap)
        ? String((labelMap as Record<string, unknown>)[currentLocale] ?? (labelMap as Record<string, unknown>).en ?? key)
        : key
    const typeLabel = resolveTypeLabel(omType, t)
    result.push({ value: key, label: `${label} · ${typeLabel}`, fieldType: omType, namespace: 'field' })
  }
  return result
}
