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
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { Trash2, Plus, ChevronUp, ChevronDown } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'

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

/**
 * Per-activity draft of the raw JSON config text (#4234).
 *
 * The config textarea used to be controlled directly by
 * `JSON.stringify(activity.config)`, and its onChange dropped anything that
 * did not parse. Every intermediate keystroke of a hand edit is invalid JSON,
 * so the state never advanced and React re-rendered the previous serialized
 * value — the field read as frozen/non-editable right after a config was
 * pasted. Keeping the raw text locally lets the user type freely; the parsed
 * object is propagated whenever the text is valid, and an inline error is shown
 * while it is not.
 */
type ConfigDraft = { text: string; error: string | null }

function serializeConfig(config: Record<string, unknown> | undefined): string {
  return JSON.stringify(config ?? {}, null, 2)
}

export function ActivitiesEditor({ value = [], onChange, error }: ActivitiesEditorProps) {
  const t = useT()
  const [configDrafts, setConfigDrafts] = React.useState<Record<number, ConfigDraft>>({})

  const configTextFor = (index: number, activity: Activity): string =>
    configDrafts[index]?.text ?? serializeConfig(activity.config)

  const handleConfigTextChange = (index: number, text: string) => {
    let parsed: Record<string, unknown> | null = null
    let parseError: string | null = null
    try {
      const candidate = JSON.parse(text) as unknown
      if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
        parsed = candidate as Record<string, unknown>
      } else {
        parseError = t('workflows.activities.configMustBeObject', 'Config must be a JSON object')
      }
    } catch (err) {
      parseError = err instanceof Error ? err.message : t('workflows.activities.configInvalidJson', 'Invalid JSON')
    }

    setConfigDrafts((drafts) => ({ ...drafts, [index]: { text, error: parseError } }))
    if (parsed) updateActivity(index, 'config', parsed)
  }

  // Drop the raw draft once the field loses focus and its content is valid, so
  // the textarea goes back to mirroring the canonical (re-formatted) config.
  const handleConfigBlur = (index: number) => {
    setConfigDrafts((drafts) => {
      if (!drafts[index] || drafts[index].error) return drafts
      const next = { ...drafts }
      delete next[index]
      return next
    })
  }

  const addActivity = () => {
    const newActivity: Activity = {
      activityId: `activity_${Date.now()}`,
      activityName: t('workflows.common.newActivity'),
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
    // Keep the index-keyed drafts aligned with the re-indexed activities:
    // drop the removed row's draft and shift every later draft down by one,
    // otherwise a pending (invalid) draft would render over a different row.
    setConfigDrafts((drafts) => {
      const next: Record<number, ConfigDraft> = {}
      for (const key of Object.keys(drafts)) {
        const i = Number(key)
        if (i === index) continue
        next[i > index ? i - 1 : i] = drafts[i]
      }
      return next
    })
  }

  const moveActivity = (index: number, direction: 'up' | 'down') => {
    const newIndex = direction === 'up' ? index - 1 : index + 1
    if (newIndex < 0 || newIndex >= value.length) return

    const updated = [...value]
    const temp = updated[index]
    updated[index] = updated[newIndex]
    updated[newIndex] = temp
    onChange(updated)
    // Swap the two rows' drafts too, so an in-progress edit follows its activity.
    setConfigDrafts((drafts) => {
      if (!(index in drafts) && !(newIndex in drafts)) return drafts
      const next = { ...drafts }
      const atIndex = drafts[index]
      const atNew = drafts[newIndex]
      if (atNew !== undefined) next[index] = atNew
      else delete next[index]
      if (atIndex !== undefined) next[newIndex] = atIndex
      else delete next[newIndex]
      return next
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            {t('workflows.form.descriptions.activities')}
          </p>
          {error && <p className="text-sm text-red-600 mt-1">{error}</p>}
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
                    <Trash2 className="h-4 w-4 text-red-600" />
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
                      {ACTIVITY_TYPES.map((type) => (
                        <SelectItem key={type.value} value={type.value}>
                          {t(`workflows.activities.types.${type.value}`)}
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

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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

              {activity.activityType !== 'WAIT' && (
              <div>
                <Label htmlFor={`activity-${index}-config`} className="text-xs">
                  {t('workflows.activities.config')} (JSON)
                </Label>
                <Textarea
                  id={`activity-${index}-config`}
                  value={configTextFor(index, activity)}
                  onChange={(e) => handleConfigTextChange(index, e.target.value)}
                  onBlur={() => handleConfigBlur(index)}
                  aria-invalid={configDrafts[index]?.error ? true : undefined}
                  aria-describedby={configDrafts[index]?.error ? `activity-${index}-config-error` : undefined}
                  placeholder='{"key": "value"}'
                  rows={3}
                  className="mt-1 font-mono text-xs"
                />
                {configDrafts[index]?.error ? (
                  <p
                    id={`activity-${index}-config-error`}
                    className="mt-1 text-xs text-status-error-text"
                    role="alert"
                  >
                    {configDrafts[index]?.error}
                  </p>
                ) : null}
              </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
