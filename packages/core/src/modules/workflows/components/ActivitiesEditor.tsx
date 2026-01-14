"use client"

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { Trash2, Plus, ChevronUp, ChevronDown } from 'lucide-react'
import { useT } from '@/lib/i18n/context'

interface Activity {
  activityId: string
  activityName: string
  activityType: string
  config?: Record<string, any>
  async?: boolean
  retryPolicy?: {
    maxAttempts?: number
    retryDelay?: number
    backoffMultiplier?: number
  }
  timeout?: number
  compensation?: Record<string, any>
}

interface ActivitiesEditorProps {
  value: Activity[]
  onChange: (activities: Activity[]) => void
  error?: string
}

const ACTIVITY_TYPES = [
  { value: 'SEND_EMAIL', label: 'Send Email' },
  { value: 'CALL_API', label: 'Call API' },
  { value: 'UPDATE_ENTITY', label: 'Update Entity' },
  { value: 'EMIT_EVENT', label: 'Emit Event' },
  { value: 'CALL_WEBHOOK', label: 'Call Webhook' },
  { value: 'EXECUTE_FUNCTION', label: 'Execute Function' },
  { value: 'WAIT', label: 'Wait' },
]

export function ActivitiesEditor({ value = [], onChange, error }: ActivitiesEditorProps) {
  const t = useT()

  const addActivity = () => {
    const newActivity: Activity = {
      activityId: `activity_${Date.now()}`,
      activityName: 'New Activity',
      activityType: 'CALL_API',
      config: {},
      async: false,
      retryPolicy: {
        maxAttempts: 3,
        retryDelay: 1000,
        backoffMultiplier: 2,
      },
    }
    onChange([...value, newActivity])
  }

  const updateActivity = (index: number, field: keyof Activity, fieldValue: any) => {
    const updated = [...value]
    updated[index] = { ...updated[index], [field]: fieldValue }
    onChange(updated)
  }

  const updateRetryPolicy = (index: number, field: string, fieldValue: any) => {
    const updated = [...value]
    updated[index] = {
      ...updated[index],
      retryPolicy: {
        ...updated[index].retryPolicy,
        [field]: fieldValue,
      },
    }
    onChange(updated)
  }

  const removeActivity = (index: number) => {
    onChange(value.filter((_, i) => i !== index))
  }

  const moveActivity = (index: number, direction: 'up' | 'down') => {
    const newIndex = direction === 'up' ? index - 1 : index + 1
    if (newIndex < 0 || newIndex >= value.length) return

    const updated = [...value]
    const temp = updated[index]
    updated[index] = updated[newIndex]
    updated[newIndex] = temp
    onChange(updated)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            {t('workflows.form.descriptions.activities')}
          </p>
          {error && <p className="text-sm text-red-600 mt-1">{error}</p>}
        </div>
        <Button type="button" onClick={addActivity} variant="outline" size="sm">
          <Plus className="h-4 w-4 mr-1" />
          {t('workflows.form.addActivity')}
        </Button>
      </div>

      {value.length === 0 && (
        <div className="p-6 text-center text-muted-foreground border rounded-md bg-gray-50">
          {t('workflows.form.noActivities')}
        </div>
      )}

      <div className="space-y-3">
        {value.map((activity, index) => (
          <div key={index} className="p-4 border rounded-md bg-white shadow-sm border-l-4 border-l-green-500">
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor={`activity-${index}-id`} className="text-xs">
                      {t('workflows.activities.activityId')} *
                    </Label>
                    <Input
                      id={`activity-${index}-id`}
                      value={activity.activityId}
                      onChange={(e) => updateActivity(index, 'activityId', e.target.value)}
                      placeholder="activity_name"
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label htmlFor={`activity-${index}-name`} className="text-xs">
                      {t('workflows.activities.activityName')} *
                    </Label>
                    <Input
                      id={`activity-${index}-name`}
                      value={activity.activityName}
                      onChange={(e) => updateActivity(index, 'activityName', e.target.value)}
                      placeholder="Activity Name"
                      className="mt-1"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => moveActivity(index, 'up')}
                    disabled={index === 0}
                    title={t('common.moveUp')}
                  >
                    <ChevronUp className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => moveActivity(index, 'down')}
                    disabled={index === value.length - 1}
                    title={t('common.moveDown')}
                  >
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeActivity(index)}
                    title={t('common.delete')}
                  >
                    <Trash2 className="h-4 w-4 text-red-600" />
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label htmlFor={`activity-${index}-type`} className="text-xs">
                    {t('workflows.activities.activityType')} *
                  </Label>
                  <select
                    id={`activity-${index}-type`}
                    value={activity.activityType}
                    onChange={(e) => updateActivity(index, 'activityType', e.target.value)}
                    className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                  >
                    {ACTIVITY_TYPES.map((type) => (
                      <option key={type.value} value={type.value}>
                        {t(`workflows.activities.types.${type.value}`)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label htmlFor={`activity-${index}-timeout`} className="text-xs">
                    {t('workflows.activities.timeout')} (ms)
                  </Label>
                  <Input
                    id={`activity-${index}-timeout`}
                    type="number"
                    value={activity.timeout || ''}
                    onChange={(e) => updateActivity(index, 'timeout', e.target.value ? parseInt(e.target.value) : undefined)}
                    placeholder="30000"
                    className="mt-1"
                  />
                </div>
                <div className="flex items-end pb-2">
                  <div className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      id={`activity-${index}-async`}
                      checked={activity.async || false}
                      onChange={(e) => updateActivity(index, 'async', e.target.checked)}
                      className="h-4 w-4"
                    />
                    <Label htmlFor={`activity-${index}-async`} className="text-xs cursor-pointer">
                      {t('workflows.activities.async')}
                    </Label>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label htmlFor={`activity-${index}-retry-attempts`} className="text-xs">
                    {t('workflows.form.maxRetryAttempts')}
                  </Label>
                  <Input
                    id={`activity-${index}-retry-attempts`}
                    type="number"
                    value={activity.retryPolicy?.maxAttempts || 3}
                    onChange={(e) => updateRetryPolicy(index, 'maxAttempts', parseInt(e.target.value))}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor={`activity-${index}-retry-delay`} className="text-xs">
                    {t('workflows.form.retryDelay')} (ms)
                  </Label>
                  <Input
                    id={`activity-${index}-retry-delay`}
                    type="number"
                    value={activity.retryPolicy?.retryDelay || 1000}
                    onChange={(e) => updateRetryPolicy(index, 'retryDelay', parseInt(e.target.value))}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor={`activity-${index}-backoff`} className="text-xs">
                    {t('workflows.form.backoffMultiplier')}
                  </Label>
                  <Input
                    id={`activity-${index}-backoff`}
                    type="number"
                    step="0.1"
                    value={activity.retryPolicy?.backoffMultiplier || 2}
                    onChange={(e) => updateRetryPolicy(index, 'backoffMultiplier', parseFloat(e.target.value))}
                    className="mt-1"
                  />
                </div>
              </div>

              <div>
                <Label htmlFor={`activity-${index}-config`} className="text-xs">
                  {t('workflows.activities.config')} (JSON)
                </Label>
                <Textarea
                  id={`activity-${index}-config`}
                  value={JSON.stringify(activity.config || {}, null, 2)}
                  onChange={(e) => {
                    try {
                      const parsed = JSON.parse(e.target.value)
                      updateActivity(index, 'config', parsed)
                    } catch {
                      // Invalid JSON, don't update
                    }
                  }}
                  placeholder='{"key": "value"}'
                  rows={3}
                  className="mt-1 font-mono text-xs"
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
