'use client'

import { Edge } from '@xyflow/react'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@open-mercato/ui/primitives/dialog'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { Trash2 } from 'lucide-react'
import { CrudForm, type CrudFormGroup, type CrudField, type CrudCustomFieldRenderProps } from '@open-mercato/ui/backend/CrudForm'
import { JsonBuilder } from '@open-mercato/ui/backend/JsonBuilder'
import { BusinessRuleConditionsEditor } from './fields/BusinessRuleConditionsEditor'
import { ActivityArrayEditor } from './fields/ActivityArrayEditor'
import { edgeToFormValues, formValuesToEdgeUpdates, type EdgeFormValues } from '../lib/edgeFormTransforms'

/**
 * JsonConfigEditor - Custom field wrapper for JsonBuilder
 */
function JsonConfigEditor({ value, setValue, disabled }: CrudCustomFieldRenderProps) {
  return (
    <JsonBuilder
      value={value || {}}
      onChange={setValue}
      disabled={disabled}
    />
  )
}

export interface EdgeEditDialogCrudFormProps {
  edge: Edge | null
  isOpen: boolean
  onClose: () => void
  onSave: (edgeId: string, updates: Partial<Edge['data']>) => void
  onDelete: (edgeId: string) => void
}

/**
 * EdgeEditDialogCrudForm - CrudForm-based modal dialog for editing transition properties
 *
 * Migrated from EdgeEditDialog to use CrudForm for:
 * - UI coherence with other admin forms
 * - Custom fields support (future enhancement)
 * - Standardized validation and error handling
 * - Consistent keyboard shortcuts
 *
 * Features:
 * - Basic configuration (name, trigger, priority)
 * - Business rules (pre/post conditions with modal integration)
 * - Activities with nested retry policies
 * - Advanced JSON configuration
 * - Delete functionality with confirmation
 * - Keyboard shortcuts (Cmd/Ctrl+Enter save, Escape cancel)
 */
export function EdgeEditDialogCrudForm({ edge, isOpen, onClose, onSave, onDelete }: EdgeEditDialogCrudFormProps) {
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const [initialValues, setInitialValues] = useState<Partial<EdgeFormValues>>({})

  // Load edge data when dialog opens
  useEffect(() => {
    if (edge && isOpen) {
      const values = edgeToFormValues(edge)
      setInitialValues(values)
    }
  }, [edge, isOpen])

  const handleSubmit = useCallback(async (values: Record<string, unknown>) => {
    if (!edge) return

    try {
      const updates = formValuesToEdgeUpdates(values as unknown as EdgeFormValues, edge)
      onSave(edge.id, updates)
      onClose()
    } catch (error) {
      // Error will be displayed in form (e.g., invalid JSON)
      throw error
    }
  }, [edge, onSave, onClose])

  const handleDelete = useCallback(async () => {
    if (!edge) return
    const confirmed = await confirm({
      title: 'Delete Transition',
      text: 'Are you sure you want to delete this transition?',
      variant: 'destructive',
    })
    if (!confirmed) return

    onDelete(edge.id)
    onClose()
  }, [confirm, edge, onDelete, onClose])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose()
    }
  }, [onClose])

  // Define form groups
  const groups: CrudFormGroup[] = useMemo(() => [
    {
      id: 'basic',
      title: 'Basic Configuration',
      column: 1,
      fields: ['transitionName', 'trigger', 'priority', 'continueOnActivityFailure'],
    },
    {
      id: 'businessRules',
      title: 'Business Rules',
      column: 1,
      description: 'Define pre-conditions (guards) and post-conditions (validations) for this transition',
      fields: ['preConditions', 'postConditions'],
    },
    {
      id: 'activities',
      title: 'Activities',
      column: 1,
      description: 'Activities executed when this transition fires',
      fields: ['activities'],
    },
    {
      id: 'advanced',
      title: 'Advanced Configuration',
      column: 1,
      description: 'Additional configuration as JSON (merged with above fields)',
      fields: ['advancedConfig'],
    },
  ], [])

  // Define form fields
  const fields: CrudField[] = useMemo(() => [
    {
      id: 'transitionName',
      label: 'Transition Name',
      type: 'text',
      placeholder: 'Enter transition name',
      required: true,
      description: 'Display name for this transition',
    },
    {
      id: 'trigger',
      label: 'Trigger Type',
      type: 'select',
      required: true,
      options: [
        { value: 'auto', label: 'Automatic' },
        { value: 'manual', label: 'Manual' },
        { value: 'signal', label: 'Signal' },
        { value: 'timer', label: 'Timer' },
      ],
      description: 'How this transition is triggered',
    },
    {
      id: 'priority',
      label: 'Priority',
      type: 'number',
      placeholder: '100',
      description: 'Higher priority transitions are evaluated first (0-9999)',
    },
    {
      id: 'continueOnActivityFailure',
      label: 'Continue on Activity Failure',
      type: 'checkbox',
      description: 'If checked, transition completes even if activities fail',
    },
    {
      id: 'preConditions',
      label: 'Pre-Conditions (Guards)',
      type: 'custom',
      description: 'Business rules that must pass before transition can fire',
      component: (props) => (
        <BusinessRuleConditionsEditor
          {...props}
          value={props.value as any}
        />
      ),
    },
    {
      id: 'postConditions',
      label: 'Post-Conditions (Validations)',
      type: 'custom',
      description: 'Business rules validated after transition completes',
      component: (props) => (
        <BusinessRuleConditionsEditor
          {...props}
          value={props.value as any}
        />
      ),
    },
    {
      id: 'activities',
      label: 'Activities',
      type: 'custom',
      description: 'Activities executed when this transition fires',
      component: (props) => <ActivityArrayEditor {...props} value={props.value as any} />,
    },
    {
      id: 'advancedConfig',
      label: 'Advanced Configuration (JSON)',
      type: 'custom',
      description: 'Additional JSON configuration merged with the transition data',
      component: (props) => <JsonConfigEditor {...props} />,
    },
  ], [])

  if (!isOpen || !edge) return null

  const edgeData = edge.data as any
  const trigger = edgeData?.trigger || 'auto'
  const triggerVariant = trigger === 'auto' ? 'default' : trigger === 'manual' ? 'secondary' : 'outline'

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent
        className="sm:max-w-3xl max-h-[90vh] overflow-hidden flex flex-col !p-0 [&_.grid]:!grid-cols-1"
        onKeyDown={handleKeyDown}
      >
        <DialogHeader className="flex-shrink-0 p-6 pb-4 border-b border-border/70">
          <div className="flex items-center gap-2 mb-2">
            <DialogTitle>Edit Transition</DialogTitle>
            <Badge variant={triggerVariant} className="text-xs">
              {trigger === 'auto' ? 'Automatic' :
               trigger === 'manual' ? 'Manual' :
               trigger === 'signal' ? 'Signal' : 'Timer'}
            </Badge>
          </div>
          <div className="space-y-1">
            <DialogDescription>
              Configure transition properties, conditions, and activities
            </DialogDescription>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-medium">ID:</span>
              <code className="px-1.5 py-0.5 rounded bg-muted font-mono">{edge.id}</code>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-medium">Flow:</span>
              <code className="px-1.5 py-0.5 rounded bg-muted font-mono">{edge.source}</code>
              <span>→</span>
              <code className="px-1.5 py-0.5 rounded bg-muted font-mono">{edge.target}</code>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-0 px-6 ">
          <CrudForm
            fields={fields}
            groups={groups}
            initialValues={initialValues}
            onSubmit={handleSubmit}
            embedded={true}
            submitLabel="Save Transition"
            extraActions={
              <Button
                type="button"
                variant="outline"
                onClick={handleDelete}
                className="text-red-600 border-red-200 hover:bg-red-50"
              >
                <Trash2 className="size-4 mr-2" />
                Delete Transition
              </Button>
            }
          />
        </div>
        {ConfirmDialogElement}
      </DialogContent>
    </Dialog>
  )
}
