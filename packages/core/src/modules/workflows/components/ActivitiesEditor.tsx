"use client"

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { Trash2, Plus, ChevronUp, ChevronDown } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { ConfigJsonTextarea } from './ConfigJsonTextarea'
import { useActivityTypeOptions } from './fields/useActivityTypeOptions'

interface Activity {
  activityId: string
  activityName: string
  activityType: string
  config?: Record<string, any>
  async?: boolean
  retryPolicy?: {
    maxAttempts?: number
    initialIntervalMs?: number
    backoffCoefficient?: number
    maxIntervalMs?: number
  }
  // Milliseconds, matching the executor and the definition schema. This field
  // used to be written as `timeout` (a number) while the schema typed `timeout`
  // as an ISO 8601 string, so saving a timeout from this editor failed
  // validation outright (#4424).
  timeoutMs?: number
  compensation?: Record<string, any>
}

interface ActivitiesEditorProps {
  value: Activity[]
  onChange: (activities: Activity[]) => void
  onInvalidActivityConfigsChange?: (activityLabels: string[]) => void
  error?: string
}

function resolveActivityLabel(activity: { activityName?: string; activityId?: string } | undefined, index: number): string {
  return activity?.activityName || activity?.activityId || String(index + 1)
}

export function ActivitiesEditor({ value = [], onChange, onInvalidActivityConfigsChange, error }: ActivitiesEditorProps) {
  const t = useT()
  const activityTypeOptions = useActivityTypeOptions()
  const [invalidConfigIndexes, setInvalidConfigIndexes] = React.useState<ReadonlySet<number>>(() => new Set())
  const lastReportedLabelsRef = React.useRef<string>('')

  const handleConfigValidityChange = React.useCallback((index: number, valid: boolean) => {
    setInvalidConfigIndexes((prev) => {
      if (prev.has(index) === !valid) return prev
      const next = new Set(prev)
      if (valid) next.delete(index)
      else next.add(index)
      return next
    })
  }, [])

  React.useEffect(() => {
    setInvalidConfigIndexes((prev) => {
      const next = new Set(
        [...prev].filter((index) => index < value.length && value[index]?.activityType !== 'WAIT'),
      )
      return next.size === prev.size ? prev : next
    })
  }, [value])

  React.useEffect(() => {
    if (!onInvalidActivityConfigsChange) return
    const labels = [...invalidConfigIndexes]
      .sort((left, right) => left - right)
      .map((index) => resolveActivityLabel(value[index], index))
    const serializedLabels = JSON.stringify(labels)
    if (serializedLabels === lastReportedLabelsRef.current) return
    lastReportedLabelsRef.current = serializedLabels
    onInvalidActivityConfigsChange(labels)
  }, [invalidConfigIndexes, value, onInvalidActivityConfigsChange])

  const addActivity = () => {
    const newActivity: Activity = {
      activityId: `activity_${Date.now()}`,
      activityName: t('workflows.common.newActivity'),
      activityType: 'CALL_API',
      config: {},
      async: false,
      retryPolicy: {
        maxAttempts: 3,
        initialIntervalMs: 1000,
        backoffCoefficient: 2,
        maxIntervalMs: 10000,
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            {t('workflows.form.descriptions.activities')}
          </p>
          {error && <p className="text-sm text-status-error-text mt-1">{error}</p>}
        </div>
        <Button type="button" onClick={addActivity} variant="outline" size="sm" className="w-full sm:w-auto">
          <Plus className="h-4 w-4 mr-1" />
          {t('workflows.form.addActivity')}
        </Button>
      </div>

      {value.length === 0 && (
        <div className="p-6 text-center text-muted-foreground border rounded-md bg-muted">
          {t('workflows.form.noActivities')}
        </div>
      )}

      <div className="space-y-3">
        {value.map((activity, index) => (
          <div key={index} className="p-4 border rounded-md bg-card shadow-sm border-l-4 border-l-green-500">
            <div className="space-y-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                      placeholder={t('workflows.activities.activityName')}
                      className="mt-1"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-1 self-end sm:self-auto">
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
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <Label htmlFor={`activity-${index}-type`} className="text-xs">
                    {t('workflows.activities.activityType')} *
                  </Label>
                  <Select
                    value={activity.activityType}
                    onValueChange={(value) => updateActivity(index, 'activityType', value)}
                  >
                    <SelectTrigger id={`activity-${index}-type`} className="mt-1">
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
                </div>
                <div>
                  <Label htmlFor={`activity-${index}-timeout`} className="text-xs">
                    {t('workflows.activities.timeout')} (ms)
                  </Label>
                  <Input
                    id={`activity-${index}-timeout`}
                    type="number"
                    value={activity.timeoutMs || ''}
                    onChange={(e) => updateActivity(index, 'timeoutMs', e.target.value ? parseInt(e.target.value) : undefined)}
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

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label htmlFor={`activity-${index}-retry-attempts`} className="text-xs">
                    {t('workflows.form.maxRetryAttempts')}
                  </Label>
                  <Input
                    id={`activity-${index}-retry-attempts`}
                    type="number"
                    min="1"
                    max="10"
                    value={activity.retryPolicy?.maxAttempts || 3}
                    onChange={(e) => updateRetryPolicy(index, 'maxAttempts', parseInt(e.target.value))}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor={`activity-${index}-initial-interval`} className="text-xs">
                    {t('workflows.fieldEditors.activities.initialInterval')}
                  </Label>
                  <Input
                    id={`activity-${index}-initial-interval`}
                    type="number"
                    min="0"
                    value={activity.retryPolicy?.initialIntervalMs || 1000}
                    onChange={(e) => updateRetryPolicy(index, 'initialIntervalMs', parseInt(e.target.value))}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor={`activity-${index}-backoff`} className="text-xs">
                    {t('workflows.fieldEditors.activities.backoffCoefficient')}
                  </Label>
                  <Input
                    id={`activity-${index}-backoff`}
                    type="number"
                    step="0.1"
                    min="1"
                    max="10"
                    value={activity.retryPolicy?.backoffCoefficient || 2}
                    onChange={(e) => updateRetryPolicy(index, 'backoffCoefficient', parseFloat(e.target.value))}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor={`activity-${index}-max-interval`} className="text-xs">
                    {t('workflows.fieldEditors.activities.maxInterval')}
                  </Label>
                  <Input
                    id={`activity-${index}-max-interval`}
                    type="number"
                    min="0"
                    value={activity.retryPolicy?.maxIntervalMs || 10000}
                    onChange={(e) => updateRetryPolicy(index, 'maxIntervalMs', parseInt(e.target.value))}
                    className="mt-1"
                  />
                </div>
              </div>

              {activity.activityType === 'WAIT' && (
                <div className="space-y-3">
                  <div>
                    <Label htmlFor={`activity-${index}-duration`} className="text-xs">
                      {t('workflows.activities.waitDuration')}
                    </Label>
                    <Input
                      id={`activity-${index}-duration`}
                      value={activity.config?.duration || ''}
                      onChange={(e) => updateActivity(index, 'config', { ...activity.config, duration: e.target.value, until: undefined })}
                      placeholder={t('workflows.activities.waitDurationPlaceholder')}
                      disabled={!!activity.config?.until}
                      className="mt-1"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      {t('workflows.activities.waitDurationDescription')}
                    </p>
                  </div>
                  <div className="text-xs text-center text-muted-foreground">{t('workflows.activities.waitOr')}</div>
                  <div>
                    <Label htmlFor={`activity-${index}-until`} className="text-xs">
                      {t('workflows.activities.waitUntil')}
                    </Label>
                    <Input
                      id={`activity-${index}-until`}
                      type="datetime-local"
                      value={activity.config?.until ? activity.config.until.slice(0, 16) : ''}
                      onChange={(e) => updateActivity(index, 'config', { ...activity.config, until: e.target.value ? new Date(e.target.value).toISOString() : undefined, duration: undefined })}
                      disabled={!!activity.config?.duration}
                      className="mt-1"
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      {t('workflows.activities.waitUntilDescription')}
                    </p>
                  </div>
                </div>
              )}

              {activity.activityType === 'SEND_EMAIL' && (
                <p className="text-xs text-muted-foreground">
                  {t('workflows.activities.sendEmailSimulatedHint')}
                </p>
              )}

              {activity.activityType !== 'WAIT' && (
              <div>
                <Label htmlFor={`activity-${index}-config`} className="text-xs">
                  {t('workflows.activities.config')} (JSON)
                </Label>
                <ConfigJsonTextarea
                  id={`activity-${index}-config`}
                  value={activity.config}
                  onChange={(config) => updateActivity(index, 'config', config)}
                  onValidityChange={(valid) => handleConfigValidityChange(index, valid)}
                  rows={3}
                  className="mt-1 font-mono text-xs"
                />
              </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
