"use client"

import * as React from 'react'
import { useState, useCallback } from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { Label } from '@open-mercato/ui/primitives/label'
import { Switch } from '@open-mercato/ui/primitives/switch'
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
import { EventPatternInput } from '@open-mercato/ui/backend/inputs/EventPatternInput'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Plus, Trash2, Edit2, Zap, Info, X } from 'lucide-react'
import type { WorkflowDefinitionTrigger } from '../data/entities'

interface DefinitionTriggersEditorProps {
  value: WorkflowDefinitionTrigger[]
  onChange: (triggers: WorkflowDefinitionTrigger[]) => void
  className?: string
}

const FILTER_OPERATORS = [
  { value: 'eq', label: 'Equals' },
  { value: 'neq', label: 'Not Equals' },
  { value: 'gt', label: 'Greater Than' },
  { value: 'gte', label: 'Greater Than or Equal' },
  { value: 'lt', label: 'Less Than' },
  { value: 'lte', label: 'Less Than or Equal' },
  { value: 'contains', label: 'Contains' },
  { value: 'startsWith', label: 'Starts With' },
  { value: 'endsWith', label: 'Ends With' },
  { value: 'in', label: 'In (array)' },
  { value: 'notIn', label: 'Not In (array)' },
  { value: 'exists', label: 'Exists' },
  { value: 'notExists', label: 'Not Exists' },
  { value: 'regex', label: 'Regex Match' },
] as const

type TriggerFormValues = {
  triggerId: string
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
  triggerId: '',
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

/**
 * DefinitionTriggersEditor
 *
 * Manages event triggers embedded in workflow definitions.
 * Works with local state - no API calls, changes are saved with the definition.
 */
export function DefinitionTriggersEditor({
  value,
  onChange,
  className,
}: DefinitionTriggersEditorProps) {
  const t = useT()
  const [showDialog, setShowDialog] = useState(false)
  const [editingTrigger, setEditingTrigger] = useState<WorkflowDefinitionTrigger | null>(null)
  const [formValues, setFormValues] = useState<TriggerFormValues>(defaultFormValues)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  // Generate trigger ID from name
  const generateTriggerId = useCallback((name: string) => {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .substring(0, 50) || `trigger_${Date.now()}`
  }, [])

  // Parse condition value (try JSON, fallback to string)
  const parseConditionValue = (valueStr: string): unknown => {
    try {
      return JSON.parse(valueStr)
    } catch {
      return valueStr
    }
  }

  // Build trigger from form values
  const buildTriggerFromForm = useCallback((values: TriggerFormValues): WorkflowDefinitionTrigger => {
    const config: WorkflowDefinitionTrigger['config'] = {}

    if (values.filterConditions.length > 0) {
      config.filterConditions = values.filterConditions.map(fc => ({
        field: fc.field,
        operator: fc.operator as any,
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
      triggerId: values.triggerId || generateTriggerId(values.name),
      name: values.name,
      description: values.description || null,
      eventPattern: values.eventPattern,
      enabled: values.enabled,
      priority: values.priority,
      config: Object.keys(config).length > 0 ? config : null,
    }
  }, [generateTriggerId])

  // Open dialog for creating new trigger
  const handleCreateNew = useCallback(() => {
    setEditingTrigger(null)
    setFormValues(defaultFormValues)
    setShowDialog(true)
  }, [])

  // Open dialog for editing trigger
  const handleEdit = useCallback((trigger: WorkflowDefinitionTrigger) => {
    setEditingTrigger(trigger)
    setFormValues({
      triggerId: trigger.triggerId,
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
      return
    }
    if (!formValues.eventPattern.trim()) {
      return
    }

    const newTrigger = buildTriggerFromForm(formValues)

    if (editingTrigger) {
      // Update existing trigger
      onChange(value.map(t => t.triggerId === editingTrigger.triggerId ? newTrigger : t))
    } else {
      // Check for duplicate triggerId
      const existingIds = new Set(value.map(t => t.triggerId))
      if (existingIds.has(newTrigger.triggerId)) {
        // Append timestamp to make unique
        newTrigger.triggerId = `${newTrigger.triggerId}_${Date.now()}`
      }
      // Add new trigger
      onChange([...value, newTrigger])
    }

    handleCloseDialog()
  }, [formValues, editingTrigger, buildTriggerFromForm, value, onChange, handleCloseDialog])

  // Delete trigger
  const handleDelete = useCallback((triggerId: string) => {
    onChange(value.filter(t => t.triggerId !== triggerId))
    setDeleteConfirmId(null)
  }, [value, onChange])

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
  const updateFilterCondition = useCallback((index: number, field: string, fieldValue: string) => {
    setFormValues(prev => ({
      ...prev,
      filterConditions: prev.filterConditions.map((fc, i) =>
        i === index ? { ...fc, [field]: fieldValue } : fc
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
  const updateContextMapping = useCallback((index: number, field: string, fieldValue: string) => {
    setFormValues(prev => ({
      ...prev,
      contextMappings: prev.contextMappings.map((cm, i) =>
        i === index ? { ...cm, [field]: fieldValue } : cm
      ),
    }))
  }, [])

  return (
    <div className={className}>
      <div className="rounded-lg border bg-card p-3 md:p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
          <div className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-amber-500" />
            <h3 className="text-sm font-semibold uppercase text-muted-foreground">
              {t('workflows.triggers.title', 'Event Triggers')}
            </h3>
          </div>
          <Button size="sm" variant="outline" onClick={handleCreateNew} className="w-full sm:w-auto">
            <Plus className="w-4 h-4 mr-1" />
            {t('workflows.triggers.add', 'Add Trigger')}
          </Button>
        </div>

        <p className="text-xs text-muted-foreground mb-4">
          {t('workflows.triggers.description', 'Configure events that automatically start this workflow. When a matching event occurs in the system, a new workflow instance will be created with the mapped context.')}
        </p>

        {value.length === 0 ? (
          <Alert variant="info">
            <Info className="w-4 h-4" />
            <AlertTitle>{t('workflows.triggers.empty.title', 'No triggers configured')}</AlertTitle>
            <AlertDescription>
              {t('workflows.triggers.empty.description', 'Click "Add Trigger" to create an event trigger that automatically starts this workflow.')}
            </AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-2">
            {value.map(trigger => (
              <div
                key={trigger.triggerId}
                className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between p-3 rounded-lg border bg-background hover:bg-accent/50 transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <Badge variant={trigger.enabled ? 'default' : 'secondary'} className="shrink-0">
                    {trigger.enabled ? t('common.active', 'Active') : t('common.disabled', 'Disabled')}
                  </Badge>
                  <div className="min-w-0">
                    <div className="font-medium text-sm truncate">{trigger.name}</div>
                    <code className="text-xs text-muted-foreground truncate block">{trigger.eventPattern}</code>
                  </div>
                </div>
                <div className="flex items-center gap-2 self-end sm:self-auto">
                  <Button size="sm" variant="ghost" onClick={() => handleEdit(trigger)}>
                    <Edit2 className="w-4 h-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setDeleteConfirmId(trigger.triggerId)}
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
              {editingTrigger
                ? t('workflows.triggers.dialog.edit.title', 'Edit Event Trigger')
                : t('workflows.triggers.dialog.create.title', 'Create Event Trigger')
              }
            </DialogTitle>
            <DialogDescription>
              {t('workflows.triggers.dialog.description', 'Configure when this workflow should be automatically started based on system events.')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Basic Info */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label htmlFor="trigger-name">{t('workflows.triggers.fields.name', 'Name')} *</Label>
                <Input
                  id="trigger-name"
                  value={formValues.name}
                  onChange={e => setFormValues(prev => ({ ...prev, name: e.target.value }))}
                  placeholder={t('workflows.triggers.placeholders.name', 'Order Created Trigger')}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="trigger-priority">{t('workflows.triggers.fields.priority', 'Priority')}</Label>
                <Input
                  id="trigger-priority"
                  type="number"
                  value={formValues.priority}
                  onChange={e => setFormValues(prev => ({ ...prev, priority: parseInt(e.target.value) || 0 }))}
                  placeholder="0"
                />
                <p className="text-xs text-muted-foreground">
                  {t('workflows.triggers.hints.priority', 'Higher priority triggers execute first')}
                </p>
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="trigger-description">{t('workflows.triggers.fields.description', 'Description')}</Label>
              <Textarea
                id="trigger-description"
                value={formValues.description}
                onChange={e => setFormValues(prev => ({ ...prev, description: e.target.value }))}
                placeholder={t('workflows.triggers.placeholders.description', 'Describe when this trigger should fire...')}
                rows={2}
              />
            </div>

            {/* Event Pattern */}
            <div className="space-y-1">
              <Label htmlFor="trigger-pattern">{t('workflows.triggers.fields.eventPattern', 'Event Pattern')} *</Label>
              <EventPatternInput
                value={formValues.eventPattern}
                onChange={eventPattern => setFormValues(prev => ({ ...prev, eventPattern }))}
                placeholder="sales.orders.created"
              />
              <p className="text-xs text-muted-foreground">
                {t('workflows.triggers.hints.eventPattern', 'Use * as wildcard: "sales.orders.*" matches any order event')}
              </p>
            </div>

            {/* Enabled Switch */}
            <div className="flex items-center gap-2">
              <Switch
                id="trigger-enabled"
                checked={formValues.enabled}
                onCheckedChange={checked => setFormValues(prev => ({ ...prev, enabled: checked }))}
              />
              <Label htmlFor="trigger-enabled">{t('workflows.triggers.fields.enabled', 'Enabled')}</Label>
            </div>

            {/* Filter Conditions */}
            <div className="space-y-2">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <Label>{t('workflows.triggers.fields.filterConditions', 'Filter Conditions')}</Label>
                <Button size="sm" variant="ghost" onClick={addFilterCondition} className="w-full sm:w-auto">
                  <Plus className="w-4 h-4 mr-1" />
                  {t('workflows.triggers.addCondition', 'Add Condition')}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {t('workflows.triggers.hints.filterConditions', 'Only trigger when the event payload matches these conditions (all must match)')}
              </p>
              {formValues.filterConditions.map((fc, index) => (
                <div key={index} className="flex flex-wrap items-center gap-2">
                  <Input
                    value={fc.field}
                    onChange={e => updateFilterCondition(index, 'field', e.target.value)}
                    placeholder="status"
                    className="w-full sm:w-1/3"
                  />
                  <select
                    value={fc.operator}
                    onChange={(e: React.ChangeEvent<HTMLSelectElement>) => updateFilterCondition(index, 'operator', e.target.value)}
                    className="h-10 w-full sm:w-[140px] rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                  >
                    {FILTER_OPERATORS.map(op => (
                      <option key={op.value} value={op.value}>
                        {op.label}
                      </option>
                    ))}
                  </select>
                  <Input
                    value={fc.value}
                    onChange={e => updateFilterCondition(index, 'value', e.target.value)}
                    placeholder="submitted"
                    className="flex-1 min-w-0"
                  />
                  <Button size="icon" variant="ghost" className="shrink-0" onClick={() => removeFilterCondition(index)}>
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>

            {/* Context Mapping */}
            <div className="space-y-2">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <Label>{t('workflows.triggers.fields.contextMapping', 'Context Mapping')}</Label>
                <Button size="sm" variant="ghost" onClick={addContextMapping} className="w-full sm:w-auto">
                  <Plus className="w-4 h-4 mr-1" />
                  {t('workflows.triggers.addMapping', 'Add Mapping')}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {t('workflows.triggers.hints.contextMapping', "Map values from the event payload to the workflow's initial context")}
              </p>
              {formValues.contextMappings.map((cm, index) => (
                <div key={index} className="flex flex-wrap items-center gap-2">
                  <Input
                    value={cm.targetKey}
                    onChange={e => updateContextMapping(index, 'targetKey', e.target.value)}
                    placeholder="orderId"
                    className="w-full sm:w-1/3"
                  />
                  <span className="hidden sm:inline text-muted-foreground">=</span>
                  <Input
                    value={cm.sourceExpression}
                    onChange={e => updateContextMapping(index, 'sourceExpression', e.target.value)}
                    placeholder="id"
                    className="flex-1 min-w-0"
                  />
                  <Input
                    value={cm.defaultValue}
                    onChange={e => updateContextMapping(index, 'defaultValue', e.target.value)}
                    placeholder="default"
                    className="w-full sm:w-24"
                  />
                  <Button size="icon" variant="ghost" className="shrink-0" onClick={() => removeContextMapping(index)}>
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>

            {/* Advanced Options */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label htmlFor="trigger-debounce">{t('workflows.triggers.fields.debounceMs', 'Debounce (ms)')}</Label>
                <Input
                  id="trigger-debounce"
                  type="number"
                  value={formValues.debounceMs}
                  onChange={e => setFormValues(prev => ({ ...prev, debounceMs: e.target.value }))}
                  placeholder="0"
                />
                <p className="text-xs text-muted-foreground">
                  {t('workflows.triggers.hints.debounce', 'Delay to prevent rapid re-triggers')}
                </p>
              </div>
              <div className="space-y-1">
                <Label htmlFor="trigger-max-concurrent">{t('workflows.triggers.fields.maxConcurrent', 'Max Concurrent Instances')}</Label>
                <Input
                  id="trigger-max-concurrent"
                  type="number"
                  value={formValues.maxConcurrentInstances}
                  onChange={e => setFormValues(prev => ({ ...prev, maxConcurrentInstances: e.target.value }))}
                  placeholder={t('workflows.triggers.placeholders.unlimited', 'Unlimited')}
                />
                <p className="text-xs text-muted-foreground">
                  {t('workflows.triggers.hints.maxConcurrent', 'Limit simultaneous workflow instances')}
                </p>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={handleCloseDialog}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={!formValues.name.trim() || !formValues.eventPattern.trim()}
            >
              {editingTrigger
                ? t('common.update', 'Update')
                : t('common.create', 'Create')
              }
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteConfirmId} onOpenChange={() => setDeleteConfirmId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('workflows.triggers.delete.title', 'Delete Event Trigger?')}</DialogTitle>
            <DialogDescription>
              {t('workflows.triggers.delete.description', 'This will remove the event trigger. The change will take effect when you save the workflow definition.')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteConfirmId(null)}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteConfirmId && handleDelete(deleteConfirmId)}
            >
              {t('common.delete', 'Delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
