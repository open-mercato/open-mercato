'use client'
import * as React from 'react'
import { createPortal } from 'react-dom'
import { Plus, Trash2, X, GripVertical, ChevronDown } from 'lucide-react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
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
import { Popover, PopoverContent, PopoverTrigger } from '../../primitives/popover'
import { Checkbox } from '../../primitives/checkbox'
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
import { FilterFieldPicker } from './FilterFieldPicker'

export type AdvancedFilterBuilderProps = {
  fields: FilterFieldDef[]
  value: AdvancedFilterTree
  onChange: (state: AdvancedFilterTree) => void
  onApply: () => void
  onClear: () => void
  pendingErrors?: Array<{ ruleId: string; messageKey: string; message: string }>
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

// Operator value shapes. Used to decide whether changing operator preserves the
// current value: same shape preserves (`is` → `is not` keeps "Active"); different
// shape resets (`is` → `between` clears, because value goes from scalar to pair).
type OperatorShape = 'valueless' | 'multi' | 'range' | 'single'

const MULTI_VALUE_OPS = new Set<FilterOperator>([
  'is_any_of', 'is_none_of', 'has_any_of', 'has_all_of', 'has_none_of',
])

function getOperatorShape(op: FilterOperator): OperatorShape {
  if (isValuelessOperator(op)) return 'valueless'
  if (MULTI_VALUE_OPS.has(op)) return 'multi'
  if (op === 'between') return 'range'
  return 'single'
}

type DragHandleProps = React.HTMLAttributes<HTMLButtonElement> & {
  ref?: React.Ref<HTMLButtonElement>
}

type Translator = ReturnType<typeof useT>

export function AdvancedFilterBuilder({
  fields, value, onChange, onApply, onClear, pendingErrors,
}: AdvancedFilterBuilderProps) {
  const t = useT()

  const dispatch = React.useCallback((action: TreeAction) => {
    onChange(treeReducer(value, action))
  }, [onChange, value])

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

  const errorByRuleId = React.useMemo(() => {
    const m = new Map<string, string>()
    for (const e of pendingErrors ?? []) m.set(e.ruleId, t(e.messageKey, e.message))
    return m
  }, [pendingErrors, t])

  const empty = value.root.children.length === 0
  const defaultField = fields.length > 0 ? fields[0].key : undefined

  // Per-group SortableContexts scope drag-and-drop to within-group ordering.
  // The DragOverlay below renders a stable preview that
  // matches the original row's footprint — without it, dnd-kit applies
  // `transform` to the source row in place, which the wrapping flex layout
  // distorted into a "tall" / morphed ghost.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const [activeDrag, setActiveDrag] = React.useState<{ node: FilterRule | FilterGroup; parent: FilterGroup } | null>(null)
  const findNode = React.useCallback((id: string) => locateInTree(value.root, id), [value])

  const handleDragStart = React.useCallback((e: DragStartEvent) => {
    const found = findNode(String(e.active.id))
    if (found) setActiveDrag(found)
  }, [findNode])

  const handleDragEnd = React.useCallback((e: DragEndEvent) => {
    setActiveDrag(null)
    const { active, over } = e
    if (!over || active.id === over.id) return
    const from = findNode(String(active.id))
    const to = findNode(String(over.id))
    if (!from || !to) return
    if (from.parent.id !== to.parent.id) return
    const fromIdx = from.parent.children.findIndex((c) => c.id === active.id)
    const toIdx = to.parent.children.findIndex((c) => c.id === over.id)
    if (fromIdx < 0 || toIdx < 0) return
    dispatch({ type: 'reorderChildren', groupId: from.parent.id, fromIdx, toIdx })
  }, [dispatch, findNode])

  const handleDragCancel = React.useCallback(() => setActiveDrag(null), [])

  // Wrapper has no `min-w-[640px]`: it forced horizontal scroll on a 375px viewport.
  // Rules wrap onto multiple lines on mobile; on desktop (`sm:max-w-[720px]`) they fit
  // on one line.
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="flex flex-col gap-3 p-3">
        {!empty ? (
          <GroupView
            group={value.root}
            level={1}
            fields={fields}
            tree={value}
            dispatch={dispatch}
            defaultField={defaultField}
            errorByRuleId={errorByRuleId}
            t={t}
          />
        ) : null}
        {!empty ? (
          <div className="flex items-center gap-3 pt-2 border-t border-border">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-auto px-0 py-0 text-base text-muted-foreground hover:bg-transparent hover:text-foreground"
              onClick={onClear}
            >
              <X className="size-4" />
              {t('ui.advancedFilter.clearAll', 'Clear all')}
            </Button>
          </div>
        ) : null}
      </div>
      {/* Portal DragOverlay to document.body. Radix DialogContent uses CSS `transform`
          for centering, which becomes the containing block for `position: fixed`
          descendants (dnd-kit's overlay) and shifts the ghost off-screen. Portaling
          restores viewport-relative coordinates. */}
      {typeof document !== 'undefined'
        ? createPortal(
            // dnd-kit's DragOverlay sets its own inline z-index, so a Tailwind
            // utility class would be overridden — read the DS token via CSS var.
            <DragOverlay dropAnimation={null} style={{ zIndex: 'var(--z-index-modal-elevated, 55)' }}>
              {activeDrag ? (
                <DragGhost node={activeDrag.node} parent={activeDrag.parent} fields={fields} t={t} />
              ) : null}
            </DragOverlay>,
            document.body,
          )
        : null}
    </DndContext>
  )
}

/** Find a node in the tree along with its parent group. Used by drag handlers. */
function locateInTree(root: FilterGroup, id: string): { node: FilterRule | FilterGroup; parent: FilterGroup } | null {
  for (const child of root.children) {
    if (child.id === id) return { node: child, parent: root }
    if (child.type === 'group') {
      const found = locateInTree(child, id)
      if (found) return found
    }
  }
  return null
}

// Compact drag preview rendered inside DragOverlay. Cannot reuse RuleRow/GroupView —
// their popovers and form inputs conflict with the overlay.
function DragGhost({
  node, parent, fields, t,
}: {
  node: FilterRule | FilterGroup
  parent: FilterGroup
  fields: FilterFieldDef[]
  t: Translator
}) {
  const isGroup = node.type === 'group'
  const labelParts: string[] = []
  if (isGroup) {
    const ruleCount = countRulesIn(node)
    labelParts.push(t('ui.advancedFilter.dragGhost.group', 'Group'))
    labelParts.push(`(${ruleCount})`)
  } else {
    const def = fields.find((f) => f.key === node.field)
    labelParts.push(def?.label ?? (node.field || t('ui.advancedFilter.dragGhost.unsetField', 'Unset field')))
    labelParts.push(OPERATOR_LABELS[node.operator] ?? node.operator)
    if (typeof node.value === 'string' && node.value) labelParts.push(`"${node.value}"`)
  }
  return (
    <div className="inline-flex items-center gap-2 rounded-md border border-border bg-popover px-3 py-1.5 text-sm shadow-md cursor-grabbing">
      <GripVertical className="size-4 text-muted-foreground" />
      <span className="text-muted-foreground">{parent.combinator === 'and' ? t('ui.advancedFilter.connector.and', 'and') : t('ui.advancedFilter.connector.or', 'or')}</span>
      <span className="font-medium">{labelParts.join(' ')}</span>
    </div>
  )
}

function countRulesIn(group: FilterGroup): number {
  let n = 0
  for (const c of group.children) {
    if (c.type === 'rule') n += 1
    else n += countRulesIn(c)
  }
  return n
}

function GroupView({
  group, level, fields, tree, dispatch, defaultField, errorByRuleId, t,
}: {
  group: FilterGroup
  level: number
  fields: FilterFieldDef[]
  tree: AdvancedFilterTree
  dispatch: (a: TreeAction) => void
  defaultField?: string
  errorByRuleId: Map<string, string>
  t: Translator
}) {
  const isRoot = level === 1
  // Sub-groups render as a card so the nesting boundary is visible; root group stays
  // flush with the popover so it doesn't double-up the dialog's own card chrome.
  const containerClass = isRoot
    ? 'space-y-3'
    : 'space-y-3 rounded-lg border border-border bg-muted/30 p-3'

  // Toolbar-first layout (Kendo React Filter pattern): one [And]/[Or] toggle per group
  // is the only combinator UI. Mixing AND with OR requires `+ Add subgroup`. Matches
  // `CompositeFilterDescriptor` semantics (one logic per group).
  return (
    <div className={containerClass}>
      <GroupToolbar
        group={group}
        level={level}
        tree={tree}
        dispatch={dispatch}
        defaultField={defaultField}
        fields={fields}
        isRoot={isRoot}
        t={t}
      />

      <SortableChildrenList
        group={group}
        level={level}
        fields={fields}
        tree={tree}
        dispatch={dispatch}
        defaultField={defaultField}
        errorByRuleId={errorByRuleId}
        t={t}
      />
    </div>
  )
}

// Kendo-style segmented `[And] [Or]` toggle. Clicking the unselected side flips
// the group's combinator. Selected side is brand-violet filled so the affordance
// is unambiguous.
function AndOrToggle({
  combinator, onChange, t,
}: {
  combinator: FilterCombinator
  onChange: (c: FilterCombinator) => void
  t: Translator
}) {
  const andLabel = t('ui.advancedFilter.combinator.and', 'And')
  const orLabel = t('ui.advancedFilter.combinator.or', 'Or')
  const baseBtn = 'h-8 px-3 text-sm font-medium outline-none focus-visible:shadow-focus disabled:cursor-not-allowed'
  const selBtn = 'bg-brand-violet text-white hover:bg-brand-violet/90'
  const unselBtn = 'bg-background text-foreground hover:bg-accent'
  return (
    <div
      role="group"
      aria-label={t('ui.advancedFilter.combinator.label', 'Group combinator')}
      className="inline-flex rounded-md border border-input overflow-hidden shrink-0"
      data-testid="advanced-filter-combinator-toggle"
      data-combinator={combinator}
    >
      <button
        type="button"
        aria-pressed={combinator === 'and'}
        onClick={() => combinator !== 'and' && onChange('and')}
        className={`${baseBtn} ${combinator === 'and' ? selBtn : unselBtn}`}
      >
        {andLabel}
      </button>
      <button
        type="button"
        aria-pressed={combinator === 'or'}
        onClick={() => combinator !== 'or' && onChange('or')}
        className={`${baseBtn} border-l border-input ${combinator === 'or' ? selBtn : unselBtn}`}
      >
        {orLabel}
      </button>
    </div>
  )
}

function SortableChildrenList({
  group, level, fields, tree, dispatch, defaultField, errorByRuleId, t,
}: {
  group: FilterGroup
  level: number
  fields: FilterFieldDef[]
  tree: AdvancedFilterTree
  dispatch: (a: TreeAction) => void
  defaultField?: string
  errorByRuleId: Map<string, string>
  t: Translator
}) {
  // DndContext + handlers live one level up so a drag can move children across
  // groups. Each group owns its own SortableContext to scope sort ordering.
  return (
    <SortableContext items={group.children.map((c) => c.id)} strategy={verticalListSortingStrategy}>
      {group.children.map((child, idx) => (
        <SortableRow
          key={child.id}
          child={child}
          idx={idx}
          parent={group}
          level={level}
          fields={fields}
          tree={tree}
          dispatch={dispatch}
          defaultField={defaultField}
          errorByRuleId={errorByRuleId}
          t={t}
        />
      ))}
    </SortableContext>
  )
}

function SortableRow({
  child, idx, parent, level, fields, tree, dispatch, defaultField, errorByRuleId, t,
}: {
  child: FilterRule | FilterGroup
  idx: number
  parent: FilterGroup
  level: number
  fields: FilterFieldDef[]
  tree: AdvancedFilterTree
  dispatch: (a: TreeAction) => void
  defaultField?: string
  errorByRuleId: Map<string, string>
  t: Translator
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: child.id,
  })
  // Hide the source while dragging (DragOverlay renders the snapshot); keep it in
  // layout via `visibility: hidden` so siblings don't jump. Without this, the flex
  // wrapper applies both `transform` and its own resizing to the source row.
  const style: React.CSSProperties = isDragging
    ? { visibility: 'hidden' as const }
    : { transform: CSS.Transform.toString(transform), transition }
  const dragHandleProps: DragHandleProps = { ...attributes, ...listeners }

  return (
    <div ref={setNodeRef} style={style} data-testid="filter-rule-row" data-filter-node-id={child.id}>
      {child.type === 'rule' ? (
        <RuleRow
          rule={child}
          fields={fields}
          dispatch={dispatch}
          errorByRuleId={errorByRuleId}
          dragHandleProps={dragHandleProps}
          t={t}
        />
      ) : (
        <div className="flex items-start gap-2">
          {/* Raw <button> required: dnd-kit spreads `attributes`+`listeners` onto the
              activator; <Button>'s own props/ref handling breaks the keyboard sensor. */}
          <button
            type="button"
            {...dragHandleProps}
            data-testid="filter-drag-handle"
            className="mt-1 text-muted-foreground/60 hover:text-muted-foreground cursor-grab outline-none focus-visible:shadow-focus rounded-sm"
            aria-label={t('ui.advancedFilter.dragHandle', 'Drag to reorder')}
          >
            <GripVertical className="size-4" />
          </button>
          <div className="flex-1">
            <GroupView
              group={child}
              level={level + 1}
              fields={fields}
              tree={tree}
              dispatch={dispatch}
              defaultField={defaultField}
              errorByRuleId={errorByRuleId}
              t={t}
            />
          </div>
        </div>
      )}
    </div>
  )
}

function RuleRow({
  rule, fields, dispatch, errorByRuleId, dragHandleProps, t,
}: {
  rule: FilterRule
  fields: FilterFieldDef[]
  dispatch: (a: TreeAction) => void
  errorByRuleId: Map<string, string>
  dragHandleProps: DragHandleProps
  t: Translator
}) {
  const fieldType = getFieldType(fields, rule.field)
  const operators = OPERATORS_BY_FIELD_TYPE[fieldType] ?? OPERATORS_BY_FIELD_TYPE.text
  const valueless = isValuelessOperator(rule.operator)
  const errorMsg = errorByRuleId.get(rule.id)
  const fieldDef = fields.find((f) => f.key === rule.field)
  const [pickerOpen, setPickerOpen] = React.useState(false)
  const fieldBtnRef = React.useRef<HTMLButtonElement>(null)

  return (
    <div className="flex flex-col gap-1" data-testid="filter-rule" data-filter-rule-id={rule.id}>
      <div className="flex flex-wrap items-start gap-2">
        {/* Raw <button> required for dnd-kit activator: see SortableRow drag-handle comment. */}
        <button
          type="button"
          {...dragHandleProps}
          data-testid="filter-drag-handle"
          className="mt-1 text-muted-foreground/60 hover:text-muted-foreground cursor-grab outline-none focus-visible:shadow-focus rounded-sm"
          aria-label={t('ui.advancedFilter.dragHandle', 'Drag to reorder')}
        >
          <GripVertical className="size-4" />
        </button>
        <Button
          ref={fieldBtnRef}
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setPickerOpen(true)}
          className="min-w-[140px] justify-start"
        >
          {fieldDef?.label ?? t('ui.advancedFilter.selectField', 'Select field')}
        </Button>
        <FilterFieldPicker
          fields={fields}
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          onSelect={(f) => {
            const nextType = getFieldType(fields, f.key)
            dispatch({
              type: 'updateRule',
              ruleId: rule.id,
              updates: { field: f.key, operator: getDefaultOperator(nextType), value: '' },
            })
          }}
          triggerRef={fieldBtnRef as React.RefObject<HTMLElement | null>}
        />
        <Select
          value={rule.operator}
          onValueChange={(next) => {
            // Preserve the value when the operator shape doesn't change; reset
            // only when shape changes (e.g. `is` → `between` clears scalar to pair).
            const nextOp = next as FilterOperator
            const sameShape = getOperatorShape(rule.operator) === getOperatorShape(nextOp)
            const updates: Partial<Pick<FilterRule, 'operator' | 'value'>> = sameShape
              ? { operator: nextOp }
              : { operator: nextOp, value: getOperatorShape(nextOp) === 'multi' || getOperatorShape(nextOp) === 'range' ? [] : '' }
            dispatch({ type: 'updateRule', ruleId: rule.id, updates })
          }}
        >
          {/* `w-auto` overrides SelectTrigger's default `w-full` so it sits
              inline with the field/value inputs instead of breaking onto a new row. */}
          <SelectTrigger
            size="sm"
            className="w-auto min-w-[140px]"
            aria-label={t('ui.advancedFilter.selectOperator', 'Select operator')}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent data-advanced-filter-portal="">
            {operators.map((op) => (
              <SelectItem key={op} value={op}>
                {t(`ui.advancedFilter.operator.${op}`, OPERATOR_LABELS[op])}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!valueless ? (
          <ValueInput
            rule={rule}
            fields={fields}
            fieldType={fieldType}
            dispatch={dispatch}
            hasError={!!errorMsg}
            t={t}
          />
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
      {errorMsg ? (
        <div className="ml-6 pl-12 text-xs text-status-error-text">{errorMsg}</div>
      ) : null}
    </div>
  )
}

function ValueInput({
  rule, fields, fieldType, dispatch, hasError, t,
}: {
  rule: FilterRule
  fields: FilterFieldDef[]
  fieldType: FilterFieldType
  dispatch: (a: TreeAction) => void
  hasError: boolean
  t: Translator
}) {
  const fieldDef = fields.find((f) => f.key === rule.field)
  const value = rule.value
  const errorClass = hasError
    ? 'border-status-error-border ring-1 ring-status-error-border focus-visible:border-status-error-border focus-within:border-status-error-border'
    : ''

  if (fieldType === 'select' && fieldDef?.options) {
    // Multi-value operators (`is_any_of`, `is_none_of`, `has_any_of`, etc.)
    // need an array value with multiple selectable options. Radix `Select` is
    // single-select only, so the previous code silently overwrote each
    // selection (and validation kept failing because the value never became an
    // array). Render a checkbox-list popover when the operator is multi-shape.
    if (getOperatorShape(rule.operator) === 'multi') {
      return (
        <MultiValuePicker
          rule={rule}
          options={fieldDef.options}
          dispatch={dispatch}
          errorClass={errorClass}
          t={t}
        />
      )
    }
    return (
      <Select
        value={typeof value === 'string' && value.length ? value : undefined}
        onValueChange={(next) =>
          dispatch({ type: 'updateRule', ruleId: rule.id, updates: { value: next ?? '' } })
        }
      >
        <SelectTrigger
          size="sm"
          className={`w-auto min-w-[160px] ${errorClass}`}
          aria-label={t('ui.advancedFilter.selectValue', 'Select value')}
        >
          <SelectValue placeholder={t('ui.advancedFilter.selectValuePlaceholder', 'Select...')} />
        </SelectTrigger>
        <SelectContent data-advanced-filter-portal="">
          {fieldDef.options.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.tone ? (
                <span className="inline-flex items-center gap-2">
                  <span className={toneDotClass(opt.tone)} aria-hidden="true" />
                  {opt.label}
                </span>
              ) : (
                opt.label
              )}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }

  // `Input` ships `w-full` by default — use `w-auto` so inputs don't stretch
  // inside the wrapping flex row. `between` needs a `[start, end]` pair, so it
  // gets its own component below.
  if (rule.operator === 'between' && (fieldType === 'number' || fieldType === 'date')) {
    return (
      <BetweenInput
        rule={rule}
        fieldType={fieldType}
        dispatch={dispatch}
        errorClass={errorClass}
        t={t}
      />
    )
  }

  if (fieldType === 'date') {
    return (
      <Input
        type="date"
        size="sm"
        className={`w-auto min-w-[160px] ${errorClass}`}
        value={typeof value === 'string' ? value : ''}
        onChange={(e) =>
          dispatch({ type: 'updateRule', ruleId: rule.id, updates: { value: e.target.value } })
        }
        aria-label={t('ui.advancedFilter.dateValue', 'Date value')}
      />
    )
  }

  if (fieldType === 'number') {
    return (
      <Input
        type="number"
        size="sm"
        className={`w-[120px] ${errorClass}`}
        value={typeof value === 'number' ? value : typeof value === 'string' ? value : ''}
        onChange={(e) =>
          dispatch({ type: 'updateRule', ruleId: rule.id, updates: { value: e.target.value } })
        }
        placeholder={t('ui.advancedFilter.numberPlaceholder', 'Value')}
        aria-label={t('ui.advancedFilter.numberValue', 'Number value')}
      />
    )
  }

  return (
    <Input
      type="text"
      size="sm"
      className={`w-auto min-w-[160px] ${errorClass}`}
      value={typeof value === 'string' ? value : ''}
      onChange={(e) =>
        dispatch({ type: 'updateRule', ruleId: rule.id, updates: { value: e.target.value } })
      }
      placeholder={t('ui.advancedFilter.textPlaceholder', 'Value...')}
      aria-label={t('ui.advancedFilter.textValue', 'Text value')}
    />
  )
}

/**
 * Two inputs (start / end) for the `between` operator on date and number
 * fields. Stores the value as `[start, end]`; either side can be empty while
 * the user types, but validation requires both to be set before apply.
 */
function BetweenInput({
  rule, fieldType, dispatch, errorClass, t,
}: {
  rule: FilterRule
  fieldType: FilterFieldType
  dispatch: (a: TreeAction) => void
  errorClass: string
  t: Translator
}) {
  const pair = Array.isArray(rule.value) ? rule.value : []
  const start = typeof pair[0] === 'string' || typeof pair[0] === 'number' ? String(pair[0] ?? '') : ''
  const end = typeof pair[1] === 'string' || typeof pair[1] === 'number' ? String(pair[1] ?? '') : ''
  const update = (which: 'start' | 'end', next: string) => {
    const value = which === 'start' ? [next, end] : [start, next]
    dispatch({ type: 'updateRule', ruleId: rule.id, updates: { value } })
  }
  const inputType = fieldType === 'date' ? 'date' : 'number'
  const inputWidth = fieldType === 'date' ? 'w-auto min-w-[140px]' : 'w-[110px]'
  return (
    <div className="inline-flex items-center gap-1">
      <Input
        type={inputType}
        size="sm"
        className={`${inputWidth} ${errorClass}`}
        value={start}
        onChange={(e) => update('start', e.target.value)}
        placeholder={fieldType === 'number' ? t('ui.advancedFilter.numberPlaceholder', 'Value') : undefined}
        aria-label={t('ui.advancedFilter.betweenStart', 'Start')}
      />
      <span className="text-xs text-muted-foreground">{t('ui.advancedFilter.and', 'and')}</span>
      <Input
        type={inputType}
        size="sm"
        className={`${inputWidth} ${errorClass}`}
        value={end}
        onChange={(e) => update('end', e.target.value)}
        placeholder={fieldType === 'number' ? t('ui.advancedFilter.numberPlaceholder', 'Value') : undefined}
        aria-label={t('ui.advancedFilter.betweenEnd', 'End')}
      />
    </div>
  )
}

/**
 * Trigger + popover with a checkbox list. Used when a select-typed rule has a
 * multi-shape operator (`is_any_of`, `has_all_of`, etc.). The trigger displays
 * a "{first} +N" summary; the popover lets the user toggle each option.
 */
function MultiValuePicker({
  rule, options, dispatch, errorClass, t,
}: {
  rule: FilterRule
  options: NonNullable<FilterFieldDef['options']>
  dispatch: (a: TreeAction) => void
  errorClass: string
  t: Translator
}) {
  const selected: string[] = Array.isArray(rule.value)
    ? rule.value.map((v) => String(v)).filter((v) => v.length > 0)
    : []
  const selectedLabel = (() => {
    if (selected.length === 0) return t('ui.advancedFilter.selectValuePlaceholder', 'Select...')
    const firstOpt = options.find((o) => o.value === selected[0])
    const head = firstOpt?.label ?? selected[0]
    const more = selected.length - 1
    return more > 0 ? `${head} +${more}` : head
  })()
  const toggle = (val: string) => {
    const next = selected.includes(val) ? selected.filter((v) => v !== val) : [...selected, val]
    dispatch({ type: 'updateRule', ruleId: rule.id, updates: { value: next } })
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        {/* Visually mirrors `SelectTrigger size="sm"` (h-8, rounded-md, border)
            so the operator + value pair stays visually consistent. */}
        <button
          type="button"
          className={`inline-flex h-8 items-center justify-between gap-2 rounded-md border border-input bg-background px-2.5 text-xs shadow-xs transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:shadow-focus focus-visible:border-foreground w-auto min-w-[160px] ${errorClass}`}
          aria-label={t('ui.advancedFilter.selectValue', 'Select value')}
          data-testid="multi-value-trigger"
        >
          <span className={selected.length === 0 ? 'text-muted-foreground' : ''}>{selectedLabel}</span>
          <ChevronDown className="size-3 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-1" align="start" data-advanced-filter-portal="">
        <div className="max-h-64 overflow-y-auto" role="listbox" aria-multiselectable="true">
          {options.map((opt) => {
            const isOn = selected.includes(opt.value)
            return (
              // Raw <button>: needs `role="option"` + `aria-selected`; <Button> would override role.
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={isOn}
                onClick={() => toggle(opt.value)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
              >
                <Checkbox checked={isOn} aria-hidden="true" tabIndex={-1} className="pointer-events-none" />
                {opt.tone ? (
                  <span className="inline-flex items-center gap-2">
                    <span className={toneDotClass(opt.tone)} aria-hidden="true" />
                    {opt.label}
                  </span>
                ) : (
                  <span>{opt.label}</span>
                )}
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function toneDotClass(tone: NonNullable<FilterFieldDef['options']>[number]['tone']): string {
  // Solid filled dot using the saturated `*-icon` token (matches Tag's `dotColorMap`).
  const base = 'inline-block size-2 rounded-full shrink-0'
  switch (tone) {
    case 'success': return `${base} bg-status-success-icon`
    case 'error': return `${base} bg-status-error-icon`
    case 'warning': return `${base} bg-status-warning-icon`
    case 'info': return `${base} bg-status-info-icon`
    case 'neutral': return `${base} bg-status-neutral-icon`
    case 'pink': return `${base} bg-status-pink-icon`
    case 'brand': return `${base} bg-brand-violet`
    default: return `${base} bg-muted-foreground/40`
  }
}

// Single Kendo-style toolbar per group: combinator toggle, `+ Add condition`,
// `+ Add subgroup` / `+ Add group`, plus a trailing delete for non-root groups.
function GroupToolbar({
  group, level, tree, dispatch, defaultField, fields, isRoot, t,
}: {
  group: FilterGroup
  level: number
  tree: AdvancedFilterTree
  dispatch: (a: TreeAction) => void
  defaultField?: string
  fields: FilterFieldDef[]
  isRoot: boolean
  t: Translator
}) {
  const [pickerOpen, setPickerOpen] = React.useState(false)
  const addBtnRef = React.useRef<HTMLButtonElement>(null)
  const addRuleEnabled = canAddRule(tree, group.id)
  const addGroupEnabled = canAddGroup(tree, group.id)

  const widthCapHit = group.children.length >= TREE_LIMITS.maxChildrenPerGroup
  const depthCapHit = level >= TREE_LIMITS.maxGroupLevel

  const addRuleTitle = !addRuleEnabled
    ? widthCapHit
      ? t('ui.advancedFilter.limitWidthReached', 'Maximum {max} conditions per group', {
          max: TREE_LIMITS.maxChildrenPerGroup,
        })
      : t('ui.advancedFilter.limitTotalReached', 'Maximum {max} conditions reached', {
          max: TREE_LIMITS.maxTotalRules,
        })
    : undefined

  const addGroupTitle = !addGroupEnabled
    ? depthCapHit
      ? t('ui.advancedFilter.limitDepthReached', 'Maximum nesting depth reached')
      : widthCapHit
      ? t('ui.advancedFilter.limitWidthReached', 'Maximum {max} conditions per group', {
          max: TREE_LIMITS.maxChildrenPerGroup,
        })
      : t('ui.advancedFilter.limitTotalReached', 'Maximum {max} conditions reached', {
          max: TREE_LIMITS.maxTotalRules,
        })
    : undefined

  const addGroupLabel = level === 1
    ? t('ui.advancedFilter.addGroup', '+ Add group')
    : t('ui.advancedFilter.addSubgroup', '+ Add subgroup')

  // `text-brand-violet` overrides Button's default disabled token, so we have to
  // re-state muted disabled colors here — otherwise disabled CTAs still look clickable.
  const ctaClass = 'text-brand-violet hover:text-brand-violet/80 hover:bg-transparent px-0 disabled:text-muted-foreground/50 disabled:hover:text-muted-foreground/50'

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-3">
        <AndOrToggle
          combinator={group.combinator}
          onChange={(c) => dispatch({ type: 'updateGroupCombinator', groupId: group.id, combinator: c })}
          t={t}
        />
        <Button
          ref={addBtnRef}
          type="button"
          variant="ghost"
          size="sm"
          disabled={!addRuleEnabled}
          title={addRuleTitle}
          onClick={() => setPickerOpen(true)}
          className={ctaClass}
        >
          <Plus className="size-4" />
          {t('ui.advancedFilter.addCondition', '+ Add condition')}
        </Button>
        <FilterFieldPicker
          fields={fields}
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          onSelect={(f) =>
            dispatch({
              type: 'addRule',
              groupId: group.id,
              defaultField: f.key,
              defaultOperator: getDefaultOperator(f.type),
            })
          }
          triggerRef={addBtnRef as React.RefObject<HTMLElement | null>}
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!addGroupEnabled}
          title={addGroupTitle}
          onClick={() =>
            dispatch({ type: 'addGroup', groupId: group.id, defaultField })
          }
          className={ctaClass}
        >
          <Plus className="size-4" />
          {addGroupLabel}
        </Button>
        {!isRoot ? (
          <IconButton
            variant="ghost"
            size="sm"
            type="button"
            onClick={() => dispatch({ type: 'removeNode', nodeId: group.id })}
            aria-label={t('ui.advancedFilter.deleteGroup', 'Delete group')}
            title={t('ui.advancedFilter.deleteGroup', 'Delete group')}
            className="ml-auto"
          >
            <X className="size-4 text-muted-foreground" />
          </IconButton>
        ) : null}
      </div>
      {!addGroupEnabled && depthCapHit ? (
        <p className="text-xs text-muted-foreground" data-testid="filter-depth-limit-hint">
          {t('ui.advancedFilter.limitDepthHint', 'You\'ve reached the maximum nesting depth ({max} levels). Switch this group\'s combinator with the toggle above instead of nesting deeper.', {
            max: TREE_LIMITS.maxGroupLevel,
          })}
        </p>
      ) : null}
    </div>
  )
}
