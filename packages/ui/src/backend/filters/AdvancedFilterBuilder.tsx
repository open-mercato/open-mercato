"use client"
import * as React from 'react'
import { ChevronDown, Plus, Trash2, X } from 'lucide-react'
import { Button } from '../../primitives/button'
import { IconButton } from '../../primitives/icon-button'
import { Input } from '../../primitives/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../primitives/select'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type {
  AdvancedFilterState,
  FilterCondition,
  FilterFieldDef,
  FilterFieldType,
  FilterJoinOperator,
  FilterOperator,
} from '@open-mercato/shared/lib/query/advanced-filter'
import {
  OPERATORS_BY_FIELD_TYPE,
  getDefaultOperator,
  isValuelessOperator,
  createEmptyCondition,
  normalizeAdvancedFilterState,
} from '@open-mercato/shared/lib/query/advanced-filter'

export type AdvancedFilterBuilderProps = {
  fields: FilterFieldDef[]
  value: AdvancedFilterState
  onChange: (state: AdvancedFilterState) => void
  onApply: () => void
  onClear: () => void
}

const OPERATOR_LABELS: Record<FilterOperator, string> = {
  is: 'is',
  is_not: 'is not',
  contains: 'contains',
  does_not_contain: 'does not contain',
  starts_with: 'starts with',
  ends_with: 'ends with',
  is_empty: 'is empty',
  is_not_empty: 'is not empty',
  equals: 'equals',
  not_equals: 'not equals',
  greater_than: 'greater than',
  less_than: 'less than',
  greater_or_equal: 'greater or equal',
  less_or_equal: 'less or equal',
  between: 'between',
  is_before: 'is before',
  is_after: 'is after',
  is_any_of: 'is any of',
  is_none_of: 'is none of',
  is_true: 'is true',
  is_false: 'is false',
  has_any_of: 'has any of',
  has_all_of: 'has all of',
  has_none_of: 'has none of',
}

function getFieldType(fields: FilterFieldDef[], fieldKey: string): FilterFieldType {
  const field = fields.find((f) => f.key === fieldKey)
  return field?.type ?? 'text'
}

function ConditionRow({
  condition,
  index,
  fields,
  join,
  onUpdate,
  onRemove,
  onToggleJoin,
  t,
}: {
  condition: FilterCondition
  index: number
  fields: FilterFieldDef[]
  join: FilterJoinOperator
  onUpdate: (id: string, updates: Partial<FilterCondition>) => void
  onRemove: (id: string) => void
  onToggleJoin: (id: string) => void
  t: ReturnType<typeof useT>
}) {
  const fieldType = getFieldType(fields, condition.field)
  const operators = OPERATORS_BY_FIELD_TYPE[fieldType] ?? OPERATORS_BY_FIELD_TYPE.text
  const valueless = isValuelessOperator(condition.operator)

  const handleFieldChange = (newField: string) => {
    const newType = getFieldType(fields, newField)
    const newOp = getDefaultOperator(newType)
    onUpdate(condition.id, { field: newField, operator: newOp, value: '' })
  }

  const joinLabel = join === 'and'
    ? t('ui.advancedFilter.and', 'And')
    : t('ui.advancedFilter.or', 'Or')

  return (
    <div className="flex flex-wrap items-start gap-2">
      <div className="w-20 shrink-0 pt-0.5 text-sm text-muted-foreground">
        {index === 0 ? (
          <span>{t('ui.advancedFilter.where', 'Where')}</span>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 min-w-[5rem] justify-between px-3 text-sm font-medium"
            onClick={() => onToggleJoin(condition.id)}
            aria-label={t('ui.advancedFilter.toggleJoin', 'Toggle filter join operator')}
            title={t('ui.advancedFilter.toggleJoinHint', 'Click to switch between AND and OR')}
          >
            <span>{joinLabel}</span>
            <ChevronDown className="size-3.5 text-muted-foreground" />
          </Button>
        )}
      </div>

      <Select
        value={condition.field || undefined}
        onValueChange={(next) => handleFieldChange(next ?? '')}
      >
        <SelectTrigger
          className="min-w-[140px]"
          aria-label={t('ui.advancedFilter.selectField', 'Select field')}
        >
          <SelectValue placeholder={t('ui.advancedFilter.selectFieldPlaceholder', 'Select field...')} />
        </SelectTrigger>
        <SelectContent>
          {fields.map((f) => (
            <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={condition.operator}
        onValueChange={(next) => onUpdate(condition.id, { operator: next as FilterOperator, value: '' })}
      >
        <SelectTrigger
          className="min-w-[120px]"
          aria-label={t('ui.advancedFilter.selectOperator', 'Select operator')}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {operators.map((op) => (
            <SelectItem key={op} value={op}>
              {t(`ui.advancedFilter.operator.${op}`, OPERATOR_LABELS[op])}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {!valueless ? (
        <ValueInput
          condition={condition}
          fields={fields}
          fieldType={fieldType}
          onUpdate={onUpdate}
          t={t}
        />
      ) : null}

      <IconButton
        variant="ghost"
        size="sm"
        type="button"
        onClick={() => onRemove(condition.id)}
        aria-label={t('ui.advancedFilter.removeCondition', 'Remove condition')}
      >
        <Trash2 className="size-4 text-muted-foreground" />
      </IconButton>
    </div>
  )
}

function ValueInput({
  condition,
  fields,
  fieldType,
  onUpdate,
  t,
}: {
  condition: FilterCondition
  fields: FilterFieldDef[]
  fieldType: FilterFieldType
  onUpdate: (id: string, updates: Partial<FilterCondition>) => void
  t: ReturnType<typeof useT>
}) {
  const fieldDef = fields.find((f) => f.key === condition.field)
  const value = condition.value

  if (fieldType === 'select' && fieldDef?.options) {
    return (
      <Select
        value={typeof value === 'string' && value ? value : undefined}
        onValueChange={(next) => onUpdate(condition.id, { value: next ?? '' })}
      >
        <SelectTrigger
          className="min-w-[140px]"
          aria-label={t('ui.advancedFilter.selectValue', 'Select value')}
        >
          <SelectValue placeholder={t('ui.advancedFilter.selectValuePlaceholder', 'Select...')} />
        </SelectTrigger>
        <SelectContent>
          {fieldDef.options.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }

  if (fieldType === 'date') {
    return (
      <input
        type="date"
        className="rounded border bg-background px-2 py-1.5 text-sm"
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onUpdate(condition.id, { value: e.target.value })}
        aria-label={t('ui.advancedFilter.dateValue', 'Date value')}
      />
    )
  }

  if (fieldType === 'number') {
    return (
      <Input
        type="number"
        size="sm"
        className="w-[120px]"
        value={typeof value === 'number' ? value : typeof value === 'string' ? value : ''}
        onChange={(e) => onUpdate(condition.id, { value: e.target.value })}
        placeholder={t('ui.advancedFilter.numberPlaceholder', 'Value')}
        aria-label={t('ui.advancedFilter.numberValue', 'Number value')}
      />
    )
  }

  return (
    <Input
      type="text"
      size="sm"
      className="min-w-[140px]"
      value={typeof value === 'string' ? value : ''}
      onChange={(e) => onUpdate(condition.id, { value: e.target.value })}
      placeholder={t('ui.advancedFilter.textPlaceholder', 'Value...')}
      aria-label={t('ui.advancedFilter.textValue', 'Text value')}
    />
  )
}

export function AdvancedFilterBuilder({
  fields,
  value,
  onChange,
  onApply,
  onClear,
}: AdvancedFilterBuilderProps) {
  const t = useT()
  const normalizedValue = React.useMemo(() => normalizeAdvancedFilterState(value), [value])
  const emitChange = React.useCallback((next: AdvancedFilterState) => {
    onChange(normalizeAdvancedFilterState(next))
  }, [onChange])

  const updateCondition = React.useCallback((id: string, updates: Partial<FilterCondition>) => {
    emitChange({
      ...normalizedValue,
      conditions: normalizedValue.conditions.map((c) => (c.id === id ? { ...c, ...updates } : c)),
    })
  }, [emitChange, normalizedValue])

  const removeCondition = React.useCallback((id: string) => {
    emitChange({
      ...normalizedValue,
      conditions: normalizedValue.conditions.filter((c) => c.id !== id),
    })
  }, [emitChange, normalizedValue])

  const addCondition = React.useCallback(() => {
    const newCondition = createEmptyCondition()
    if (fields.length > 0) {
      newCondition.field = fields[0].key
      newCondition.operator = getDefaultOperator(fields[0].type)
    }
    emitChange({
      ...normalizedValue,
      conditions: [...normalizedValue.conditions, newCondition],
    })
  }, [emitChange, fields, normalizedValue])

  const toggleConditionJoin = React.useCallback((id: string) => {
    emitChange({
      ...normalizedValue,
      conditions: normalizedValue.conditions.map((condition) => (
        condition.id === id
          ? { ...condition, join: condition.join === 'or' ? 'and' : 'or' }
          : condition
      )),
    })
  }, [emitChange, normalizedValue])

  return (
    <div className="inline-flex flex-col gap-3 p-3">
      {normalizedValue.conditions.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t('ui.advancedFilter.noConditions', 'No filter conditions. Click "Add filter" to start.')}
        </p>
      ) : (
        <div className="space-y-2">
          {normalizedValue.conditions.map((condition, index) => (
            <ConditionRow
              key={condition.id}
              condition={condition}
              index={index}
              fields={fields}
              join={condition.join ?? normalizedValue.logic}
              onUpdate={updateCondition}
              onRemove={removeCondition}
              onToggleJoin={toggleConditionJoin}
              t={t}
            />
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 pt-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-auto px-0 py-0 text-base font-medium text-primary hover:bg-transparent hover:text-primary/90"
          onClick={addCondition}
        >
          <Plus className="size-4" />
          {t('ui.advancedFilter.addFilter', 'Add filter')}
        </Button>
        {normalizedValue.conditions.length > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-auto px-0 py-0 text-base text-muted-foreground hover:bg-transparent hover:text-foreground"
            onClick={onClear}
          >
            <X className="size-4" />
            {t('ui.advancedFilter.clear', 'Clear')}
          </Button>
        ) : null}
        {normalizedValue.conditions.length > 0 ? (
          <Button type="button" className="ml-auto min-w-[8rem]" onClick={onApply}>
            {t('ui.advancedFilter.apply', 'Apply')}
          </Button>
        ) : null}
      </div>
    </div>
  )
}
