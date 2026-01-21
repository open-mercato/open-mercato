'use client'

import { useState, useEffect } from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Label } from '@open-mercato/ui/primitives/label'
import { Plus, Trash2, AlertCircle } from 'lucide-react'
import type { CrudCustomFieldRenderProps } from '@open-mercato/ui/backend/CrudForm'
import { BusinessRulesSelector, type BusinessRule } from '../BusinessRulesSelector'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { EmptyState } from '@open-mercato/ui/backend/EmptyState'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { ConfirmDialog } from '@open-mercato/ui/backend/ConfirmDialog'

/**
 * Condition definition structure (supports legacy string format and new object format)
 */
export type TransitionCondition = string | { ruleId: string; required: boolean }

interface BusinessRuleConditionsEditorProps extends CrudCustomFieldRenderProps {
  value: TransitionCondition[]
  filterEntityType?: string
  filterRuleType?: string
}

interface ConditionWithDetails {
  ruleId: string
  required: boolean
  ruleName?: string
  ruleType?: string
  loading?: boolean
  error?: boolean
}

/**
 * Normalize legacy string format to object format
 */
function normalizeCondition(raw: TransitionCondition): { ruleId: string; required: boolean } {
  if (typeof raw === 'string') {
    return { ruleId: raw, required: true }
  }
  return raw
}

/**
 * BusinessRuleConditionsEditor - Custom field component for managing pre/post business rule conditions
 *
 * Integrates with BusinessRulesSelector modal to add/remove conditions.
 * Fetches and displays rule names for selected rule IDs.
 * Supports both legacy string format and new object format with required flag.
 *
 * Used by EdgeEditDialog (pre-conditions and post-conditions)
 */
export function BusinessRuleConditionsEditor({
  id,
  value = [],
  setValue,
  disabled,
  filterEntityType,
  filterRuleType,
}: BusinessRuleConditionsEditorProps) {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [conditionsWithDetails, setConditionsWithDetails] = useState<ConditionWithDetails[]>([])

  const conditions = Array.isArray(value) ? value : []

  // Fetch rule details when conditions change
  useEffect(() => {
    const normalized = conditions.map(normalizeCondition)
    const withDetails: ConditionWithDetails[] = normalized.map((c) => ({
      ...c,
      loading: true,
    }))
    setConditionsWithDetails(withDetails)

    // Fetch details for each rule
    normalized.forEach((condition, index) => {
      fetchRuleDetails(condition.ruleId, index)
    })
  }, [JSON.stringify(conditions.map(normalizeCondition))])

  const fetchRuleDetails = async (ruleId: string, index: number) => {
    try {
      const params = new URLSearchParams({ ruleId, pageSize: '1' })
      const response = await apiFetch(`/api/business_rules/rules?${params.toString()}`)

      if (response.ok) {
        const data = await response.json()
        const rule = data.items?.[0] as BusinessRule | undefined

        setConditionsWithDetails((prev) => {
          const updated = [...prev]
          if (updated[index]) {
            updated[index] = {
              ...updated[index],
              ruleName: rule?.ruleName || ruleId,
              ruleType: rule?.ruleType,
              loading: false,
              error: !rule,
            }
          }
          return updated
        })
      } else {
        setConditionsWithDetails((prev) => {
          const updated = [...prev]
          if (updated[index]) {
            updated[index] = {
              ...updated[index],
              ruleName: ruleId,
              loading: false,
              error: true,
            }
          }
          return updated
        })
      }
    } catch (err) {
      console.error(`Failed to fetch rule details for ${ruleId}:`, err)
      setConditionsWithDetails((prev) => {
        const updated = [...prev]
        if (updated[index]) {
          updated[index] = {
            ...updated[index],
            ruleName: ruleId,
            loading: false,
            error: true,
          }
        }
        return updated
      })
    }
  }

  const addCondition = (ruleId: string, _rule: BusinessRule) => {
    const newCondition: TransitionCondition = { ruleId, required: true }
    setValue([...conditions, newCondition])
    setIsModalOpen(false)
  }

  const removeCondition = (index: number) => {
    const newConditions = conditions.filter((_, i) => i !== index)
    setValue(newConditions)
  }

  const toggleRequired = (index: number) => {
    const normalized = normalizeCondition(conditions[index])
    const updated = [...conditions]
    updated[index] = {
      ruleId: normalized.ruleId,
      required: !normalized.required,
    }
    setValue(updated)
  }

  const getExcludedRuleIds = (): string[] => {
    return conditions.map((c) => normalizeCondition(c).ruleId)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end">
        <Button
          type="button"
          size="sm"
          onClick={() => setIsModalOpen(true)}
          disabled={disabled}
        >
          <Plus className="size-3 mr-1" />
          Add Rule
        </Button>
      </div>

      {conditions.length === 0 ? (
        <EmptyState
          title="No conditions defined"
          description="Add a business rule condition for this transition."
          action={{ label: 'Add Rule', onClick: () => setIsModalOpen(true), disabled }}
        />
      ) : (
        <div className="space-y-2">
          {conditionsWithDetails.map((condition, index) => {
            const normalized = normalizeCondition(conditions[index])
            return (
              <div key={index} className="border border-gray-200 rounded-lg bg-white p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0 space-y-2">
                    {/* Rule Name/ID */}
                    <div className="flex items-center gap-2">
                      {condition.loading ? (
                        <>
                          <Spinner size="sm" />
                          <span className="text-sm text-muted-foreground">Loading rule details...</span>
                        </>
                      ) : condition.error ? (
                        <>
                          <AlertCircle className="size-4 text-amber-600" />
                          <div>
                            <span className="text-sm font-semibold text-foreground">{condition.ruleId}</span>
                            <p className="text-xs text-amber-600">Rule not found or unavailable</p>
                          </div>
                        </>
                      ) : (
                        <div>
                          <span className="text-sm font-semibold text-foreground">{condition.ruleName}</span>
                          {condition.ruleType && (
                            <Badge variant="secondary" className="text-xs ml-2">
                              {condition.ruleType}
                            </Badge>
                          )}
                          <p className="text-xs text-muted-foreground mt-0.5">
                            ID: <code className="bg-muted px-1 rounded font-mono">{condition.ruleId}</code>
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Required Toggle */}
                    <div className="flex items-center gap-2">
                      <Switch
                        id={`${id}-${index}-required`}
                        checked={normalized.required}
                        onCheckedChange={() => toggleRequired(index)}
                        disabled={disabled}
                      />
                      <Label htmlFor={`${id}-${index}-required`} className="text-xs font-medium cursor-pointer">
                        Required (transition blocked if rule fails)
                      </Label>
                    </div>
                  </div>

                  {/* Delete Button */}
                  <ConfirmDialog
                    trigger={
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={disabled}
                        className="ml-2 flex-shrink-0"
                      >
                        <Trash2 className="size-4 text-red-600" />
                      </Button>
                    }
                    title="Remove Condition"
                    description="Are you sure you want to remove this condition?"
                    onConfirm={() => removeCondition(index)}
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Business Rules Selector Modal */}
      <BusinessRulesSelector
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSelect={addCondition}
        excludeRuleIds={getExcludedRuleIds()}
        title="Select Business Rule"
        description="Choose a business rule to add as a condition"
        filterEntityType={filterEntityType}
        filterRuleType={filterRuleType}
        onlyEnabled={true}
      />
    </div>
  )
}
