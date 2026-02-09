"use client"

import * as React from 'react'
import { Plus, X } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { ConditionRow } from './ConditionRow'
import type { GroupCondition, ConditionExpression, SimpleCondition } from './utils/conditionValidation'
import type { LogicalOperator } from './../data/validators'
import { isGroupCondition, getLogicalOperators } from './utils/conditionValidation'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export type ConditionGroupProps = {
  group: GroupCondition
  onChange: (group: GroupCondition) => void
  onDelete?: () => void
  depth: number
  maxDepth?: number
  entityType?: string
}

const DEPTH_COLORS = [
  'border-blue-300 bg-blue-50 dark:border-blue-700 dark:bg-blue-950/50',
  'border-green-300 bg-green-50 dark:border-green-700 dark:bg-green-950/50',
  'border-purple-300 bg-purple-50 dark:border-purple-700 dark:bg-purple-950/50',
  'border-orange-300 bg-orange-50 dark:border-orange-700 dark:bg-orange-950/50',
  'border-pink-300 bg-pink-50 dark:border-pink-700 dark:bg-pink-950/50',
]

export function ConditionGroup({ group, onChange, onDelete, depth, maxDepth = 5, entityType }: ConditionGroupProps) {
  const t = useT()
  const logicalOperators = getLogicalOperators(t)
  const colorClass = DEPTH_COLORS[depth % DEPTH_COLORS.length]

  const handleOperatorChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onChange({
      ...group,
      operator: e.target.value as LogicalOperator,
    })
  }

  const handleRuleChange = (index: number, updatedRule: ConditionExpression) => {
    const newRules = [...group.rules]
    newRules[index] = updatedRule
    onChange({
      ...group,
      rules: newRules,
    })
  }

  const handleDeleteRule = (index: number) => {
    const newRules = group.rules.filter((_, i) => i !== index)
    if (newRules.length === 0) {
      // If no rules left, delete the group itself
      onDelete?.()
    } else {
      onChange({
        ...group,
        rules: newRules,
      })
    }
  }

  const addSimpleCondition = () => {
    const newCondition: SimpleCondition = {
      field: '',
      operator: '=',
      value: null,
    }
    onChange({
      ...group,
      rules: [...group.rules, newCondition],
    })
  }

  const addConditionGroup = () => {
    if (depth >= maxDepth) {
      alert(t('business_rules.components.conditionGroup.maxDepthReached', { maxDepth }))
      return
    }

    const newGroup: GroupCondition = {
      operator: 'AND',
      rules: [
        {
          field: '',
          operator: '=',
          value: null,
        },
      ],
    }
    onChange({
      ...group,
      rules: [...group.rules, newGroup],
    })
  }

  return (
    <div
      className={`p-3 rounded border-2 ${colorClass}`}
      style={{ marginLeft: depth > 0 ? `${depth * 16}px` : '0' }}
    >
      {/* Group Header */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs font-medium text-muted-foreground">
          {t('business_rules.components.conditionGroup.group', { depth: depth + 1 })}
        </span>
        <select
          value={group.operator}
          onChange={handleOperatorChange}
          className="px-3 py-1.5 text-sm font-semibold border border-border rounded bg-card focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {logicalOperators.map((op) => (
            <option key={op.value} value={op.value}>
              {op.label}
            </option>
          ))}
        </select>

        <span className="text-xs text-muted-foreground">
          ({t('business_rules.components.conditionGroup.ruleCount', { count: group.rules.length })})
        </span>

        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="ml-auto p-1 text-muted-foreground hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
            title={t('business_rules.components.conditionGroup.deleteGroup')}
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Rules */}
      <div className="space-y-2">
        {group.rules.map((rule, index) => (
          <div key={index}>
            {isGroupCondition(rule) ? (
              // Recursive: Nested Group
              <ConditionGroup
                group={rule}
                onChange={(updatedGroup) => handleRuleChange(index, updatedGroup)}
                onDelete={() => handleDeleteRule(index)}
                depth={depth + 1}
                maxDepth={maxDepth}
                entityType={entityType}
              />
            ) : (
              // Base Case: Simple Condition
              <ConditionRow
                condition={rule}
                onChange={(updatedCondition) => handleRuleChange(index, updatedCondition)}
                onDelete={() => handleDeleteRule(index)}
                entityType={entityType}
              />
            )}
          </div>
        ))}
      </div>

      {/* Add Buttons */}
      <div className="flex gap-2 mt-3">
        <Button
          type="button"
          onClick={addSimpleCondition}
          variant="outline"
          size="sm"
          className="text-xs"
        >
          <Plus className="w-3 h-3 mr-1" />
          {t('business_rules.components.conditionGroup.addCondition')}
        </Button>

        {depth < maxDepth && (
          <Button
            type="button"
            onClick={addConditionGroup}
            variant="outline"
            size="sm"
            className="text-xs"
          >
            <Plus className="w-3 h-3 mr-1" />
            {t('business_rules.components.conditionGroup.addGroup', { depth: depth + 2 })}
          </Button>
        )}
      </div>
    </div>
  )
}
