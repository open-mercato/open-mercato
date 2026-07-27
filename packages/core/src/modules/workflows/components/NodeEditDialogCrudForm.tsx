'use client'

import type { Node } from '@xyflow/react'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@open-mercato/ui/primitives/dialog'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { Trash2 } from 'lucide-react'
import { CrudForm, type CrudFormGroup, type CrudField, type CrudCustomFieldRenderProps } from '@open-mercato/ui/backend/CrudForm'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { JsonBuilder } from '@open-mercato/ui/backend/JsonBuilder'
import { DurationInput } from '@open-mercato/ui/backend/inputs/DurationInput'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { FormFieldArrayEditor } from './fields/FormFieldArrayEditor'
import { ActivityArrayEditor, type ActivityTestContext } from './fields/ActivityArrayEditor'
import { useActivityTypeOptions } from './fields/useActivityTypeOptions'
import { MappingArrayEditor } from './fields/MappingArrayEditor'
import { WorkflowSelectorField } from './fields/WorkflowSelectorField'
import { RolesMultiSelect } from './fields/RolesMultiSelect'
import { StartPreConditionsEditor } from './fields/StartPreConditionsEditor'
import { AgentInvokeConfigField } from './fields/AgentInvokeConfigField'
import { IfElseRoutesField, SwitchRoutesField } from './fields/BranchingRoutesEditor'
import { InputDataPanel } from './InputDataPanel'
import { nodeToFormValues, formValuesToNodeUpdates, isJsonSchemaFormat, type NodeFormValues } from '../lib/nodeFormTransforms'
import { sanitizeId } from '../lib/graph-utils'
import { isBranchingNodeType } from '../lib/branching-routes'
import type { BranchingRouteDraft, SwitchRoutesValue } from '../lib/branching-routes'
import type { LedgerEntry } from '../lib/context-ledger'
import type { PinnedSampleEnvelope } from '../lib/sample-resolver'

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

/**
 * DurationCrudField - Custom field wrapper for DurationInput
 */
export function DurationCrudField({ id, value, setValue, disabled }: CrudCustomFieldRenderProps) {
  return (
    <DurationInput
      id={id}
      value={typeof value === 'string' ? value : ''}
      onChange={setValue}
      disabled={disabled}
    />
  )
}

/**
 * RolesCrudField - Custom field wrapper for RolesMultiSelect
 */
export function RolesCrudField({ id, value, setValue, disabled }: CrudCustomFieldRenderProps) {
  const roles = useMemo(
    () => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []),
    [value],
  )
  return (
    <RolesMultiSelect
      id={id}
      value={roles}
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
  ledgerEntries?: LedgerEntry[]
  definitionId?: string | null
  samples?: Record<string, PinnedSampleEnvelope>
  onPinSample?: (stepId: string, data: unknown) => void
  onUnpinSample?: (stepId: string) => void
  /**
   * Outgoing routes of a branching step (IF_ELSE / SWITCH). The inspector edits
   * transitions rather than step data, so the value round-trips through a
   * dedicated callback instead of the node-update payload.
   */
  branchingRoutes?: SwitchRoutesValue
  onSaveBranchingRoutes?: (nodeId: string, value: SwitchRoutesValue) => void
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
 * - waitForTimer: Duration XOR wait-until timer configuration
 * - decision: Basic fields only
 */
export function NodeEditDialogCrudForm({ node, isOpen, onClose, onSave, onDelete, ledgerEntries, definitionId, samples, onPinSample, onUnpinSample, branchingRoutes, onSaveBranchingRoutes }: NodeEditDialogCrudFormProps) {
  const t = useT()
  const activityTypeOptions = useActivityTypeOptions()
  const [initialValues, setInitialValues] = useState<Partial<NodeFormValues>>({})
  const [showJsonSchemaWarning, setShowJsonSchemaWarning] = useState(false)

  const activityTestContext = useMemo<ActivityTestContext | undefined>(() => {
    if (!node || !onPinSample || !onUnpinSample) return undefined
    const stepId = node.id
    return {
      definitionId: definitionId ?? null,
      stepId,
      pinnedSample: samples?.[stepId],
      onPinSample: (data: unknown) => onPinSample(stepId, data),
      onUnpinSample: () => onUnpinSample(stepId),
    }
  }, [node, definitionId, samples, onPinSample, onUnpinSample])

  // Load node data when dialog opens
  useEffect(() => {
    if (node && isOpen) {
      const values = nodeToFormValues(node)
      setInitialValues(
        isBranchingNodeType(node.type)
          ? { ...values, branchingRoutes: branchingRoutes ?? { field: '', routes: [] } }
          : values,
      )
      setShowJsonSchemaWarning(isJsonSchemaFormat(node))
    }
  }, [node, isOpen, branchingRoutes])

  const handleSubmit = useCallback(async (values: Record<string, unknown>) => {
    if (!node) return

    // Validate and sanitize step ID
    const sanitizedId = sanitizeId(node.id)
    if (sanitizedId !== node.id) {
      flash(t('workflows.nodeEditor.stepIdSanitized', { from: node.id, to: sanitizedId }), 'warning')
    }

    try {
      const updates = formValuesToNodeUpdates(values as unknown as NodeFormValues, node)
      onSave(node.id, updates)
      if (isBranchingNodeType(node.type) && onSaveBranchingRoutes) {
        const routesValue = values.branchingRoutes as SwitchRoutesValue | undefined
        onSaveBranchingRoutes(node.id, routesValue ?? { field: '', routes: [] })
      }
      onClose()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(t(message))
    }
  }, [node, onSave, onSaveBranchingRoutes, onClose, t])

  const handleDelete = useCallback(() => {
    if (!node || !onDelete) return
    onDelete(node.id)
  }, [node, onDelete])

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
            <Alert variant="info">
              <AlertDescription>
                {t('workflows.nodeEditor.endStepsNotEditable')}
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
            <Alert variant="info" className="mb-4">
              <AlertDescription>
                {t('workflows.nodeEditor.startStepsInfo')}
              </AlertDescription>
            </Alert>
          ),
        },
        {
          id: 'preConditions',
          title: t('workflows.transitions.preConditions'),
          column: 1,
          description: t('workflows.fieldEditors.preConditions.description'),
          fields: ['preConditions'],
        },
      ]
    }

    const baseGroups: CrudFormGroup[] = [
      {
        id: 'basic',
        title: t('workflows.form.groups.basic'),
        column: 1,
        fields: ['stepName', 'description', 'timeout'],
      },
    ]

    const advancedGroup: CrudFormGroup = {
      id: 'advanced',
      title: t('workflows.form.advancedConfiguration'),
      column: 1,
      description: t('workflows.form.descriptions.advancedConfig'),
      fields: ['advancedConfig'],
    }

    // UserTask specific groups
    if (node.type === 'userTask') {
      return [
        ...baseGroups,
        {
          id: 'userTask',
          title: t('workflows.nodeEditor.userTaskConfig'),
          column: 1,
          fields: ['assignedTo', 'assignedToRoles', 'formKey', 'slaDuration'],
        },
        {
          id: 'formFields',
          title: t('workflows.nodeEditor.groups.formFields'),
          column: 1,
          description: t('workflows.form.descriptions.formFields'),
          fields: ['formFields'],
        },
        advancedGroup,
      ]
    }

    // Automated specific groups
    if (node.type === 'automated') {
      return [
        ...baseGroups,
        {
          id: 'automated',
          title: t('workflows.nodeEditor.groups.automated'),
          column: 1,
          fields: ['activityType', 'activityId'],
        },
        {
          id: 'stepActivities',
          title: t('workflows.nodeEditor.groups.stepActivities'),
          column: 1,
          description: t('workflows.nodeEditor.groups.stepActivitiesDescription'),
          fields: ['stepActivities'],
        },
        advancedGroup,
      ]
    }

    // SubWorkflow specific groups
    if (node.type === 'subWorkflow') {
      return [
        ...baseGroups,
        {
          id: 'subWorkflow',
          title: t('workflows.form.subWorkflowConfig'),
          column: 1,
          fields: ['subWorkflowId', 'subWorkflowVersion'],
        },
        {
          id: 'mappings',
          title: t('workflows.nodeEditor.groups.mappings'),
          column: 1,
          description: t('workflows.nodeEditor.groups.mappingsDescription'),
          fields: ['inputMappings', 'outputMappings'],
        },
        advancedGroup,
      ]
    }

    // WaitForSignal specific groups
    if (node.type === 'waitForSignal') {
      return [
        ...baseGroups,
        {
          id: 'signal',
          title: t('workflows.form.signalConfig'),
          column: 1,
          fields: ['signalName', 'signalTimeout'],
        },
        advancedGroup,
      ]
    }

    // WaitForTimer specific groups
    if (node.type === 'waitForTimer') {
      return [
        {
          id: 'basic',
          title: t('workflows.form.groups.basic'),
          column: 1,
          fields: ['stepName', 'description'],
        },
        {
          id: 'timer',
          title: t('workflows.nodeEditor.groups.timer'),
          column: 1,
          description: t('workflows.nodeEditor.groups.timerDescription'),
          fields: ['timerDuration', 'timerUntil'],
        },
        advancedGroup,
      ]
    }

    // InvokeAgent specific groups
    if (node.type === 'invokeAgent') {
      return [
        ...baseGroups,
        {
          id: 'invokeAgent',
          title: t('workflows.form.invokeAgent.sectionTitle'),
          column: 1,
          description: t('workflows.form.invokeAgent.sectionDescription'),
          fields: ['agentConfig'],
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

    // Branching steps: the routes inspector edits the outgoing transitions
    if (isBranchingNodeType(node.type)) {
      return [
        ...baseGroups,
        {
          id: 'branchingRoutes',
          title: t('workflows.branching.groupTitle', 'Routes'),
          column: 1,
          description: t(
            'workflows.branching.groupDescription',
            'Routing happens on the outgoing transitions: each case is evaluated by priority, and the otherwise route runs when none matches.',
          ),
          fields: ['branchingRoutes'],
        },
        advancedGroup,
      ]
    }

    // Decision and other types: just basic fields + advanced
    return [
      ...baseGroups,
      advancedGroup,
    ]
  }, [node, t])

  // Define all possible form fields (only relevant ones are used based on groups)
  const fields: CrudField[] = useMemo(() => [
    // Basic fields
    {
      id: 'stepName',
      label: t('workflows.form.stepName'),
      type: 'text',
      placeholder: t('workflows.form.placeholders.stepName'),
      required: true,
      description: t('workflows.form.descriptions.stepName'),
    },
    {
      id: 'description',
      label: t('workflows.form.description'),
      type: 'textarea',
      placeholder: t('workflows.form.placeholders.description'),
      description: t('workflows.form.descriptions.description'),
    },
    {
      id: 'timeout',
      label: t('workflows.form.timeout'),
      type: 'custom',
      description: t('workflows.form.descriptions.timeout'),
      component: (props) => <DurationCrudField {...props} />,
    },

    // UserTask fields
    {
      id: 'assignedTo',
      label: t('workflows.form.assignedTo'),
      type: 'text',
      placeholder: t('workflows.form.placeholders.userId'),
      description: t('workflows.form.descriptions.assignedTo'),
    },
    {
      id: 'assignedToRoles',
      label: t('workflows.form.assignedToRoles'),
      type: 'custom',
      description: t('workflows.form.descriptions.assignedToRoles'),
      component: (props) => <RolesCrudField {...props} />,
    },
    {
      id: 'formKey',
      label: t('workflows.form.formKey'),
      type: 'text',
      placeholder: t('workflows.form.placeholders.formKey'),
      description: t('workflows.form.descriptions.formKey'),
    },
    {
      id: 'slaDuration',
      label: t('workflows.tasks.userTaskConfig.slaDuration'),
      type: 'custom',
      description: t('workflows.nodeEditor.slaDurationDescription'),
      component: (props) => <DurationCrudField {...props} />,
    },
    {
      id: 'formFields',
      label: t('workflows.nodeEditor.groups.formFields'),
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
      label: t('workflows.form.activityType'),
      type: 'select',
      options: activityTypeOptions,
      description: t('workflows.nodeEditor.activityTypeDescription'),
    },
    {
      id: 'activityId',
      label: t('workflows.form.activityId'),
      type: 'text',
      placeholder: t('workflows.form.placeholders.activityId'),
      description: t('workflows.nodeEditor.activityIdDescription'),
    },
    {
      id: 'stepActivities',
      label: t('workflows.nodeEditor.groups.stepActivities'),
      type: 'custom',
      component: (props) => <ActivityArrayEditor {...props} value={props.value as any} ledgerEntries={ledgerEntries} testContext={activityTestContext} />,
    },

    // SubWorkflow fields
    {
      id: 'subWorkflowId',
      label: t('workflows.form.workflowToInvoke'),
      type: 'custom',
      component: (props) => <WorkflowSelectorField {...props} value={props.value as any} />,
    },
    {
      id: 'subWorkflowVersion',
      label: t('workflows.form.version'),
      type: 'number',
      placeholder: t('workflows.form.placeholders.version'),
      description: t('workflows.form.descriptions.subWorkflowVersion'),
    },
    {
      id: 'inputMappings',
      label: t('workflows.nodeEditor.inputMappings'),
      type: 'custom',
      component: (props) => (
        <MappingArrayEditor
          {...props}
          value={props.value as any}
          label={t('workflows.nodeEditor.inputMappings')}
          description={t('workflows.form.descriptions.inputMapping')}
          variablePicker
          ledgerEntries={ledgerEntries}
        />
      ),
    },
    {
      id: 'outputMappings',
      label: t('workflows.nodeEditor.outputMappings'),
      type: 'custom',
      component: (props) => (
        <MappingArrayEditor
          {...props}
          value={props.value as any}
          label={t('workflows.nodeEditor.outputMappings')}
          description={t('workflows.form.descriptions.outputMapping')}
        />
      ),
    },

    // WaitForSignal fields
    {
      id: 'signalName',
      label: t('workflows.form.signalName'),
      type: 'text',
      placeholder: t('workflows.form.placeholders.signalName'),
      description: t('workflows.form.descriptions.signalName'),
    },
    {
      id: 'signalTimeout',
      label: t('workflows.nodeEditor.signalTimeout'),
      type: 'custom',
      description: t('workflows.form.descriptions.signalTimeout'),
      component: (props) => <DurationCrudField {...props} />,
    },

    // WaitForTimer fields
    {
      id: 'timerDuration',
      label: t('workflows.activities.waitDuration'),
      type: 'custom',
      description: t('workflows.nodeEditor.timerDurationDescription'),
      component: (props) => <DurationCrudField {...props} />,
    },
    {
      id: 'timerUntil',
      label: t('workflows.activities.waitUntil'),
      type: 'datetime',
      minDate: new Date(),
      description: t('workflows.nodeEditor.timerUntilDescription'),
    },

    // InvokeAgent configuration
    {
      id: 'agentConfig',
      label: '',
      type: 'custom',
      component: (props) => (
        <AgentInvokeConfigField {...props} value={props.value as any} ledgerEntries={ledgerEntries} />
      ),
    },
    {
      id: 'branchingRoutes',
      label: '',
      type: 'custom',
      component: (props) => {
        const routesValue = (props.value as SwitchRoutesValue | undefined) ?? { field: '', routes: [] }
        if (node?.type === 'switch') {
          return (
            <SwitchRoutesField
              id={props.id}
              value={routesValue}
              setValue={props.setValue}
              disabled={props.disabled}
              ledgerEntries={ledgerEntries}
            />
          )
        }
        return (
          <IfElseRoutesField
            id={props.id}
            value={routesValue.routes}
            setValue={(routes: BranchingRouteDraft[]) => props.setValue({ ...routesValue, routes })}
            disabled={props.disabled}
          />
        )
      },
    },

    // Advanced configuration
    {
      id: 'advancedConfig',
      label: t('workflows.form.advancedConfiguration'),
      type: 'custom',
      description: t('workflows.form.descriptions.advancedConfig'),
      component: (props) => <JsonConfigEditor {...props} />,
    },

    // Start node pre-conditions
    {
      id: 'preConditions',
      label: t('workflows.transitions.preConditions'),
      type: 'custom',
      description: t('workflows.fieldEditors.preConditions.description'),
      component: (props) => <StartPreConditionsEditor {...props} value={props.value as any} />,
    },
  ], [activityTypeOptions, showJsonSchemaWarning, ledgerEntries, activityTestContext, node?.type, t])

  if (!isOpen || !node) return null

  const nodeTypeLabel = t(`workflows.nodeTypes.${node.type || 'automated'}`)

  const canDelete = !!onDelete

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent
        className="sm:max-w-7xl max-h-[90vh] overflow-hidden flex flex-col !p-0 [&_.grid]:!grid-cols-1"
        onKeyDown={handleKeyDown}
      >
        <DialogHeader className="flex-shrink-0 p-6 pb-4 border-b border-border/70">
          <div className="flex items-center gap-2 mb-2">
            <DialogTitle>{t('workflows.nodeEditor.title')}</DialogTitle>
            <Badge variant="secondary" className="text-xs">
              {nodeTypeLabel}
            </Badge>
          </div>
          <div className="space-y-1">
            <DialogDescription>
              {t('workflows.nodeEditor.description')}
            </DialogDescription>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-medium">{t('workflows.fields.id')}:</span>
              <code className="px-1.5 py-0.5 rounded bg-muted font-mono">{node.id}</code>
            </div>
          </div>
        </DialogHeader>

        <div className="flex flex-1 min-h-0 gap-4 overflow-hidden px-6">
          <div className="min-h-0 flex-1 overflow-y-auto">
            {/* JSON Schema Conversion Warning */}
            {showJsonSchemaWarning && (
              <Alert variant="info" className="mb-4">
                <AlertDescription className="text-xs">
                  {t('workflows.nodeEditor.jsonSchemaFormat')}
                </AlertDescription>
              </Alert>
            )}

            <CrudForm
              fields={fields}
              groups={groups}
              initialValues={initialValues}
              onSubmit={handleSubmit}
              embedded={true}
              submitLabel={t('workflows.form.saveStep')}
              extraActions={
                canDelete ? (
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={handleDelete}
                  >
                    <Trash2 className="size-4 mr-2" />
                    {t('workflows.form.deleteStep')}
                  </Button>
                ) : undefined
              }
            />
          </div>
          <InputDataPanel
            entries={ledgerEntries}
            stepId={node.id}
            samples={samples}
            className="hidden w-72 shrink-0 self-start lg:flex max-h-full"
          />
        </div>
      </DialogContent>
    </Dialog>
  )
}
