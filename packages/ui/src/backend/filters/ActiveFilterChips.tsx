'use client'
import * as React from 'react'
import { X } from 'lucide-react'
import { Tag, type TagVariant } from '../../primitives/tag'
import { IconButton } from '../../primitives/icon-button'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { AdvancedFilterTree, FilterRule, FilterGroup } from '@open-mercato/shared/lib/query/advanced-filter-tree'
import type { FilterFieldDef, FilterOption } from '@open-mercato/shared/lib/query/advanced-filter'
import { isValuelessOperator } from '@open-mercato/shared/lib/query/advanced-filter'
import { validateTreeForApply } from './filterValidation'

export type ActiveFilterChipsProps = {
  tree: AdvancedFilterTree
  fields: FilterFieldDef[]
  popoverOpen: boolean
  onRemoveNode: (id: string) => void
  onOpen: (focusNodeId?: string) => void
}

const MAX_LABEL = 24

function truncate(s: string): string {
  if (s.length <= MAX_LABEL) return s
  return s.slice(0, MAX_LABEL) + '…'
}

function getOption(field: FilterFieldDef | undefined, value: string): FilterOption | undefined {
  if (!field?.options) return undefined
  return field.options.find((o) => o.value === value)
}

function valueText(field: FilterFieldDef | undefined, value: unknown): { text: string; tone?: TagVariant } {
  if (Array.isArray(value)) {
    if (value.length === 0) return { text: '' }
    const first = String(value[0])
    const opt = getOption(field, first)
    const display = opt?.label ?? first
    const more = value.length - 1
    return {
      text: more > 0 ? `${truncate(display)} +${more}` : truncate(display),
      tone: opt?.tone,
    }
  }
  if (value == null || value === '') return { text: '' }
  const str = String(value)
  const opt = getOption(field, str)
  return { text: truncate(opt?.label ?? str), tone: opt?.tone }
}

// Operator labels in chips read as natural English: "Email is empty" beats
// "Email: " (trailing colon, blank value). Keep the map narrow — only valueless
// operators need a phrase form here; value-bearing operators show the value.
const VALUELESS_OPERATOR_LABEL: Record<string, string> = {
  is_empty: 'is empty',
  is_not_empty: 'is not empty',
  is_true: 'is true',
  is_false: 'is false',
}

type Translator = ReturnType<typeof useT>

function ruleChip(rule: FilterRule, fields: FilterFieldDef[], t: Translator): { label: string; tone?: TagVariant } {
  const field = fields.find((f) => f.key === rule.field)
  const fieldLabel = field?.label ?? rule.field
  if (isValuelessOperator(rule.operator)) {
    const fallback = VALUELESS_OPERATOR_LABEL[rule.operator] ?? rule.operator
    const opLabel = t(`ui.advancedFilter.operator.${rule.operator}`, fallback)
    return { label: `${fieldLabel} ${opLabel}` }
  }
  // `between` stores `[start, end]` — render it as a range, not as the
  // multi-select "first +N" summary that `valueText` would produce.
  if (rule.operator === 'between' && Array.isArray(rule.value)) {
    const [start, end] = rule.value
    const startStr = start == null ? '' : String(start)
    const endStr = end == null ? '' : String(end)
    return { label: `${fieldLabel}: ${truncate(startStr)} – ${truncate(endStr)}` }
  }
  const v = valueText(field, rule.value)
  return { label: `${fieldLabel}: ${v.text}`, tone: v.tone }
}

function groupChip(group: FilterGroup, fields: FilterFieldDef[], invalidRuleIds: Set<string>, t: Translator): { label: string; tone?: TagVariant; remaining: number } {
  const ruleChildren: FilterRule[] = []
  for (const c of group.children) if (c.type === 'rule' && !invalidRuleIds.has(c.id)) ruleChildren.push(c)
  if (!ruleChildren.length) return { label: '', remaining: 0 }
  const firstChip = ruleChip(ruleChildren[0], fields, t)
  const remaining = ruleChildren.length - 1
  return {
    label: remaining > 0 ? `${firstChip.label} +${remaining}` : firstChip.label,
    tone: firstChip.tone,
    remaining,
  }
}

function isNodeFullyInvalid(node: FilterRule | FilterGroup, invalidRuleIds: Set<string>): boolean {
  if (node.type === 'rule') return invalidRuleIds.has(node.id)
  if (!node.children.length) return true
  return node.children.every((c) => isNodeFullyInvalid(c, invalidRuleIds))
}

export function ActiveFilterChips({ tree, fields, popoverOpen, onRemoveNode, onOpen }: ActiveFilterChipsProps) {
  const t = useT()
  // Suppress chips for rules/groups whose values won't actually filter (matches
  // the same gate the auto-apply hook uses). Stops the "chip is shown but data
  // appears unfiltered" mismatch when a substring text rule has < 2 characters
  // or a multi-value rule has no picks yet.
  const invalidRuleIds = React.useMemo(() => {
    const result = validateTreeForApply(tree, fields)
    if (result.ok) return new Set<string>()
    return new Set(result.errors.map((e) => e.ruleId))
  }, [tree, fields])
  const visibleChildren = React.useMemo(
    () => tree.root.children.filter((child) => !isNodeFullyInvalid(child, invalidRuleIds)),
    [tree.root.children, invalidRuleIds],
  )
  if (popoverOpen) return null
  if (!visibleChildren.length) return null
  return (
    <div
      className="flex items-center gap-2 px-4 py-2 overflow-x-auto bg-background border-b border-border"
      data-testid="active-filter-chips"
    >
      {visibleChildren.map((child) => {
        if (child.type === 'rule') {
          const c = ruleChip(child, fields, t)
          return (
            <ChipWithRemove
              key={child.id}
              label={c.label}
              tone={c.tone}
              onClick={() => onOpen(child.id)}
              onRemove={() => onRemoveNode(child.id)}
              removeLabel={t('ui.advancedFilter.chips.remove', 'Remove filter')}
            />
          )
        }
        const c = groupChip(child, fields, invalidRuleIds, t)
        return (
          <ChipWithRemove
            key={child.id}
            label={c.label}
            tone={c.tone}
            onClick={() => onOpen(child.id)}
            onRemove={() => onRemoveNode(child.id)}
            removeLabel={t('ui.advancedFilter.chips.removeGroup', 'Remove filter group')}
          />
        )
      })}
    </div>
  )
}

type ChipWithRemoveProps = {
  label: string
  tone?: TagVariant
  onClick: () => void
  onRemove: () => void
  removeLabel: string
}

function ChipWithRemove({ label, tone, onClick, onRemove, removeLabel }: ChipWithRemoveProps) {
  return (
    <div className="inline-flex items-center gap-1" data-testid="active-filter-chip" aria-label={label}>
      {/* Raw <button> required: <Tag> is a presentational pill primitive (not a Button), so wrapping
          it in <Button> would inject Button's own styling around it. The native button keeps Tag's
          visual contract intact while adding click + keyboard semantics; DS focus-visible ring is applied. */}
      <button
        type="button"
        onClick={onClick}
        className="inline-flex rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <Tag variant={tone ?? 'default'} dot={tone != null}>{label}</Tag>
      </button>
      <IconButton type="button" variant="ghost" size="xs" aria-label={removeLabel} onClick={onRemove}>
        <X className="size-3" />
      </IconButton>
    </div>
  )
}
