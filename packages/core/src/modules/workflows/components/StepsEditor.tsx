"use client"

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { Trash2, Plus, ChevronUp, ChevronDown } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'

interface Step {
  stepId: string
  stepName: string
  stepType: string
  description?: string
  config?: Record<string, any>
  timeout?: number
  retryPolicy?: {
    maxAttempts?: number
    retryDelay?: number
    backoffMultiplier?: number
  }
}

interface StepsEditorProps {
  value: Step[]
  onChange: (steps: Step[]) => void
  error?: string
}

const STEP_TYPES = [
  { value: 'START', label: 'Start' },
  { value: 'END', label: 'End' },
  { value: 'USER_TASK', label: 'User Task' },
  { value: 'AUTOMATED', label: 'Automated' },
  { value: 'PARALLEL_FORK', label: 'Parallel Fork' },
  { value: 'PARALLEL_JOIN', label: 'Parallel Join' },
  { value: 'SUB_WORKFLOW', label: 'Sub-Workflow' },
  { value: 'WAIT_FOR_SIGNAL', label: 'Wait for Signal' },
  { value: 'WAIT_FOR_TIMER', label: 'Wait for Timer' },
]

export function StepsEditor({ value = [], onChange, error }: StepsEditorProps) {
  const t = useT()

  const addStep = () => {
    const newStep: Step = {
      stepId: `step_${Date.now()}`,
      stepName: 'New Step',
      stepType: 'AUTOMATED',
      description: '',
      config: {},
    }
    onChange([...value, newStep])
  }

  const updateStep = (index: number, field: keyof Step, fieldValue: any) => {
    const updated = [...value]
    updated[index] = { ...updated[index], [field]: fieldValue }
    onChange(updated)
  }

  const removeStep = (index: number) => {
    onChange(value.filter((_, i) => i !== index))
  }

  const moveStep = (index: number, direction: 'up' | 'down') => {
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
            {t('workflows.form.descriptions.steps')}
          </p>
          {error && <p className="text-sm text-red-600 mt-1">{error}</p>}
        </div>
        <Button type="button" onClick={addStep} variant="outline" size="sm">
          <Plus className="h-4 w-4 mr-1" />
          {t('workflows.form.addStep')}
        </Button>
      </div>

      {value.length === 0 && (
        <div className="p-6 text-center text-muted-foreground border rounded-md bg-muted">
          {t('workflows.form.noSteps')}
        </div>
      )}

      <div className="space-y-3">
        {value.map((step, index) => (
          <div key={index} className="p-4 border rounded-md bg-card shadow-sm">
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor={`step-${index}-id`} className="text-xs">
                      {t('workflows.steps.stepId')} *
                    </Label>
                    <Input
                      id={`step-${index}-id`}
                      value={step.stepId}
                      onChange={(e) => updateStep(index, 'stepId', e.target.value)}
                      placeholder="step_name"
                      className="mt-1"
                    />
                  </div>
                  <div>
                    <Label htmlFor={`step-${index}-name`} className="text-xs">
                      {t('workflows.steps.stepName')} *
                    </Label>
                    <Input
                      id={`step-${index}-name`}
                      value={step.stepName}
                      onChange={(e) => updateStep(index, 'stepName', e.target.value)}
                      placeholder="Step Name"
                      className="mt-1"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => moveStep(index, 'up')}
                    disabled={index === 0}
                    title={t('common.moveUp')}
                  >
                    <ChevronUp className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => moveStep(index, 'down')}
                    disabled={index === value.length - 1}
                    title={t('common.moveDown')}
                  >
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removeStep(index)}
                    title={t('common.delete')}
                  >
                    <Trash2 className="h-4 w-4 text-red-600" />
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label htmlFor={`step-${index}-type`} className="text-xs">
                    {t('workflows.steps.stepType')} *
                  </Label>
                  <select
                    id={`step-${index}-type`}
                    value={step.stepType}
                    onChange={(e) => updateStep(index, 'stepType', e.target.value)}
                    className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                  >
                    {STEP_TYPES.map((type) => (
                      <option key={type.value} value={type.value}>
                        {t(`workflows.steps.types.${type.value}`)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label htmlFor={`step-${index}-timeout`} className="text-xs">
                    {t('workflows.steps.timeout')} (ms)
                  </Label>
                  <Input
                    id={`step-${index}-timeout`}
                    type="number"
                    value={step.timeout || ''}
                    onChange={(e) => updateStep(index, 'timeout', e.target.value ? parseInt(e.target.value) : undefined)}
                    placeholder="30000"
                    className="mt-1"
                  />
                </div>
              </div>

              <div>
                <Label htmlFor={`step-${index}-description`} className="text-xs">
                  {t('workflows.steps.singular')} {t('workflows.definitions.description')}
                </Label>
                <Textarea
                  id={`step-${index}-description`}
                  value={step.description || ''}
                  onChange={(e) => updateStep(index, 'description', e.target.value)}
                  placeholder={t('workflows.form.placeholders.description')}
                  rows={2}
                  className="mt-1"
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
