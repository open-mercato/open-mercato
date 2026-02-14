'use client'

import { Node } from '@xyflow/react'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@open-mercato/ui/primitives/dialog'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { Info, Trash2 } from 'lucide-react'
import { CrudForm, type CrudFormGroup, type CrudField, type CrudCustomFieldRenderProps } from '@open-mercato/ui/backend/CrudForm'
import { JsonBuilder } from '@open-mercato/ui/backend/JsonBuilder'
import { FormFieldArrayEditor } from './fields/FormFieldArrayEditor'
import { ActivityArrayEditor } from './fields/ActivityArrayEditor'
import { MappingArrayEditor } from './fields/MappingArrayEditor'
import { WorkflowSelectorField } from './fields/WorkflowSelectorField'
import { StartPreConditionsEditor } from './fields/StartPreConditionsEditor'
import { nodeToFormValues, formValuesToNodeUpdates, isJsonSchemaFormat, type NodeFormValues } from '../lib/nodeFormTransforms'
import { sanitizeId } from '../lib/graph-utils'

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

export interface NodeEditDialogCrudFormProps {
  node: Node | null
  isOpen: boolean
  onClose: () => void
  onSave: (nodeId: string, updates: Partial<Node['data']>) => void
  onDelete?: (nodeId: string) => void
}

/**
 * NodeEditDialogCrudForm - CrudForm-based modal dialog for editing step properties
 *
 * Migrated from NodeEditDialog to use CrudForm for:
 * - UI coherence with other admin forms
 * - Custom fields support (future enhancement)
 * - Standardized validation and error handling
 * - Consistent keyboard shortcuts
 *
 * Handles 7 node types with dynamic groups:
 * - start: Non-editable (alert only)
 * - end: Non-editable (alert only)
 * - userTask: Assignment fields + form builder
 * - automated: Activity type + activities array
 * - subWorkflow: Workflow selector + input/output mappings
 * - waitForSignal: Signal name + timeout
 * - decision: Basic fields only
 */
export function NodeEditDialogCrudForm({ node, isOpen, onClose, onSave, onDelete }: NodeEditDialogCrudFormProps) {
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const [initialValues, setInitialValues] = useState<Partial<NodeFormValues>>({})
  const [showJsonSchemaWarning, setShowJsonSchemaWarning] = useState(false)

  // Load node data when dialog opens
  useEffect(() => {
    if (node && isOpen) {
      const values = nodeToFormValues(node)
      setInitialValues(values)
      setShowJsonSchemaWarning(isJsonSchemaFormat(node))
    }
  }, [node, isOpen])

  const handleSubmit = useCallback(async (values: Record<string, unknown>) => {
    if (!node) return

    // Validate and sanitize step ID
    const sanitizedId = sanitizeId(node.id)
    if (sanitizedId !== node.id) {
      if (typeof window !== 'undefined') {
        window.alert(
          `⚠️ Step ID was sanitized from "${node.id}" to "${sanitizedId}" to match schema requirements (lowercase letters, numbers, hyphens, and underscores only).`
        )
      }
    }

    try {
      const updates = formValuesToNodeUpdates(values as unknown as NodeFormValues, node)
      onSave(node.id, updates)
      onClose()
    } catch (error) {
      // Error will be displayed in form (e.g., invalid JSON)
      throw error
    }
  }, [node, onSave, onClose])

  const handleDelete = useCallback(async () => {
    if (!node || !onDelete) return
    const confirmed = await confirm({
      title: 'Delete Step',
      text: 'Are you sure you want to delete this step?',
      variant: 'destructive',
    })
    if (!confirmed) return

    onDelete(node.id)
    onClose()
  }, [confirm, node, onDelete, onClose])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose()
    }
  }, [onClose])

  // Dynamic groups based on node type
  const groups: CrudFormGroup[] = useMemo(() => {
    if (!node) return []

    // End nodes are non-editable
    if (node.type === 'end') {
      return [
        {
          id: 'info',
          column: 1,
          bare: true,
          component: () => (
            <Alert variant="default" className="border-blue-200 bg-blue-50">
              <Info className="size-4" />
              <AlertDescription>
                End nodes cannot be edited. They mark the completion of the workflow.
              </AlertDescription>
            </Alert>
          ),
        },
      ]
    }

    // Start nodes: allow editing pre-conditions
    if (node.type === 'start') {
      return [
        {
          id: 'info',
          column: 1,
          bare: true,
          component: () => (
            <Alert variant="default" className="border-blue-200 bg-blue-50 mb-4">
              <Info className="size-4" />
              <AlertDescription>
                Start nodes mark the beginning of the workflow. You can define pre-conditions that must pass before the workflow can be started.
              </AlertDescription>
            </Alert>
          ),
        },
        {
          id: 'preConditions',
          title: 'Pre-Conditions',
          column: 1,
          description: 'Business rules that must pass before the workflow can start',
          fields: ['preConditions'],
        },
      ]
    }

    const baseGroups: CrudFormGroup[] = [
      {
        id: 'basic',
        title: 'Basic Information',
        column: 1,
        fields: ['stepName', 'description', 'timeout'],
      },
    ]

    // UserTask specific groups
    if (node.type === 'userTask') {
      return [
        ...baseGroups,
        {
          id: 'userTask',
          title: 'User Task Configuration',
          column: 1,
          fields: ['assignedTo', 'assignedToRoles', 'formKey'],
        },
        {
          id: 'formFields',
          title: 'Form Fields',
          column: 1,
          description: 'Define the form structure for this user task',
          fields: ['formFields'],
        },
        {
          id: 'advanced',
          title: 'Advanced Configuration',
          column: 1,
          description: 'Additional JSON configuration (userTaskConfig, retryPolicy, etc.)',
          fields: ['advancedConfig'],
        },
      ]
    }

    // Automated specific groups
    if (node.type === 'automated') {
      return [
        ...baseGroups,
        {
          id: 'automated',
          title: 'Automated Task Configuration',
          column: 1,
          fields: ['activityType', 'activityId'],
        },
        {
          id: 'stepActivities',
          title: 'Step Activities',
          column: 1,
          description: 'Activities executed as part of this automated step',
          fields: ['stepActivities'],
        },
        {
          id: 'advanced',
          title: 'Advanced Configuration',
          column: 1,
          description: 'Additional JSON configuration (retryPolicy, etc.)',
          fields: ['advancedConfig'],
        },
      ]
    }

    // SubWorkflow specific groups
    if (node.type === 'subWorkflow') {
      return [
        ...baseGroups,
        {
          id: 'subWorkflow',
          title: 'Sub-Workflow Configuration',
          column: 1,
          fields: ['subWorkflowId', 'subWorkflowVersion'],
        },
        {
          id: 'mappings',
          title: 'Data Mappings',
          column: 1,
          description: 'Map data between parent and sub-workflow',
          fields: ['inputMappings', 'outputMappings'],
        },
        {
          id: 'advanced',
          title: 'Advanced Configuration',
          column: 1,
          description: 'Additional JSON configuration',
          fields: ['advancedConfig'],
        },
      ]
    }

    // WaitForSignal specific groups
    if (node.type === 'waitForSignal') {
      return [
        ...baseGroups,
        {
          id: 'signal',
          title: 'Signal Configuration',
          column: 1,
          fields: ['signalName', 'signalTimeout'],
        },
        {
          id: 'advanced',
          title: 'Advanced Configuration',
          column: 1,
          description: 'Additional JSON configuration',
          fields: ['advancedConfig'],
        },
      ]
    }

    // Decision and other types: just basic fields + advanced
    return [
      ...baseGroups,
      {
        id: 'advanced',
        title: 'Advanced Configuration',
        column: 1,
        description: 'Additional JSON configuration',
        fields: ['advancedConfig'],
      },
    ]
  }, [node])

  // Define all possible form fields (only relevant ones are used based on groups)
  const fields: CrudField[] = useMemo(() => [
    // Basic fields
    {
      id: 'stepName',
      label: 'Step Name',
      type: 'text',
      placeholder: 'Enter step name',
      required: true,
      description: 'Display name for this step',
    },
    {
      id: 'description',
      label: 'Description',
      type: 'textarea',
      placeholder: 'Enter step description',
      description: 'Optional description of what this step does',
    },
    {
      id: 'timeout',
      label: 'Timeout',
      type: 'text',
      placeholder: 'PT30S or 30000',
      description: 'ISO 8601 duration (e.g., PT30S) or milliseconds',
    },

    // UserTask fields
    {
      id: 'assignedTo',
      label: 'Assigned To',
      type: 'text',
      placeholder: 'user@example.com or userId',
      description: 'User email or ID to assign this task to',
    },
    {
      id: 'assignedToRoles',
      label: 'Assigned To Roles',
      type: 'text',
      placeholder: 'admin, manager',
      description: 'Comma-separated list of roles that can claim this task',
    },
    {
      id: 'formKey',
      label: 'Form Key',
      type: 'text',
      placeholder: 'approval_form',
      description: 'Optional form key for external form rendering',
    },
    {
      id: 'formFields',
      label: 'Form Fields',
      type: 'custom',
      component: (props) => (
        <FormFieldArrayEditor
          {...props}
          value={props.value as any}
          isJsonSchemaFormat={showJsonSchemaWarning}
        />
      ),
    },

    // Automated fields
    {
      id: 'activityType',
      label: 'Activity Type',
      type: 'select',
      options: [
        { value: 'SEND_EMAIL', label: 'Send Email' },
        { value: 'CALL_API', label: 'Call API' },
        { value: 'UPDATE_ENTITY', label: 'Update Entity' },
        { value: 'EMIT_EVENT', label: 'Emit Event' },
        { value: 'CALL_WEBHOOK', label: 'Call Webhook' },
        { value: 'EXECUTE_FUNCTION', label: 'Execute Function' },
        { value: 'WAIT', label: 'Wait' },
      ],
      description: 'Type of activity to execute',
    },
    {
      id: 'activityId',
      label: 'Activity ID',
      type: 'text',
      placeholder: 'send_welcome_email',
      description: 'Unique identifier for this activity',
    },
    {
      id: 'stepActivities',
      label: 'Step Activities',
      type: 'custom',
      component: (props) => <ActivityArrayEditor {...props} value={props.value as any} />,
    },

    // SubWorkflow fields
    {
      id: 'subWorkflowId',
      label: 'Sub-Workflow',
      type: 'custom',
      component: (props) => <WorkflowSelectorField {...props} value={props.value as any} />,
    },
    {
      id: 'subWorkflowVersion',
      label: 'Version',
      type: 'number',
      placeholder: '1',
      description: 'Specific version of the sub-workflow to invoke',
    },
    {
      id: 'inputMappings',
      label: 'Input Mappings',
      type: 'custom',
      component: (props) => (
        <MappingArrayEditor
          {...props}
          value={props.value as any}
          label="Input Mappings"
          description="Map parent workflow data to sub-workflow input"
        />
      ),
    },
    {
      id: 'outputMappings',
      label: 'Output Mappings',
      type: 'custom',
      component: (props) => (
        <MappingArrayEditor
          {...props}
          value={props.value as any}
          label="Output Mappings"
          description="Map sub-workflow output back to parent workflow"
        />
      ),
    },

    // WaitForSignal fields
    {
      id: 'signalName',
      label: 'Signal Name',
      type: 'text',
      placeholder: 'approval_received',
      description: 'Name of the signal to wait for',
    },
    {
      id: 'signalTimeout',
      label: 'Signal Timeout',
      type: 'text',
      placeholder: 'PT5M',
      description: 'How long to wait for the signal (ISO 8601 duration)',
    },

    // Advanced configuration
    {
      id: 'advancedConfig',
      label: 'Advanced Configuration (JSON)',
      type: 'custom',
      description: 'Additional JSON configuration merged with the step data',
      component: (props) => <JsonConfigEditor {...props} />,
    },

    // Start node pre-conditions
    {
      id: 'preConditions',
      label: 'Pre-Conditions',
      type: 'custom',
      description: 'Business rules that must pass before the workflow can start',
      component: (props) => <StartPreConditionsEditor {...props} value={props.value as any} />,
    },
  ], [showJsonSchemaWarning])

  if (!isOpen || !node) return null

  const nodeType = node.type || 'unknown'
  const nodeTypeLabel = nodeType.charAt(0).toUpperCase() + nodeType.slice(1).replace(/([A-Z])/g, ' $1')

  const canDelete = !!onDelete

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent
        className="sm:max-w-7xl max-h-[90vh] overflow-hidden flex flex-col !p-0 [&_.grid]:!grid-cols-1"
        onKeyDown={handleKeyDown}
      >
        <DialogHeader className="flex-shrink-0 p-6 pb-4 border-b border-border/70">
          <div className="flex items-center gap-2 mb-2">
            <DialogTitle>Edit Step</DialogTitle>
            <Badge variant="secondary" className="text-xs">
              {nodeTypeLabel}
            </Badge>
          </div>
          <div className="space-y-1">
            <DialogDescription>
              Configure step properties and behavior
            </DialogDescription>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-medium">ID:</span>
              <code className="px-1.5 py-0.5 rounded bg-muted font-mono">{node.id}</code>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-0 px-6">
          {/* JSON Schema Conversion Warning */}
          {showJsonSchemaWarning && (
            <Alert variant="default" className="border-blue-200 bg-blue-50 mb-4">
              <Info className="size-4" />
              <AlertDescription className="text-xs">
                This form uses JSON Schema format. Fields have been converted for visual editing.
                When you save, it will be converted to the simplified format. To preserve the original JSON Schema,
                edit it in the &#34;Advanced Configuration (JSON)&#34; section.
              </AlertDescription>
            </Alert>
          )}

          <CrudForm
            fields={fields}
            groups={groups}
            initialValues={initialValues}
            onSubmit={handleSubmit}
            embedded={true}
            submitLabel="Save Step"
            extraActions={
              canDelete ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleDelete}
                  className="text-red-600 border-red-200 hover:bg-red-50"
                >
                  <Trash2 className="size-4 mr-2" />
                  Delete Step
                </Button>
              ) : undefined
            }
          />
        </div>
        {ConfirmDialogElement}
      </DialogContent>
    </Dialog>
  )
}
