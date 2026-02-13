'use client'

import { useState, useEffect, useCallback } from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Label } from '@open-mercato/ui/primitives/label'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { Plus, Trash2, AlertCircle, ChevronUp, ChevronDown } from 'lucide-react'
import { BusinessRulesSelector, type BusinessRule } from '../BusinessRulesSelector'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { EmptyState } from '@open-mercato/ui/backend/EmptyState'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { ConfirmDialog } from '@open-mercato/ui/backend/ConfirmDialog'

/**
 * StartPreCondition interface matching the schema in validators.ts
 */
export interface StartPreCondition {
  ruleId: string
  required: boolean
  validationMessage?: Record<string, string> // e.g., { en: 'Message', pl: 'Wiadomość' }
}

interface StartPreConditionsEditorProps {
  value?: StartPreCondition[] | unknown
  setValue?: ((value: unknown) => void) | ((value: StartPreCondition[]) => void)
  disabled?: boolean
}

interface ConditionWithDetails extends StartPreCondition {
  ruleName?: string
  ruleType?: string
  loading?: boolean
  error?: boolean
}

/**
 * LocalizedMessageTextarea - Textarea with local state that only updates parent on blur
 */
function LocalizedMessageTextarea({
  value,
  onChange,
  disabled,
  id,
  placeholder,
  hint,
}: {
  value: Record<string, string> | undefined
  onChange: (messages: Record<string, string>) => void
  disabled?: boolean
  id: string
  placeholder: string
  hint: string
}) {
  const getValidationMessagesString = (messages: Record<string, string> | undefined): string => {
    if (!messages) return ''
    return Object.entries(messages)
      .filter(([_, msg]) => msg)
      .map(([locale, msg]) => `${locale}: ${msg}`)
      .join('\n')
  }

  const parseValidationMessagesString = (str: string): Record<string, string> => {
    const result: Record<string, string> = {}
    str.split('\n').forEach(line => {
      const match = line.match(/^(\w+):\s*(.*)$/)
      if (match) {
        result[match[1]] = match[2]
      }
    })
    return result
  }

  const [localValue, setLocalValue] = useState(() => getValidationMessagesString(value))

  // Update local value when external value changes
  useEffect(() => {
    setLocalValue(getValidationMessagesString(value))
  }, [value])

  const handleBlur = useCallback(() => {
    onChange(parseValidationMessagesString(localValue))
  }, [localValue, onChange])

  return (
    <>
      <Textarea
        id={id}
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        onBlur={handleBlur}
        placeholder={placeholder}
        rows={2}
        className="mt-1 font-mono text-xs"
        disabled={disabled}
      />
      <p className="text-xs text-muted-foreground mt-1">
        {hint}
      </p>
    </>
  )
}

/**
 * StartPreConditionsEditor - Editor for START step pre-conditions
 *
 * Uses BusinessRulesSelector modal for selecting business rules (searchable).
 * Supports localized validation messages for each pre-condition.
 * Matches the style of TransitionsEditor and BusinessRuleConditionsEditor.
 */
export function StartPreConditionsEditor({
  value,
  setValue,
  disabled = false,
}: StartPreConditionsEditorProps) {
  const t = useT()
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [conditionsWithDetails, setConditionsWithDetails] = useState<ConditionWithDetails[]>([])

  // Safely cast value to StartPreCondition array
  const conditions: StartPreCondition[] = Array.isArray(value) ? value : []

  // Helper to call setValue with proper typing
  const updateValue = (newValue: StartPreCondition[]) => {
    if (setValue) {
      setValue(newValue)
    }
  }

  // Fetch rule details when conditions change
  useEffect(() => {
    const withDetails: ConditionWithDetails[] = conditions.map((c) => ({
      ...c,
      loading: true,
    }))
    setConditionsWithDetails(withDetails)

    // Fetch details for each rule
    conditions.forEach((condition, index) => {
      fetchRuleDetails(condition.ruleId, index)
    })
  }, [JSON.stringify(conditions.map(c => c.ruleId))])

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
    const newCondition: StartPreCondition = {
      ruleId,
      required: true,
      validationMessage: { en: '' },
    }
    updateValue([...conditions, newCondition])
    setIsModalOpen(false)
  }

  const updateCondition = (index: number, updates: Partial<StartPreCondition>) => {
    const updated = [...conditions]
    updated[index] = { ...updated[index], ...updates }
    updateValue(updated)
  }

  const removeCondition = (index: number) => {
    updateValue(conditions.filter((_, i) => i !== index))
  }

  const moveCondition = (index: number, direction: 'up' | 'down') => {
    const newIndex = direction === 'up' ? index - 1 : index + 1
    if (newIndex < 0 || newIndex >= conditions.length) return

    const updated = [...conditions]
    const temp = updated[index]
    updated[index] = updated[newIndex]
    updated[newIndex] = temp
    updateValue(updated)
  }

  const getExcludedRuleIds = (): string[] => {
    return conditions.map((c) => c.ruleId)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            {t('workflows.fieldEditors.preConditions.description')}
          </p>
        </div>
        <Button
          type="button"
          onClick={() => setIsModalOpen(true)}
          variant="outline"
          size="sm"
          disabled={disabled}
          className="w-full sm:w-auto"
        >
          <Plus className="h-4 w-4 mr-1" />
          {t('workflows.fieldEditors.preConditions.addRule')}
        </Button>
      </div>

      {conditions.length === 0 && (
        <EmptyState
          title={t('workflows.fieldEditors.preConditions.emptyTitle')}
          description={t('workflows.fieldEditors.preConditions.emptyDescription')}
          action={{ label: t('workflows.fieldEditors.preConditions.addRule'), onClick: () => setIsModalOpen(true), disabled }}
        />
      )}

      <div className="space-y-3">
        {conditionsWithDetails.map((condition, index) => (
          <div key={index} className="border border-gray-200 rounded-lg bg-white p-4">
            <div className="space-y-3">
              {/* Header row with rule info and actions */}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex-1 min-w-0">
                  {/* Rule Name/ID */}
                  {condition.loading ? (
                    <div className="flex items-center gap-2">
                      <Spinner size="sm" />
                      <span className="text-sm text-muted-foreground">{t('workflows.common.loadingDetails')}</span>
                    </div>
                  ) : condition.error ? (
                    <div className="flex items-center gap-2">
                      <AlertCircle className="size-4 text-amber-600" />
                      <div>
                        <span className="text-sm font-semibold text-foreground">{condition.ruleId}</span>
                        <p className="text-xs text-amber-600">{t('workflows.common.ruleNotFound')}</p>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-foreground">{condition.ruleName}</span>
                        {condition.ruleType && (
                          <Badge variant="secondary" className="text-xs">
                            {condition.ruleType}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        ID: <code className="bg-muted px-1 rounded font-mono">{condition.ruleId}</code>
                      </p>
                    </div>
                  )}
                </div>

                {/* Action buttons */}
                <div className="flex items-center gap-1 self-end sm:self-auto">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => moveCondition(index, 'up')}
                    disabled={index === 0 || disabled}
                    title={t('workflows.common.moveUp')}
                  >
                    <ChevronUp className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => moveCondition(index, 'down')}
                    disabled={index === conditions.length - 1 || disabled}
                    title={t('workflows.common.moveDown')}
                  >
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                  <ConfirmDialog
                    trigger={
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        title={t('workflows.common.delete')}
                        disabled={disabled}
                      >
                        <Trash2 className="h-4 w-4 text-red-600" />
                      </Button>
                    }
                    title={t('workflows.fieldEditors.preConditions.removePreCondition')}
                    description={t('workflows.fieldEditors.preConditions.confirmRemove')}
                    onConfirm={() => removeCondition(index)}
                  />
                </div>
              </div>

              {/* Required toggle */}
              <div className="flex items-center gap-2">
                <Switch
                  id={`precondition-${index}-required`}
                  checked={conditions[index]?.required ?? true}
                  onCheckedChange={(checked) => updateCondition(index, { required: checked })}
                  disabled={disabled}
                />
                <Label htmlFor={`precondition-${index}-required`} className="text-xs font-medium cursor-pointer">
                  {t('workflows.fieldEditors.preConditions.requiredLabel')}
                </Label>
              </div>

              {/* Validation Messages */}
              <div>
                <Label htmlFor={`precondition-${index}-messages`} className="text-xs">
                  {t('workflows.fieldEditors.preConditions.validationMessages')}
                </Label>
                <LocalizedMessageTextarea
                  id={`precondition-${index}-messages`}
                  value={conditions[index]?.validationMessage}
                  onChange={(messages) => updateCondition(index, { validationMessage: messages })}
                  disabled={disabled}
                  placeholder={t('workflows.fieldEditors.preConditions.validationMessagesPlaceholder')}
                  hint={t('workflows.fieldEditors.preConditions.validationMessagesHint')}
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Business Rules Selector Modal */}
      <BusinessRulesSelector
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSelect={addCondition}
        excludeRuleIds={getExcludedRuleIds()}
        title={t('workflows.fieldEditors.preConditions.selectBusinessRule')}
        description={t('workflows.fieldEditors.preConditions.selectBusinessRuleDescription')}
        filterRuleType="GUARD"
        onlyEnabled={true}
      />
    </div>
  )
}
