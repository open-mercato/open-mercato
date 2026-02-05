"use client"

import * as React from 'react'
import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { Label } from '@open-mercato/ui/primitives/label'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { Badge } from '@open-mercato/ui/primitives/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { EventSelect } from '@open-mercato/ui/backend/inputs/EventSelect'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Plus, Trash2, Edit2, Zap, AlertCircle, X } from 'lucide-react'

interface EventTrigger {
  id: string
  name: string
  description?: string | null
  eventPattern: string
  config?: {
    filterConditions?: Array<{
      field: string
      operator: string
      value: unknown
    }>
    contextMapping?: Array<{
      targetKey: string
      sourceExpression: string
      defaultValue?: unknown
    }>
    debounceMs?: number
    maxConcurrentInstances?: number
  } | null
  enabled: boolean
  priority: number
  workflowDefinitionId: string
  createdAt: string
  updatedAt: string
}

interface EventTriggersEditorProps {
  workflowDefinitionId: string
  workflowId?: string
  className?: string
}

const FILTER_OPERATOR_KEYS = [
  'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'startsWith',
  'endsWith', 'in', 'notIn', 'exists', 'notExists', 'regex',
] as const

type TriggerFormValues = {
  name: string
  description: string
  eventPattern: string
  enabled: boolean
  priority: number
  filterConditions: Array<{ field: string; operator: string; value: string }>
  contextMappings: Array<{ targetKey: string; sourceExpression: string; defaultValue: string }>
  debounceMs: string
  maxConcurrentInstances: string
}

const defaultFormValues: TriggerFormValues = {
  name: '',
  description: '',
  eventPattern: '',
  enabled: true,
  priority: 0,
  filterConditions: [],
  contextMappings: [],
  debounceMs: '',
  maxConcurrentInstances: '',
}

export function EventTriggersEditor({
  workflowDefinitionId,
  workflowId,
  className,
}: EventTriggersEditorProps) {
  const t = useT()
  const queryClient = useQueryClient()
  const [showDialog, setShowDialog] = useState(false)
  const [editingTrigger, setEditingTrigger] = useState<EventTrigger | null>(null)
  const [formValues, setFormValues] = useState<TriggerFormValues>(defaultFormValues)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  // Fetch triggers for this workflow definition
  const { data: triggersData, isLoading } = useQuery({
    queryKey: ['workflow-triggers', workflowDefinitionId],
    queryFn: async () => {
      const result = await apiCall<{ data: EventTrigger[]; pagination: any }>(
        `/api/workflows/triggers?workflowDefinitionId=${workflowDefinitionId}&limit=100`
      )
      if (!result.ok) {
        throw new Error(t('workflows.triggers.messages.loadFailed'))
      }
      return result.result?.data || []
    },
    enabled: !!workflowDefinitionId,
  })

  const triggers = triggersData || []

  // Create trigger mutation
  const createMutation = useMutation({
    mutationFn: async (values: TriggerFormValues) => {
      const payload = buildTriggerPayload(values)
      const result = await apiCall<{ data: EventTrigger; error?: string }>(
        '/api/workflows/triggers',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...payload,
            workflowDefinitionId,
          }),
        }
      )
      if (!result.ok) {
        throw new Error(result.result?.error || t('workflows.triggers.messages.createFailed'))
      }
      return result.result?.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-triggers', workflowDefinitionId] })
      flash(t('workflows.triggers.messages.created'), 'success')
      handleCloseDialog()
    },
    onError: (error: Error) => {
      flash(error.message, 'error')
    },
  })

  // Update trigger mutation
  const updateMutation = useMutation({
    mutationFn: async ({ id, values }: { id: string; values: TriggerFormValues }) => {
      const payload = buildTriggerPayload(values)
      const result = await apiCall<{ data: EventTrigger; error?: string }>(
        `/api/workflows/triggers/${id}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      )
      if (!result.ok) {
        throw new Error(result.result?.error || t('workflows.triggers.messages.updateFailed'))
      }
      return result.result?.data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-triggers', workflowDefinitionId] })
      flash(t('workflows.triggers.messages.updated'), 'success')
      handleCloseDialog()
    },
    onError: (error: Error) => {
      flash(error.message, 'error')
    },
  })

  // Delete trigger mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const result = await apiCall<{ error?: string }>(
        `/api/workflows/triggers/${id}`,
        { method: 'DELETE' }
      )
      if (!result.ok) {
        throw new Error(result.result?.error || t('workflows.triggers.messages.deleteFailed'))
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflow-triggers', workflowDefinitionId] })
      flash(t('workflows.triggers.messages.deleted'), 'success')
      setDeleteConfirmId(null)
    },
    onError: (error: Error) => {
      flash(error.message, 'error')
    },
  })

  // Build API payload from form values
  const buildTriggerPayload = useCallback((values: TriggerFormValues) => {
    const config: EventTrigger['config'] = {}

    if (values.filterConditions.length > 0) {
      config.filterConditions = values.filterConditions.map(fc => ({
        field: fc.field,
        operator: fc.operator,
        value: parseConditionValue(fc.value),
      }))
    }

    if (values.contextMappings.length > 0) {
      config.contextMapping = values.contextMappings.map(cm => ({
        targetKey: cm.targetKey,
        sourceExpression: cm.sourceExpression,
        defaultValue: cm.defaultValue ? parseConditionValue(cm.defaultValue) : undefined,
      }))
    }

    if (values.debounceMs) {
      config.debounceMs = parseInt(values.debounceMs, 10)
    }

    if (values.maxConcurrentInstances) {
      config.maxConcurrentInstances = parseInt(values.maxConcurrentInstances, 10)
    }

    return {
      name: values.name,
      description: values.description || null,
      eventPattern: values.eventPattern,
      enabled: values.enabled,
      priority: values.priority,
      config: Object.keys(config).length > 0 ? config : null,
    }
  }, [])

  // Parse condition value (try JSON, fallback to string)
  const parseConditionValue = (value: string): unknown => {
    try {
      return JSON.parse(value)
    } catch {
      return value
    }
  }

  // Open dialog for creating new trigger
  const handleCreateNew = useCallback(() => {
    setEditingTrigger(null)
    setFormValues(defaultFormValues)
    setShowDialog(true)
  }, [])

  // Open dialog for editing trigger
  const handleEdit = useCallback((trigger: EventTrigger) => {
    setEditingTrigger(trigger)
    setFormValues({
      name: trigger.name,
      description: trigger.description || '',
      eventPattern: trigger.eventPattern,
      enabled: trigger.enabled,
      priority: trigger.priority,
      filterConditions: trigger.config?.filterConditions?.map(fc => ({
        field: fc.field,
        operator: fc.operator,
        value: typeof fc.value === 'string' ? fc.value : JSON.stringify(fc.value),
      })) || [],
      contextMappings: trigger.config?.contextMapping?.map(cm => ({
        targetKey: cm.targetKey,
        sourceExpression: cm.sourceExpression,
        defaultValue: cm.defaultValue !== undefined
          ? (typeof cm.defaultValue === 'string' ? cm.defaultValue : JSON.stringify(cm.defaultValue))
          : '',
      })) || [],
      debounceMs: trigger.config?.debounceMs?.toString() || '',
      maxConcurrentInstances: trigger.config?.maxConcurrentInstances?.toString() || '',
    })
    setShowDialog(true)
  }, [])

  // Close dialog
  const handleCloseDialog = useCallback(() => {
    setShowDialog(false)
    setEditingTrigger(null)
    setFormValues(defaultFormValues)
  }, [])

  // Submit form
  const handleSubmit = useCallback(() => {
    if (!formValues.name.trim()) {
      flash(t('workflows.triggers.messages.nameRequired'), 'error')
      return
    }
    if (!formValues.eventPattern.trim()) {
      flash(t('workflows.triggers.messages.eventPatternRequired'), 'error')
      return
    }

    if (editingTrigger) {
      updateMutation.mutate({ id: editingTrigger.id, values: formValues })
    } else {
      createMutation.mutate(formValues)
    }
  }, [formValues, editingTrigger, createMutation, updateMutation, t])

  // Add filter condition
  const addFilterCondition = useCallback(() => {
    setFormValues(prev => ({
      ...prev,
      filterConditions: [...prev.filterConditions, { field: '', operator: 'eq', value: '' }],
    }))
  }, [])

  // Remove filter condition
  const removeFilterCondition = useCallback((index: number) => {
    setFormValues(prev => ({
      ...prev,
      filterConditions: prev.filterConditions.filter((_, i) => i !== index),
    }))
  }, [])

  // Update filter condition
  const updateFilterCondition = useCallback((index: number, field: string, value: string) => {
    setFormValues(prev => ({
      ...prev,
      filterConditions: prev.filterConditions.map((fc, i) =>
        i === index ? { ...fc, [field]: value } : fc
      ),
    }))
  }, [])

  // Add context mapping
  const addContextMapping = useCallback(() => {
    setFormValues(prev => ({
      ...prev,
      contextMappings: [...prev.contextMappings, { targetKey: '', sourceExpression: '', defaultValue: '' }],
    }))
  }, [])

  // Remove context mapping
  const removeContextMapping = useCallback((index: number) => {
    setFormValues(prev => ({
      ...prev,
      contextMappings: prev.contextMappings.filter((_, i) => i !== index),
    }))
  }, [])

  // Update context mapping
  const updateContextMapping = useCallback((index: number, field: string, value: string) => {
    setFormValues(prev => ({
      ...prev,
      contextMappings: prev.contextMappings.map((cm, i) =>
        i === index ? { ...cm, [field]: value } : cm
      ),
    }))
  }, [])

  const isSaving = createMutation.isPending || updateMutation.isPending

  return (
    <div className={className}>
      <div className="rounded-lg border bg-card p-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-amber-500" />
            <h3 className="text-sm font-semibold uppercase text-muted-foreground">{t('workflows.triggers.title')}</h3>
          </div>
          <Button size="sm" variant="outline" onClick={handleCreateNew}>
            <Plus className="w-4 h-4 mr-1" />
            {t('workflows.triggers.add')}
          </Button>
        </div>

        <p className="text-xs text-muted-foreground mb-4">
          {t('workflows.triggers.description')}
        </p>

        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Spinner className="w-6 h-6" />
          </div>
        ) : triggers.length === 0 ? (
          <Alert variant="info">
            <AlertCircle className="w-4 h-4" />
            <AlertTitle>{t('workflows.triggers.empty.title')}</AlertTitle>
            <AlertDescription>
              {t('workflows.triggers.empty.description')}
            </AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-2">
            {triggers.map(trigger => (
              <div
                key={trigger.id}
                className="flex items-center justify-between p-3 rounded-lg border bg-background hover:bg-accent/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <Badge variant={trigger.enabled ? 'default' : 'secondary'}>
                    {trigger.enabled ? t('workflows.triggers.status.active') : t('workflows.triggers.status.disabled')}
                  </Badge>
                  <div>
                    <div className="font-medium text-sm">{trigger.name}</div>
                    <code className="text-xs text-muted-foreground">{trigger.eventPattern}</code>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="ghost" onClick={() => handleEdit(trigger)}>
                    <Edit2 className="w-4 h-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setDeleteConfirmId(trigger.id)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create/Edit Dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingTrigger ? t('workflows.triggers.dialog.edit.title') : t('workflows.triggers.dialog.create.title')}
            </DialogTitle>
            <DialogDescription>
              {t('workflows.triggers.dialog.description')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Basic Info */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label htmlFor="trigger-name">{t('workflows.triggers.fields.name')} *</Label>
                <Input
                  id="trigger-name"
                  value={formValues.name}
                  onChange={e => setFormValues(prev => ({ ...prev, name: e.target.value }))}
                  placeholder={t('workflows.triggers.placeholders.name')}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="trigger-priority">{t('workflows.triggers.fields.priority')}</Label>
                <Input
                  id="trigger-priority"
                  type="number"
                  value={formValues.priority}
                  onChange={e => setFormValues(prev => ({ ...prev, priority: parseInt(e.target.value) || 0 }))}
                  placeholder="0"
                />
                <p className="text-xs text-muted-foreground">{t('workflows.triggers.hints.priority')}</p>
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="trigger-description">{t('workflows.triggers.fields.description')}</Label>
              <Textarea
                id="trigger-description"
                value={formValues.description}
                onChange={e => setFormValues(prev => ({ ...prev, description: e.target.value }))}
                placeholder={t('workflows.triggers.placeholders.description')}
                rows={2}
              />
            </div>

            {/* Event Pattern */}
            <div className="space-y-1">
              <Label htmlFor="trigger-pattern">{t('workflows.triggers.fields.eventPattern')} *</Label>
              <div className="flex gap-2">
                <Input
                  id="trigger-pattern"
                  value={formValues.eventPattern}
                  onChange={e => setFormValues(prev => ({ ...prev, eventPattern: e.target.value }))}
                  placeholder={t('workflows.triggers.placeholders.eventPattern')}
                  className="flex-1"
                />
                <EventSelect
                  value=""
                  onChange={(eventId) => setFormValues(prev => ({ ...prev, eventPattern: eventId }))}
                  placeholder={t('workflows.triggers.placeholders.quickSelect')}
                  className="w-[200px]"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {t('workflows.triggers.hints.eventPattern')}
              </p>
            </div>

            {/* Enabled Switch */}
            <div className="flex items-center gap-2">
              <Switch
                id="trigger-enabled"
                checked={formValues.enabled}
                onCheckedChange={checked => setFormValues(prev => ({ ...prev, enabled: checked }))}
              />
              <Label htmlFor="trigger-enabled">{t('workflows.triggers.fields.enabled')}</Label>
            </div>

            {/* Filter Conditions */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>{t('workflows.triggers.fields.filterConditions')}</Label>
                <Button size="sm" variant="ghost" onClick={addFilterCondition}>
                  <Plus className="w-4 h-4 mr-1" />
                  {t('workflows.triggers.addCondition')}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {t('workflows.triggers.hints.filterConditions')}
              </p>
              {formValues.filterConditions.map((fc, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Input
                    value={fc.field}
                    onChange={e => updateFilterCondition(index, 'field', e.target.value)}
                    placeholder={t('workflows.triggers.placeholders.status')}
                    className="w-1/3"
                  />
                  <select
                    value={fc.operator}
                    onChange={(e: React.ChangeEvent<HTMLSelectElement>) => updateFilterCondition(index, 'operator', e.target.value)}
                    className="h-10 w-[140px] rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                  >
                    {FILTER_OPERATOR_KEYS.map(op => (
                      <option key={op} value={op}>
                        {t(`workflows.triggers.operators.${op}`)}
                      </option>
                    ))}
                  </select>
                  <Input
                    value={fc.value}
                    onChange={e => updateFilterCondition(index, 'value', e.target.value)}
                    placeholder={t('workflows.triggers.placeholders.submitted')}
                    className="flex-1"
                  />
                  <Button size="icon" variant="ghost" onClick={() => removeFilterCondition(index)}>
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>

            {/* Context Mapping */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>{t('workflows.triggers.fields.contextMapping')}</Label>
                <Button size="sm" variant="ghost" onClick={addContextMapping}>
                  <Plus className="w-4 h-4 mr-1" />
                  {t('workflows.triggers.addMapping')}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {t('workflows.triggers.hints.contextMapping')}
              </p>
              {formValues.contextMappings.map((cm, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Input
                    value={cm.targetKey}
                    onChange={e => updateContextMapping(index, 'targetKey', e.target.value)}
                    placeholder={t('workflows.triggers.placeholders.orderId')}
                    className="w-1/3"
                  />
                  <span className="text-muted-foreground">=</span>
                  <Input
                    value={cm.sourceExpression}
                    onChange={e => updateContextMapping(index, 'sourceExpression', e.target.value)}
                    placeholder={t('workflows.triggers.placeholders.sourceExpression')}
                    className="flex-1"
                  />
                  <Input
                    value={cm.defaultValue}
                    onChange={e => updateContextMapping(index, 'defaultValue', e.target.value)}
                    placeholder={t('workflows.triggers.placeholders.defaultValue')}
                    className="w-24"
                  />
                  <Button size="icon" variant="ghost" onClick={() => removeContextMapping(index)}>
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>

            {/* Advanced Options */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label htmlFor="trigger-debounce">{t('workflows.triggers.fields.debounceMs')}</Label>
                <Input
                  id="trigger-debounce"
                  type="number"
                  value={formValues.debounceMs}
                  onChange={e => setFormValues(prev => ({ ...prev, debounceMs: e.target.value }))}
                  placeholder="0"
                />
                <p className="text-xs text-muted-foreground">{t('workflows.triggers.hints.debounce')}</p>
              </div>
              <div className="space-y-1">
                <Label htmlFor="trigger-max-concurrent">{t('workflows.triggers.fields.maxConcurrent')}</Label>
                <Input
                  id="trigger-max-concurrent"
                  type="number"
                  value={formValues.maxConcurrentInstances}
                  onChange={e => setFormValues(prev => ({ ...prev, maxConcurrentInstances: e.target.value }))}
                  placeholder={t('workflows.triggers.placeholders.unlimited')}
                />
                <p className="text-xs text-muted-foreground">{t('workflows.triggers.hints.maxConcurrent')}</p>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleCloseDialog} disabled={isSaving}>
              {t('workflows.common.cancel')}
            </Button>
            <Button onClick={handleSubmit} disabled={isSaving}>
              {isSaving ? <Spinner className="w-4 h-4 mr-2" /> : null}
              {editingTrigger ? t('workflows.common.edit') : t('workflows.common.create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteConfirmId} onOpenChange={() => setDeleteConfirmId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('workflows.triggers.delete.title')}</DialogTitle>
            <DialogDescription>
              {t('workflows.triggers.delete.description')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmId(null)}>
              {t('workflows.common.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteConfirmId && deleteMutation.mutate(deleteConfirmId)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? <Spinner className="w-4 h-4 mr-2" /> : null}
              {t('workflows.common.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
