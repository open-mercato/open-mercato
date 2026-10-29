'use client'

// Recursive rule-group tree node (Step 1.7, SPEC-055 §UI/UX "Rule Group Tree Builder").
// Renders one `RuleGroup`'s header (AND/OR pill + action buttons), its rules, its
// benefits zone, and its sub-groups — recursing into itself for each child.
//
// Depth indication (rev A6/om-ds-guardian note: "never a computed color-mix/arbitrary-
// value background"): every class below is a literal, DS-sanctioned Tailwind utility —
// `border-l-2`/`border-l-4` (`.ai/ds-rules.md` border-width scale) paired with the
// semantic `border-border` token, and `bg-muted/30`/`bg-muted/50` (ds-rules.md "Subtle
// tint"/"Medium tint" rows) alternated by depth parity. Indentation steps through the
// static Tailwind margin scale (`ml-0`..`ml-8`), capped so deep trees don't collapse to
// zero width. This mirrors (and extends with per-level stepping) the sub-group styling
// `packages/ui/src/backend/filters/AdvancedFilterBuilder.tsx`'s `GroupView` already uses
// (`rounded-lg border border-border bg-muted/30 p-3`) — the closest existing precedent
// for a nested AND/OR tree in this repo.

import * as React from 'react'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { Plus, Copy, Trash2 } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { RuleCard } from './RuleCard'
import { BenefitCard } from './BenefitCard'
import type { LocalRuleGroupNode } from './ruleTreeTypes'
import type { TreeAction } from './ruleTreeReducer'

const INDENT_STEPS = ['ml-0', 'ml-3', 'ml-6', 'ml-8', 'ml-10']

function indentClass(depth: number): string {
  return INDENT_STEPS[Math.min(depth, INDENT_STEPS.length - 1)]
}

function depthToneClass(depth: number): string {
  if (depth === 0) return ''
  return depth % 2 === 1 ? 'bg-muted/30' : 'bg-muted/50'
}

function depthBorderClass(depth: number): string {
  if (depth === 0) return ''
  return depth >= 2 ? 'border-l-4 border-border' : 'border-l-2 border-border'
}

export type RuleGroupNodeProps = {
  group: LocalRuleGroupNode
  depth: number
  disabled?: boolean
  dispatch: (action: TreeAction) => void
}

export function RuleGroupNode({ group, depth, disabled, dispatch }: RuleGroupNodeProps) {
  const t = useT()
  const { confirm: confirmDialog, ConfirmDialogElement } = useConfirmDialog()
  const isRoot = depth === 0
  const hasChildren = group.rules.length > 0 || group.benefits.length > 0 || group.children.length > 0

  const handleDeleteGroup = React.useCallback(async () => {
    if (hasChildren) {
      const confirmed = await confirmDialog({
        title: t('promotions.tree.confirmDeleteGroup.title', 'Delete this sub-group?'),
        description: t(
          'promotions.tree.confirmDeleteGroup.description',
          'This removes the sub-group and everything inside it.',
        ),
        variant: 'destructive',
      })
      if (!confirmed) return
    }
    dispatch({ type: 'removeGroup', groupId: group.clientId })
  }, [confirmDialog, dispatch, group.clientId, hasChildren, t])

  return (
    <div
      className={[
        indentClass(depth),
        depthBorderClass(depth),
        isRoot ? '' : 'rounded-lg p-3',
        depthToneClass(depth),
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SegmentedControl
            value={group.operator}
            onValueChange={(next) => dispatch({ type: 'setGroupOperator', groupId: group.clientId, operator: next as 'and' | 'or' })}
            aria-label={t('promotions.tree.operatorLabel', 'Group logic')}
            size="sm"
          >
            <SegmentedControlItem value="and" disabled={disabled}>
              {t('promotions.tree.operator.and', 'AND')}
            </SegmentedControlItem>
            <SegmentedControlItem value="or" disabled={disabled}>
              {t('promotions.tree.operator.or', 'OR')}
            </SegmentedControlItem>
          </SegmentedControl>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={disabled}
              onClick={() => dispatch({ type: 'addRule', groupId: group.clientId })}
            >
              <Plus className="size-4" />
              {t('promotions.tree.actions.addRule', 'Add rule')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled}
              onClick={() => dispatch({ type: 'addSubgroup', groupId: group.clientId })}
            >
              <Plus className="size-4" />
              {t('promotions.tree.actions.addSubgroup', 'Add sub-group')}
            </Button>
            <Button
              type="button"
              variant="primary-filled"
              size="sm"
              disabled={disabled}
              onClick={() => dispatch({ type: 'addBenefit', groupId: group.clientId })}
            >
              <Plus className="size-4" />
              {t('promotions.tree.actions.addBenefit', 'Add benefit')}
            </Button>
            {!isRoot ? (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={disabled}
                  onClick={() => dispatch({ type: 'duplicateGroup', groupId: group.clientId })}
                >
                  <Copy className="size-4" />
                  {t('promotions.tree.actions.duplicate', 'Duplicate')}
                </Button>
                <Button type="button" variant="destructive" size="sm" disabled={disabled} onClick={handleDeleteGroup}>
                  <Trash2 className="size-4" />
                  {t('promotions.tree.actions.delete', 'Delete')}
                </Button>
              </>
            ) : null}
          </div>
        </div>

        {group.rules.length === 0 && group.children.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {t('promotions.tree.empty.rules', 'Add a rule or sub-group to define when this promotion activates.')}
          </p>
        ) : null}

        {group.rules.length > 0 ? (
          <SortableContext items={group.rules.map((rule) => rule.clientId)} strategy={verticalListSortingStrategy}>
            <div className="space-y-2">
              {group.rules.map((rule) => (
                <RuleCard
                  key={rule.clientId}
                  rule={rule}
                  disabled={disabled}
                  onTypeChange={(ruleType) => dispatch({ type: 'setRuleType', ruleId: rule.clientId, ruleType })}
                  onConfigChange={(config) => dispatch({ type: 'setRuleConfig', ruleId: rule.clientId, config })}
                  onDelete={() => dispatch({ type: 'removeRule', ruleId: rule.clientId })}
                />
              ))}
            </div>
          </SortableContext>
        ) : null}

        {group.children.length > 0 ? (
          <SortableContext items={group.children.map((child) => child.clientId)} strategy={verticalListSortingStrategy}>
            <div className="space-y-3">
              {group.children.map((child) => (
                <RuleGroupNode key={child.clientId} group={child} depth={depth + 1} disabled={disabled} dispatch={dispatch} />
              ))}
            </div>
          </SortableContext>
        ) : null}

        <div className="space-y-2 border-t border-status-info-border pt-3">
          <span className="text-xs font-semibold tracking-wide text-status-info-text">
            {t('promotions.tree.benefitsLabel', 'BENEFITS')}
          </span>
          {group.benefits.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('promotions.tree.empty.benefits', 'No benefits yet.')}</p>
          ) : (
            <SortableContext items={group.benefits.map((benefit) => benefit.clientId)} strategy={verticalListSortingStrategy}>
              <div className="space-y-2">
                {group.benefits.map((benefit) => (
                  <BenefitCard
                    key={benefit.clientId}
                    benefit={benefit}
                    disabled={disabled}
                    onTypeChange={(benefitType) => dispatch({ type: 'setBenefitType', benefitId: benefit.clientId, benefitType })}
                    onAppliesToChange={(appliesTo, config) =>
                      dispatch({ type: 'setBenefitAppliesTo', benefitId: benefit.clientId, appliesTo, config })
                    }
                    onConfigChange={(config) => dispatch({ type: 'setBenefitConfig', benefitId: benefit.clientId, config })}
                    onLabelsChange={(labels) => dispatch({ type: 'setBenefitLabels', benefitId: benefit.clientId, labels })}
                    onDelete={() => dispatch({ type: 'removeBenefit', benefitId: benefit.clientId })}
                  />
                ))}
              </div>
            </SortableContext>
          )}
        </div>
      </div>
      {ConfirmDialogElement}
    </div>
  )
}
