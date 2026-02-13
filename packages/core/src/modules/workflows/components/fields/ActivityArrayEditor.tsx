'use client'

import { useState } from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { Button } from '@open-mercato/ui/primitives/button'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { ChevronDown, Plus, Trash2 } from 'lucide-react'
import { JsonBuilder } from '@open-mercato/ui/backend/JsonBuilder'
import type { CrudCustomFieldRenderProps } from '@open-mercato/ui/backend/CrudForm'

/**
 * Activity definition structure
 */
export interface Activity {
  activityId: string
  activityName: string
  activityType: 'SEND_EMAIL' | 'CALL_API' | 'UPDATE_ENTITY' | 'EMIT_EVENT' | 'CALL_WEBHOOK' | 'EXECUTE_FUNCTION' | 'WAIT'
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

interface ActivityArrayEditorProps extends CrudCustomFieldRenderProps {
  value: Activity[]
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
export function ActivityArrayEditor({ id, value = [], error, setValue, disabled }: ActivityArrayEditorProps) {
  const t = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const [expandedIndices, setExpandedIndices] = useState<Set<number>>(new Set())

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
                      <select
                        id={`${id}-${index}-activityType`}
                        value={activity.activityType}
                        onChange={(e) => updateActivity(index, 'activityType', e.target.value)}
                        className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        disabled={disabled}
                      >
                        <option value="SEND_EMAIL">{t('workflows.activities.types.SEND_EMAIL')}</option>
                        <option value="CALL_API">{t('workflows.activities.types.CALL_API')}</option>
                        <option value="UPDATE_ENTITY">{t('workflows.activities.types.UPDATE_ENTITY')}</option>
                        <option value="EMIT_EVENT">{t('workflows.activities.types.EMIT_EVENT')}</option>
                        <option value="CALL_WEBHOOK">{t('workflows.activities.types.CALL_WEBHOOK')}</option>
                        <option value="EXECUTE_FUNCTION">{t('workflows.activities.types.EXECUTE_FUNCTION')}</option>
                        <option value="WAIT">{t('workflows.activities.types.WAIT')}</option>
                      </select>
                    </div>

                    {/* Timeout */}
                    <div>
                      <Label htmlFor={`${id}-${index}-timeout`} className="text-xs font-medium mb-1">
                        {t('workflows.fieldEditors.activities.timeout')}
                      </Label>
                      <Input
                        id={`${id}-${index}-timeout`}
                        type="text"
                        value={activity.timeout || ''}
                        onChange={(e) => updateActivity(index, 'timeout', e.target.value)}
                        placeholder={t('workflows.fieldEditors.activities.timeoutPlaceholder')}
                        className="text-xs"
                        disabled={disabled}
                      />
                      <p className="text-xs text-muted-foreground mt-1">
                        {t('workflows.fieldEditors.activities.timeoutHint')}
                      </p>
                    </div>

                    {/* Retry Policy */}
                    <div className="border-t border-gray-200 pt-3">
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
                    <div className="border-t border-gray-200 pt-3">
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

                    {/* Configuration JSON */}
                    <div className="border-t border-gray-200 pt-3">
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

                    {/* Delete Button */}
                    <div className="border-t border-gray-200 pt-3">
                      <Button
                        type="button"
                        variant="destructive"
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
