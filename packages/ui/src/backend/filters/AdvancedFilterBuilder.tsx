"use client"
import * as React from 'react'
import { Plus, Trash2, X } from 'lucide-react'
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
  FilterFieldDef,
  FilterFieldType,
  FilterOperator,
} from '@open-mercato/shared/lib/query/advanced-filter'
import {
  OPERATORS_BY_FIELD_TYPE,
  getDefaultOperator,
  isValuelessOperator,
} from '@open-mercato/shared/lib/query/advanced-filter'
import {
  type AdvancedFilterTree,
  type FilterRule,
  type FilterGroup,
  type FilterCombinator,
  TREE_LIMITS,
} from '@open-mercato/shared/lib/query/advanced-filter-tree'
import { treeReducer, canAddRule, canAddGroup, type TreeAction } from './treeReducer'

export type AdvancedFilterBuilderProps = {
  fields: FilterFieldDef[]
  value: AdvancedFilterTree
  onChange: (state: AdvancedFilterTree) => void
  onApply: () => void
  onClear: () => void
}

const OPERATOR_LABELS: Record<FilterOperator, string> = {
  is: 'is', is_not: 'is not', contains: 'contains', does_not_contain: 'does not contain',
  starts_with: 'starts with', ends_with: 'ends with', is_empty: 'is empty', is_not_empty: 'is not empty',
  equals: 'equals', not_equals: 'not equals', greater_than: 'greater than', less_than: 'less than',
  greater_or_equal: 'greater or equal', less_or_equal: 'less or equal', between: 'between',
  is_before: 'is before', is_after: 'is after', is_any_of: 'is any of', is_none_of: 'is none of',
  is_true: 'is true', is_false: 'is false', has_any_of: 'has any of', has_all_of: 'has all of', has_none_of: 'has none of',
}

function getFieldType(fields: FilterFieldDef[], fieldKey: string): FilterFieldType {
  return fields.find((f) => f.key === fieldKey)?.type ?? 'text'
}

export function AdvancedFilterBuilder({
  fields, value, onChange, onApply, onClear,
}: AdvancedFilterBuilderProps) {
  const t = useT()

  const dispatch = React.useCallback((action: TreeAction) => {
    onChange(treeReducer(value, action))
  }, [onChange, value])

  // Cmd/Ctrl+Enter to apply (matches AGENTS.md UI conventions)
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        onApply()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onApply])

  const empty = value.root.children.length === 0
  const defaultField = fields.length > 0 ? fields[0].key : undefined

  return (
    <div className="inline-flex flex-col gap-3 p-3 min-w-[640px]">
      {empty ? (
        <p className="text-sm text-muted-foreground">
          {t('ui.advancedFilter.noConditions', 'No filter conditions. Click "Add filter" to start.')}
        </p>
      ) : (
        <GroupView
          group={value.root}
          level={1}
          fields={fields}
          tree={value}
          dispatch={dispatch}
          defaultField={defaultField}
          t={t}
        />
      )}

      <div className="flex items-center gap-3 pt-2 border-t">
        {empty ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-auto px-0 py-0 text-base font-medium text-primary hover:bg-transparent hover:text-primary/90"
            onClick={() => dispatch({ type: 'addRule', groupId: value.root.id, defaultField })}
          >
            <Plus className="size-4" />
            {t('ui.advancedFilter.addFilter', 'Add filter')}
          </Button>
        ) : null}
        {!empty ? (
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
        {!empty ? (
          <Button type="button" className="ml-auto min-w-[8rem]" onClick={onApply}>
            {t('ui.advancedFilter.apply', 'Apply')}
          </Button>
        ) : null}
      </div>
    </div>
  )
}

function GroupView({
  group, level, fields, tree, dispatch, defaultField, t,
}: {
  group: FilterGroup
  level: number
  fields: FilterFieldDef[]
  tree: AdvancedFilterTree
  dispatch: (a: TreeAction) => void
  defaultField?: string
  t: ReturnType<typeof useT>
}) {
  const isRoot = level === 1
  const containerClass = isRoot
    ? 'space-y-2'
    : 'space-y-2 ml-3 pl-3 border-l-2 border-primary/30 rounded-l py-2'

  const widthCapHit = group.children.length >= TREE_LIMITS.maxChildrenPerGroup
  const depthCapHit = level >= TREE_LIMITS.maxGroupLevel

  return (
    <div className={containerClass}>
      {group.children.length > 1 || !isRoot ? (
        <div className={`flex items-center gap-2 ${isRoot ? 'mb-1' : '-ml-3 -mt-1 mb-1'}`}>
          <Select
            value={group.combinator}
            onValueChange={(v) => dispatch({ type: 'updateGroupCombinator', groupId: group.id, combinator: v as FilterCombinator })}
          >
            <SelectTrigger className="h-8 min-w-[120px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="and">{t('ui.advancedFilter.matchAll', 'Match all')}</SelectItem>
              <SelectItem value="or">{t('ui.advancedFilter.matchAny', 'Match any')}</SelectItem>
            </SelectContent>
          </Select>
          {!isRoot ? (
            <IconButton
              variant="ghost"
              size="sm"
              type="button"
              onClick={() => dispatch({ type: 'removeNode', nodeId: group.id })}
              aria-label={t('ui.advancedFilter.deleteGroup', 'Delete group')}
              title={t('ui.advancedFilter.deleteGroup', 'Delete group')}
            >
              <X className="size-4 text-muted-foreground" />
            </IconButton>
          ) : null}
        </div>
      ) : null}

      {group.children.map((child, idx) => (
        child.type === 'rule' ? (
          <RuleRow
            key={child.id}
            rule={child}
            index={idx}
            parent={group}
            fields={fields}
            dispatch={dispatch}
            t={t}
          />
        ) : (
          <GroupView
            key={child.id}
            group={child}
            level={level + 1}
            fields={fields}
            tree={tree}
            dispatch={dispatch}
            defaultField={defaultField}
            t={t}
          />
        )
      ))}

      <div className="flex items-center gap-2 pt-1">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!canAddRule(tree, group.id)}
          title={!canAddRule(tree, group.id)
            ? (widthCapHit
                ? t('ui.advancedFilter.limitWidthReached', 'Maximum {max} conditions per group', { max: TREE_LIMITS.maxChildrenPerGroup })
                : t('ui.advancedFilter.limitTotalReached', 'Maximum {max} conditions reached', { max: TREE_LIMITS.maxTotalRules }))
            : undefined}
          onClick={() => dispatch({ type: 'addRule', groupId: group.id, defaultField })}
        >
          <Plus className="size-4" />
          {t('ui.advancedFilter.addFilter', 'Add filter')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!canAddGroup(tree, group.id)}
          title={!canAddGroup(tree, group.id)
            ? (depthCapHit
                ? t('ui.advancedFilter.limitDepthReached', 'Maximum nesting depth reached')
                : widthCapHit
                  ? t('ui.advancedFilter.limitWidthReached', 'Maximum {max} conditions per group', { max: TREE_LIMITS.maxChildrenPerGroup })
                  : t('ui.advancedFilter.limitTotalReached', 'Maximum {max} conditions reached', { max: TREE_LIMITS.maxTotalRules }))
            : undefined}
          onClick={() => dispatch({ type: 'addGroup', groupId: group.id, defaultField })}
        >
          <Plus className="size-4" />
          {t('ui.advancedFilter.addGroup', 'Add group')}
        </Button>
      </div>
    </div>
  )
}

function RuleRow({
  rule, index, parent, fields, dispatch, t,
}: {
  rule: FilterRule
  index: number
  parent: FilterGroup
  fields: FilterFieldDef[]
  dispatch: (a: TreeAction) => void
  t: ReturnType<typeof useT>
}) {
  const fieldType = getFieldType(fields, rule.field)
  const operators = OPERATORS_BY_FIELD_TYPE[fieldType] ?? OPERATORS_BY_FIELD_TYPE.text
  const valueless = isValuelessOperator(rule.operator)

  const connectorLabel = index === 0
    ? t('ui.advancedFilter.where', 'Where')
    : (parent.combinator === 'and' ? t('ui.advancedFilter.and', 'And') : t('ui.advancedFilter.or', 'Or'))

  return (
    <div className="flex flex-wrap items-start gap-2">
      <div className="w-16 shrink-0 pt-1.5 text-sm text-muted-foreground">
        {connectorLabel}
      </div>
      <Select
        value={rule.field || undefined}
        onValueChange={(next) => {
          const nextType = getFieldType(fields, next ?? '')
          dispatch({
            type: 'updateRule',
            ruleId: rule.id,
            updates: { field: next ?? '', operator: getDefaultOperator(nextType), value: '' },
          })
        }}
      >
        <SelectTrigger className="min-w-[140px]" aria-label={t('ui.advancedFilter.selectField', 'Select field')}>
          <SelectValue placeholder={t('ui.advancedFilter.selectFieldPlaceholder', 'Select field...')} />
        </SelectTrigger>
        <SelectContent>
          {fields.map((f) => (
            <SelectItem key={f.key} value={f.key}>{f.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={rule.operator}
        onValueChange={(next) => dispatch({ type: 'updateRule', ruleId: rule.id, updates: { operator: next as FilterOperator, value: '' } })}
      >
        <SelectTrigger className="min-w-[140px]" aria-label={t('ui.advancedFilter.selectOperator', 'Select operator')}>
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
        <ValueInput rule={rule} fields={fields} fieldType={fieldType} dispatch={dispatch} t={t} />
      ) : null}
      <IconButton
        variant="ghost"
        size="sm"
        type="button"
        onClick={() => dispatch({ type: 'removeNode', nodeId: rule.id })}
        aria-label={t('ui.advancedFilter.removeCondition', 'Remove condition')}
        title={t('ui.advancedFilter.removeCondition', 'Remove condition')}
      >
        <Trash2 className="size-4 text-muted-foreground" />
      </IconButton>
    </div>
  )
}

function ValueInput({
  rule, fields, fieldType, dispatch, t,
}: {
  rule: FilterRule
  fields: FilterFieldDef[]
  fieldType: FilterFieldType
  dispatch: (a: TreeAction) => void
  t: ReturnType<typeof useT>
}) {
  const fieldDef = fields.find((f) => f.key === rule.field)
  const value = rule.value

  if (fieldType === 'select' && fieldDef?.options) {
    return (
      <Select
        value={typeof value === 'string' && value.length ? value : undefined}
        onValueChange={(next) => dispatch({ type: 'updateRule', ruleId: rule.id, updates: { value: next ?? '' } })}
      >
        <SelectTrigger className="min-w-[160px]" aria-label={t('ui.advancedFilter.selectValue', 'Select value')}>
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
      <Input
        type="date"
        className="min-w-[160px]"
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => dispatch({ type: 'updateRule', ruleId: rule.id, updates: { value: e.target.value } })}
        aria-label={t('ui.advancedFilter.dateValue', 'Date value')}
      />
    )
  }

  if (fieldType === 'number') {
    return (
      <Input
        type="number"
        className="w-[120px]"
        value={typeof value === 'number' ? value : typeof value === 'string' ? value : ''}
        onChange={(e) => dispatch({ type: 'updateRule', ruleId: rule.id, updates: { value: e.target.value } })}
        placeholder={t('ui.advancedFilter.numberPlaceholder', 'Value')}
        aria-label={t('ui.advancedFilter.numberValue', 'Number value')}
      />
    )
  }

  return (
    <Input
      type="text"
      className="min-w-[160px]"
      value={typeof value === 'string' ? value : ''}
      onChange={(e) => dispatch({ type: 'updateRule', ruleId: rule.id, updates: { value: e.target.value } })}
      placeholder={t('ui.advancedFilter.textPlaceholder', 'Value...')}
      aria-label={t('ui.advancedFilter.textValue', 'Text value')}
    />
  )
}
