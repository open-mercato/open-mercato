'use client'

import { useState } from 'react'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { Button } from '@open-mercato/ui/primitives/button'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { ChevronDown, Plus, Trash2 } from 'lucide-react'
import { JsonBuilder } from '@open-mercato/ui/backend/JsonBuilder'
import { DurationInput } from '@open-mercato/ui/backend/inputs/DurationInput'
import type { CrudCustomFieldRenderProps } from '@open-mercato/ui/backend/CrudForm'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { LedgerEntry } from '../../lib/context-ledger'
import type { PinnedSampleEnvelope } from '../../lib/sample-resolver'
import { useActivityTypeOptions } from './useActivityTypeOptions'
import { ActivityConfigFields, hasActivityConfigForm } from './ActivityConfigFields'
import { ActivityTestPanel } from './ActivityTestPanel'

/**
 * Activity definition structure
 */
export interface Activity {
  activityId: string
  activityName: string
  activityType: string
  config: Record<string, any>
  timeout?: string
  timeoutMs?: number
  async?: boolean
  compensate?: boolean
  retryPolicy?: {
    maxAttempts?: number
    initialIntervalMs?: number
    backoffCoefficient?: number
    maxIntervalMs?: number
  }
}

export interface ActivityTestContext {
  definitionId: string | null
  stepId: string
  pinnedSample?: PinnedSampleEnvelope
  onPinSample: (data: unknown) => void
  onUnpinSample: () => void
}

interface ActivityArrayEditorProps extends CrudCustomFieldRenderProps {
  value: Activity[]
  ledgerEntries?: LedgerEntry[]
  testContext?: ActivityTestContext
}

/**
 * ActivityArrayEditor - Custom field component for managing workflow activities
 *
 * Provides an interface to add, edit, and remove activities with:
 * - Activity ID, Name, Type selection
 * - Timeout configuration
 * - Nested retry policy (maxAttempts, intervals, backoff)
 * - Activity-specific JSON configuration
 * - Async and compensate flags
 *
 * Used by both EdgeEditDialog and NodeEditDialog (automated type)
 */
export function ActivityArrayEditor({ id, value = [], error, setValue, disabled, ledgerEntries, testContext }: ActivityArrayEditorProps) {
  const t = useT()
  const activityTypeOptions = useActivityTypeOptions()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const [expandedIndices, setExpandedIndices] = useState<Set<number>>(new Set())
  const [advancedIndices, setAdvancedIndices] = useState<Set<number>>(new Set())

  const toggleAdvanced = (index: number) => {
    setAdvancedIndices((current) => {
      const next = new Set(current)
      if (next.has(index)) {
        next.delete(index)
      } else {
        next.add(index)
      }
      return next
    })
  }

  const activities = Array.isArray(value) ? value : []

  const toggleExpanded = (index: number) => {
    const newExpanded = new Set(expandedIndices)
    if (newExpanded.has(index)) {
      newExpanded.delete(index)
    } else {
      newExpanded.add(index)
    }
    setExpandedIndices(newExpanded)
  }

  const addActivity = () => {
    const newActivity: Activity = {
      activityId: `activity_${Date.now()}`,
      activityName: t('workflows.common.newActivity'),
      activityType: 'CALL_API',
      config: {},
      timeout: '',
      retryPolicy: {
        maxAttempts: 3,
        initialIntervalMs: 1000,
        backoffCoefficient: 2,
        maxIntervalMs: 10000,
      },
    }
    const newActivities = [...activities, newActivity]
    setValue(newActivities)

    // Auto-expand the newly added activity
    const newExpanded = new Set(expandedIndices)
    newExpanded.add(activities.length)
    setExpandedIndices(newExpanded)
  }

  const removeActivity = async (index: number) => {
    const confirmed = await confirm({
      title: t('workflows.fieldEditors.activities.removeActivity'),
      text: t('workflows.fieldEditors.activities.confirmRemove'),
      variant: 'destructive',
    })
    if (!confirmed) return

    const newActivities = activities.filter((_, i) => i !== index)
    setValue(newActivities)

    // Remove from expanded set
    const newExpanded = new Set(expandedIndices)
    newExpanded.delete(index)
    setExpandedIndices(newExpanded)
  }

  const updateActivity = (index: number, field: keyof Activity, fieldValue: any) => {
    const updated = [...activities]
    updated[index] = { ...updated[index], [field]: fieldValue }
    setValue(updated)
  }

  const updateRetryPolicy = (index: number, field: string, fieldValue: any) => {
    const updated = [...activities]
    updated[index] = {
      ...updated[index],
      retryPolicy: {
        ...updated[index].retryPolicy,
        [field]: fieldValue,
      },
    }
    setValue(updated)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end">
        <Button
          type="button"
          size="sm"
          onClick={addActivity}
          disabled={disabled}
        >
          <Plus className="size-3 mr-1" />
          {t('workflows.fieldEditors.activities.addActivity')}
        </Button>
      </div>

      {activities.length === 0 ? (
        <div className="p-4 text-center text-sm text-muted-foreground bg-muted rounded-lg border">
          {t('workflows.fieldEditors.activities.emptyState')}
        </div>
      ) : (
        <div className="space-y-2">
          {activities.map((activity, index) => {
            const isExpanded = expandedIndices.has(index)
            return (
              <div key={index} className="border border-gray-200 rounded-lg bg-gray-50">
                {/* Collapsed Header */}
                <button
                  type="button"
                  onClick={() => toggleExpanded(index)}
                  disabled={disabled}
                  className="w-full px-4 py-3 text-left flex items-center justify-between hover:bg-gray-100 transition-colors rounded-t-lg disabled:opacity-50"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-gray-900">
                        {activity.activityName || activity.activityId || `Activity ${index + 1}`}
                      </span>
                      <Badge variant="secondary" className="text-xs">
                        {activity.activityType}
                      </Badge>
                      {activity.async && (
                        <Badge variant="outline" className="text-xs">
                          Async
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-gray-600 mt-1">
                      ID: <code className="bg-white px-1 rounded">{activity.activityId}</code>
                    </p>
                  </div>
                  <ChevronDown
                    className={`w-5 h-5 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                  />
                </button>

                {/* Expanded Content */}
                {isExpanded && (
                  <div className="px-4 pb-4 space-y-3 border-t border-gray-200 bg-white">
                    {/* Activity ID */}
                    <div className="pt-3">
                      <Label htmlFor={`${id}-${index}-activityId`} className="text-xs font-medium mb-1">
                        {t('workflows.fieldEditors.activities.activityId')} *
                      </Label>
                      <Input
                        id={`${id}-${index}-activityId`}
                        type="text"
                        value={activity.activityId}
                        onChange={(e) => updateActivity(index, 'activityId', e.target.value)}
                        placeholder={t('workflows.fieldEditors.activities.activityIdPlaceholder')}
                        className="text-xs"
                        disabled={disabled}
                      />
                    </div>

                    {/* Activity Name */}
                    <div>
                      <Label htmlFor={`${id}-${index}-activityName`} className="text-xs font-medium mb-1">
                        {t('workflows.fieldEditors.activities.activityName')} *
                      </Label>
                      <Input
                        id={`${id}-${index}-activityName`}
                        type="text"
                        value={activity.activityName || ''}
                        onChange={(e) => updateActivity(index, 'activityName', e.target.value)}
                        placeholder={t('workflows.fieldEditors.activities.activityNamePlaceholder')}
                        className="text-xs"
                        disabled={disabled}
                      />
                    </div>

                    {/* Activity Type */}
                    <div>
                      <Label htmlFor={`${id}-${index}-activityType`} className="text-xs font-medium mb-1">
                        {t('workflows.fieldEditors.activities.activityType')} *
                      </Label>
                      <Select
                        value={activity.activityType}
                        onValueChange={(value) => updateActivity(index, 'activityType', value)}
                        disabled={disabled}
                      >
                        <SelectTrigger id={`${id}-${index}-activityType`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {activityTypeOptions.map((type) => (
                            <SelectItem key={type.value} value={type.value}>
                              {type.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {activity.activityType === 'SEND_EMAIL' && (
                        <p className="text-xs text-muted-foreground mt-1">
                          {t('workflows.activities.sendEmailSimulatedHint')}
                        </p>
                      )}
                    </div>

                    {/* Timeout */}
                    <div>
                      <Label htmlFor={`${id}-${index}-timeout`} className="text-xs font-medium mb-1">
                        {t('workflows.fieldEditors.activities.timeout')}
                      </Label>
                      <DurationInput
                        id={`${id}-${index}-timeout`}
                        value={activity.timeout || ''}
                        onChange={(value) => updateActivity(index, 'timeout', value)}
                        aria-label={t('workflows.fieldEditors.activities.timeout')}
                        disabled={disabled}
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        {t('workflows.fieldEditors.activities.timeoutHint')}
                      </p>
                    </div>

                    {/* Retry Policy */}
                    <div className="border-t border-border pt-3">
                      <Label className="text-xs font-semibold mb-2 block">{t('workflows.fieldEditors.activities.retryPolicy')}</Label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div>
                          <Label htmlFor={`${id}-${index}-maxAttempts`} className="text-xs text-gray-600 mb-1">
                            {t('workflows.fieldEditors.activities.maxAttempts')}
                          </Label>
                          <Input
                            id={`${id}-${index}-maxAttempts`}
                            type="number"
                            value={activity.retryPolicy?.maxAttempts || ''}
                            onChange={(e) => updateRetryPolicy(index, 'maxAttempts', parseInt(e.target.value) || 0)}
                            placeholder="3"
                            min="1"
                            max="10"
                            className="text-xs"
                            disabled={disabled}
                          />
                        </div>
                        <div>
                          <Label htmlFor={`${id}-${index}-initialIntervalMs`} className="text-xs text-gray-600 mb-1">
                            {t('workflows.fieldEditors.activities.initialInterval')}
                          </Label>
                          <Input
                            id={`${id}-${index}-initialIntervalMs`}
                            type="number"
                            value={activity.retryPolicy?.initialIntervalMs || ''}
                            onChange={(e) => updateRetryPolicy(index, 'initialIntervalMs', parseInt(e.target.value) || 0)}
                            placeholder="1000"
                            min="0"
                            className="text-xs"
                            disabled={disabled}
                          />
                        </div>
                        <div>
                          <Label htmlFor={`${id}-${index}-backoffCoefficient`} className="text-xs text-gray-600 mb-1">
                            {t('workflows.fieldEditors.activities.backoffCoefficient')}
                          </Label>
                          <Input
                            id={`${id}-${index}-backoffCoefficient`}
                            type="number"
                            step="0.1"
                            value={activity.retryPolicy?.backoffCoefficient || ''}
                            onChange={(e) => updateRetryPolicy(index, 'backoffCoefficient', parseFloat(e.target.value) || 1)}
                            placeholder="2"
                            min="1"
                            max="10"
                            className="text-xs"
                            disabled={disabled}
                          />
                        </div>
                        <div>
                          <Label htmlFor={`${id}-${index}-maxIntervalMs`} className="text-xs text-gray-600 mb-1">
                            {t('workflows.fieldEditors.activities.maxInterval')}
                          </Label>
                          <Input
                            id={`${id}-${index}-maxIntervalMs`}
                            type="number"
                            value={activity.retryPolicy?.maxIntervalMs || ''}
                            onChange={(e) => updateRetryPolicy(index, 'maxIntervalMs', parseInt(e.target.value) || 0)}
                            placeholder="10000"
                            min="0"
                            className="text-xs"
                            disabled={disabled}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Activity Options */}
                    <div className="border-t border-border pt-3">
                      <Label className="text-xs font-semibold mb-2 block">{t('workflows.fieldEditors.activities.activityOptions')}</Label>
                      <div className="space-y-2">
                        <div className="flex items-center space-x-2">
                          <input
                            type="checkbox"
                            id={`${id}-${index}-async`}
                            checked={activity.async || false}
                            onChange={(e) => updateActivity(index, 'async', e.target.checked)}
                            className="h-4 w-4 rounded border-gray-300"
                            disabled={disabled}
                          />
                          <Label htmlFor={`${id}-${index}-async`} className="text-xs text-gray-700 cursor-pointer">
                            {t('workflows.fieldEditors.activities.asyncOption')}
                          </Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <input
                            type="checkbox"
                            id={`${id}-${index}-compensate`}
                            checked={activity.compensate || false}
                            onChange={(e) => updateActivity(index, 'compensate', e.target.checked)}
                            className="h-4 w-4 rounded border-gray-300"
                            disabled={disabled}
                          />
                          <Label htmlFor={`${id}-${index}-compensate`} className="text-xs text-gray-700 cursor-pointer">
                            {t('workflows.fieldEditors.activities.compensateOption')}
                          </Label>
                        </div>
                      </div>
                    </div>

                    {/* Configuration */}
                    <div className="border-t border-border pt-3">
                      {hasActivityConfigForm(activity.activityType) ? (
                        <div className="space-y-3">
                          <ActivityConfigFields
                            activityType={activity.activityType}
                            idPrefix={`${id}-${index}-config`}
                            config={activity.config || {}}
                            onChange={(config) => updateActivity(index, 'config', config)}
                            ledgerEntries={ledgerEntries}
                            disabled={disabled}
                          />
                          <div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => toggleAdvanced(index)}
                              aria-expanded={advancedIndices.has(index)}
                            >
                              <ChevronDown
                                className={`size-4 mr-1 transition-transform ${advancedIndices.has(index) ? 'rotate-180' : ''}`}
                              />
                              {t('workflows.fieldEditors.activities.advancedJson')}
                            </Button>
                            {advancedIndices.has(index) && (
                              <div className="mt-2">
                                <JsonBuilder
                                  value={activity.config || {}}
                                  onChange={(config) => updateActivity(index, 'config', config)}
                                  disabled={disabled}
                                />
                                <p className="text-xs text-muted-foreground mt-1">
                                  {t('workflows.fieldEditors.activities.configurationHint')}
                                </p>
                              </div>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div>
                          <Label className="text-xs font-medium mb-1">
                            {t('workflows.fieldEditors.activities.configurationJson')}
                          </Label>
                          <JsonBuilder
                            value={activity.config || {}}
                            onChange={(config) => updateActivity(index, 'config', config)}
                            disabled={disabled}
                          />
                          <p className="text-xs text-muted-foreground mt-1">
                            {t('workflows.fieldEditors.activities.configurationHint')}
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Test step */}
                    {testContext && (
                      <div className="border-t border-border pt-3">
                        <ActivityTestPanel
                          definitionId={testContext.definitionId}
                          stepId={testContext.stepId}
                          activityType={activity.activityType}
                          config={activity.config || {}}
                          ledgerEntries={ledgerEntries}
                          pinnedSample={testContext.pinnedSample}
                          onPinSample={testContext.onPinSample}
                          onUnpinSample={testContext.onUnpinSample}
                          disabled={disabled}
                        />
                      </div>
                    )}

                    {/* Delete Button */}
                    <div className="border-t border-border pt-3">
                      <Button
                        type="button"
                        variant="destructive-outline"
                        size="sm"
                        onClick={() => removeActivity(index)}
                        disabled={disabled}
                      >
                        <Trash2 className="size-4 mr-1" />
                        {t('workflows.fieldEditors.activities.removeActivity')}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
      {ConfirmDialogElement}
    </div>
  )
}
