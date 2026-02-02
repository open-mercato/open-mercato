"use client"

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
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
  timeout?: number
  compensation?: Record<string, any>
}

interface Transition {
  transitionId: string
  transitionName: string
  fromStepId: string
  toStepId: string
  trigger: string
  preConditions?: string[]
  postConditions?: string[]
  activities?: Activity[]
  priority?: number
}

interface TransitionsEditorProps {
  value: Transition[]
  onChange: (transitions: Transition[]) => void
  steps?: any[]
  error?: string
}

const TRIGGER_TYPES = [
  { value: 'auto', label: 'Automatic' },
  { value: 'manual', label: 'Manual' },
  { value: 'signal', label: 'Signal' },
  { value: 'timer', label: 'Timer' },
]

const ACTIVITY_TYPES = [
  { value: 'SEND_EMAIL', label: 'Send Email' },
  { value: 'CALL_API', label: 'Call API' },
  { value: 'UPDATE_ENTITY', label: 'Update Entity' },
  { value: 'EMIT_EVENT', label: 'Emit Event' },
  { value: 'CALL_WEBHOOK', label: 'Call Webhook' },
  { value: 'EXECUTE_FUNCTION', label: 'Execute Function' },
  { value: 'WAIT', label: 'Wait' },
]

export function TransitionsEditor({ value = [], onChange, steps = [], error }: TransitionsEditorProps) {
  const t = useT()

  const addTransition = () => {
    const newTransition: Transition = {
      transitionId: `transition_${Date.now()}`,
      transitionName: 'New Transition',
      fromStepId: '',
      toStepId: '',
      trigger: 'auto',
      preConditions: [],
      postConditions: [],
      activities: [],
      priority: 100,
    }
    onChange([...value, newTransition])
  }

  const updateTransition = (index: number, field: keyof Transition, fieldValue: any) => {
    const updated = [...value]
    updated[index] = { ...updated[index], [field]: fieldValue }
    onChange(updated)
  }

  const removeTransition = (index: number) => {
    onChange(value.filter((_, i) => i !== index))
  }

  const moveTransition = (index: number, direction: 'up' | 'down') => {
    const newIndex = direction === 'up' ? index - 1 : index + 1
    if (newIndex < 0 || newIndex >= value.length) return

    const updated = [...value]
    const temp = updated[index]
    updated[index] = updated[newIndex]
    updated[newIndex] = temp
    onChange(updated)
  }

  const addActivity = (transitionIndex: number) => {
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
    const updated = [...value]
    updated[transitionIndex] = {
      ...updated[transitionIndex],
      activities: [...(updated[transitionIndex].activities || []), newActivity],
    }
    onChange(updated)
  }

  const updateActivity = (transitionIndex: number, activityIndex: number, field: keyof Activity, fieldValue: any) => {
    const updated = [...value]
    const activities = [...(updated[transitionIndex].activities || [])]
    activities[activityIndex] = { ...activities[activityIndex], [field]: fieldValue }
    updated[transitionIndex] = { ...updated[transitionIndex], activities }
    onChange(updated)
  }

  const updateRetryPolicy = (transitionIndex: number, activityIndex: number, field: string, fieldValue: any) => {
    const updated = [...value]
    const activities = [...(updated[transitionIndex].activities || [])]
    activities[activityIndex] = {
      ...activities[activityIndex],
      retryPolicy: {
        ...activities[activityIndex].retryPolicy,
        [field]: fieldValue,
      },
    }
    updated[transitionIndex] = { ...updated[transitionIndex], activities }
    onChange(updated)
  }

  const removeActivity = (transitionIndex: number, activityIndex: number) => {
    const updated = [...value]
    updated[transitionIndex] = {
      ...updated[transitionIndex],
      activities: (updated[transitionIndex].activities || []).filter((_, i) => i !== activityIndex),
    }
    onChange(updated)
  }

  const moveActivity = (transitionIndex: number, activityIndex: number, direction: 'up' | 'down') => {
    const activities = value[transitionIndex].activities || []
    const newIndex = direction === 'up' ? activityIndex - 1 : activityIndex + 1
    if (newIndex < 0 || newIndex >= activities.length) return

    const updated = [...value]
    const updatedActivities = [...activities]
    const temp = updatedActivities[activityIndex]
    updatedActivities[activityIndex] = updatedActivities[newIndex]
    updatedActivities[newIndex] = temp
    updated[transitionIndex] = { ...updated[transitionIndex], activities: updatedActivities }
    onChange(updated)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            {t('workflows.form.descriptions.transitions')}
          </p>
          {error && <p className="text-sm text-red-600 mt-1">{error}</p>}
        </div>
        <Button type="button" onClick={addTransition} variant="outline" size="sm">
          <Plus className="h-4 w-4 mr-1" />
          {t('workflows.form.addTransition')}
        </Button>
      </div>

      {value.length === 0 && (
        <div className="p-6 text-center text-muted-foreground border rounded-md bg-muted">
          {t('workflows.form.noTransitions')}
        </div>
      )}

      <div className="space-y-3">
        {value.map((transition, index) => (
          <div key={index} className="p-4 border rounded-md bg-card shadow-sm border-l-4 border-l-blue-500">
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor={`transition-${index}-id`} className="text-xs">
                      {t('workflows.transitions.transitionId')} *
                    </Label>
                    <Input
                      id={`transition-${index}-id`}
                      value={transition.transitionId}
                      onChange={(e) => updateTransition(index, 'transitionId', e.target.value)}
                      placeholder="transition_name"
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label htmlFor={`transition-${index}-name`} className="text-xs">
                      {t('workflows.transitions.transitionName')} *
                    </Label>
                    <Input
                      id={`transition-${index}-name`}
                      value={transition.transitionName}
                      onChange={(e) => updateTransition(index, 'transitionName', e.target.value)}
                      placeholder="Transition Name"
                      className="mt-1"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => moveTransition(index, 'up')}
                    disabled={index === 0}
                    title={t('common.moveUp')}
                  >
                    <ChevronUp className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => moveTransition(index, 'down')}
                    disabled={index === value.length - 1}
                    title={t('common.moveDown')}
                  >
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeTransition(index)}
                    title={t('common.delete')}
                  >
                    <Trash2 className="h-4 w-4 text-red-600" />
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <Label htmlFor={`transition-${index}-from`} className="text-xs">
                    {t('workflows.transitions.fromStep')} *
                  </Label>
                  <select
                    id={`transition-${index}-from`}
                    value={transition.fromStepId}
                    onChange={(e) => updateTransition(index, 'fromStepId', e.target.value)}
                    className="mt-1 w-full px-3 py-2 border border-border rounded-md text-sm"
                  >
                    <option value="">{t('workflows.form.selectStep')}</option>
                    {steps.map((step: any) => (
                      <option key={step.stepId} value={step.stepId}>
                        {step.stepName || step.stepId}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label htmlFor={`transition-${index}-to`} className="text-xs">
                    {t('workflows.transitions.toStep')} *
                  </Label>
                  <select
                    id={`transition-${index}-to`}
                    value={transition.toStepId}
                    onChange={(e) => updateTransition(index, 'toStepId', e.target.value)}
                    className="mt-1 w-full px-3 py-2 border border-border rounded-md text-sm"
                  >
                    <option value="">{t('workflows.form.selectStep')}</option>
                    {steps.map((step: any) => (
                      <option key={step.stepId} value={step.stepId}>
                        {step.stepName || step.stepId}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label htmlFor={`transition-${index}-trigger`} className="text-xs">
                    {t('workflows.transitions.trigger')} *
                  </Label>
                  <select
                    id={`transition-${index}-trigger`}
                    value={transition.trigger}
                    onChange={(e) => updateTransition(index, 'trigger', e.target.value)}
                    className="mt-1 w-full px-3 py-2 border border-border rounded-md text-sm"
                  >
                    {TRIGGER_TYPES.map((type) => (
                      <option key={type.value} value={type.value}>
                        {t(`workflows.transitions.triggers.${type.value}`)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label htmlFor={`transition-${index}-priority`} className="text-xs">
                    {t('workflows.transitions.priority')}
                  </Label>
                  <Input
                    id={`transition-${index}-priority`}
                    type="number"
                    value={transition.priority || 100}
                    onChange={(e) => updateTransition(index, 'priority', parseInt(e.target.value))}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor={`transition-${index}-preconditions`} className="text-xs">
                    {t('workflows.transitions.preConditions')}
                  </Label>
                  <Input
                    id={`transition-${index}-preconditions`}
                    value={(transition.preConditions || []).join(', ')}
                    onChange={(e) => updateTransition(index, 'preConditions', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                    placeholder="rule_id_1, rule_id_2"
                    className="mt-1"
                  />
                </div>
              </div>

              <div className="mt-4 pl-4 border-l-2 border-border">
                <div className="flex items-center justify-between mb-3">
                  <Label className="text-xs font-semibold text-foreground">
                    {t('workflows.transitions.activities')}
                  </Label>
                  <Button
                    type="button"
                    onClick={() => addActivity(index)}
                    variant="outline"
                    size="sm"
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    {t('workflows.form.addActivity')}
                  </Button>
                </div>

                {(transition.activities || []).length === 0 && (
                  <div className="p-3 text-center text-xs text-muted-foreground border rounded-md bg-muted">
                    {t('workflows.form.noActivitiesInTransition')}
                  </div>
                )}

                <div className="space-y-2">
                  {(transition.activities || []).map((activity, activityIndex) => (
                    <div key={activityIndex} className="p-3 border rounded-md bg-muted shadow-sm border-l-4 border-l-green-500">
                      <div className="space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <div>
                              <Label htmlFor={`activity-${index}-${activityIndex}-id`} className="text-xs">
                                {t('workflows.activities.activityId')} *
                              </Label>
                              <Input
                                id={`activity-${index}-${activityIndex}-id`}
                                value={activity.activityId}
                                onChange={(e) => updateActivity(index, activityIndex, 'activityId', e.target.value)}
                                placeholder="activity_name"
                                className="mt-1 text-xs h-8"
                              />
                            </div>
                            <div>
                              <Label htmlFor={`activity-${index}-${activityIndex}-name`} className="text-xs">
                                {t('workflows.activities.activityName')} *
                              </Label>
                              <Input
                                id={`activity-${index}-${activityIndex}-name`}
                                value={activity.activityName}
                                onChange={(e) => updateActivity(index, activityIndex, 'activityName', e.target.value)}
                                placeholder="Activity Name"
                                className="mt-1 text-xs h-8"
                              />
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => moveActivity(index, activityIndex, 'up')}
                              disabled={activityIndex === 0}
                              title={t('common.moveUp')}
                            >
                              <ChevronUp className="h-3 w-3" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => moveActivity(index, activityIndex, 'down')}
                              disabled={activityIndex === (transition.activities || []).length - 1}
                              title={t('common.moveDown')}
                            >
                              <ChevronDown className="h-3 w-3" />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => removeActivity(index, activityIndex)}
                              title={t('common.delete')}
                            >
                              <Trash2 className="h-3 w-3 text-red-600" />
                            </Button>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                          <div>
                            <Label htmlFor={`activity-${index}-${activityIndex}-type`} className="text-xs">
                              {t('workflows.activities.activityType')} *
                            </Label>
                            <select
                              id={`activity-${index}-${activityIndex}-type`}
                              value={activity.activityType}
                              onChange={(e) => updateActivity(index, activityIndex, 'activityType', e.target.value)}
                              className="mt-1 w-full px-2 py-1 border border-border rounded-md text-xs h-8"
                            >
                              {ACTIVITY_TYPES.map((type) => (
                                <option key={type.value} value={type.value}>
                                  {t(`workflows.activities.types.${type.value}`)}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <Label htmlFor={`activity-${index}-${activityIndex}-timeout`} className="text-xs">
                              {t('workflows.activities.timeout')} (ms)
                            </Label>
                            <Input
                              id={`activity-${index}-${activityIndex}-timeout`}
                              type="number"
                              value={activity.timeout || ''}
                              onChange={(e) => updateActivity(index, activityIndex, 'timeout', e.target.value ? parseInt(e.target.value) : undefined)}
                              placeholder="30000"
                              className="mt-1 text-xs h-8"
                            />
                          </div>
                          <div className="flex items-end pb-1">
                            <div className="flex items-center space-x-2">
                              <input
                                type="checkbox"
                                id={`activity-${index}-${activityIndex}-async`}
                                checked={activity.async || false}
                                onChange={(e) => updateActivity(index, activityIndex, 'async', e.target.checked)}
                                className="h-3 w-3"
                              />
                              <Label htmlFor={`activity-${index}-${activityIndex}-async`} className="text-xs cursor-pointer">
                                {t('workflows.activities.async')}
                              </Label>
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <Label htmlFor={`activity-${index}-${activityIndex}-retry-attempts`} className="text-xs">
                              {t('workflows.form.maxRetryAttempts')}
                            </Label>
                            <Input
                              id={`activity-${index}-${activityIndex}-retry-attempts`}
                              type="number"
                              value={activity.retryPolicy?.maxAttempts || 3}
                              onChange={(e) => updateRetryPolicy(index, activityIndex, 'maxAttempts', parseInt(e.target.value))}
                              className="mt-1 text-xs h-8"
                            />
                          </div>
                          <div>
                            <Label htmlFor={`activity-${index}-${activityIndex}-retry-delay`} className="text-xs">
                              {t('workflows.form.retryDelay')} (ms)
                            </Label>
                            <Input
                              id={`activity-${index}-${activityIndex}-retry-delay`}
                              type="number"
                              value={activity.retryPolicy?.retryDelay || 1000}
                              onChange={(e) => updateRetryPolicy(index, activityIndex, 'retryDelay', parseInt(e.target.value))}
                              className="mt-1 text-xs h-8"
                            />
                          </div>
                          <div>
                            <Label htmlFor={`activity-${index}-${activityIndex}-backoff`} className="text-xs">
                              {t('workflows.form.backoffMultiplier')}
                            </Label>
                            <Input
                              id={`activity-${index}-${activityIndex}-backoff`}
                              type="number"
                              step="0.1"
                              value={activity.retryPolicy?.backoffMultiplier || 2}
                              onChange={(e) => updateRetryPolicy(index, activityIndex, 'backoffMultiplier', parseFloat(e.target.value))}
                              className="mt-1 text-xs h-8"
                            />
                          </div>
                        </div>

                        <div>
                          <Label htmlFor={`activity-${index}-${activityIndex}-config`} className="text-xs">
                            {t('workflows.activities.config')} (JSON)
                          </Label>
                          <Textarea
                            id={`activity-${index}-${activityIndex}-config`}
                            value={JSON.stringify(activity.config || {}, null, 2)}
                            onChange={(e) => {
                              try {
                                const parsed = JSON.parse(e.target.value)
                                updateActivity(index, activityIndex, 'config', parsed)
                              } catch {
                                // Invalid JSON, don't update
                              }
                            }}
                            placeholder='{"key": "value"}'
                            rows={2}
                            className="mt-1 font-mono text-xs"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
