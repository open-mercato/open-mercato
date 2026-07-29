'use client'

import type { Node } from '@xyflow/react'
import { useState, useEffect, useCallback, useMemo } from 'react'
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
import { RouteOrderEditor } from './fields/RouteOrderEditor'
import { TemplateTextControl } from './fields/TemplateTextControl'
import { TaskEntityBindingsField } from './fields/TaskEntityBindingsField'
import { TaskAssignmentField } from './fields/TaskAssignmentField'
import { TaskOnBreachField, TaskRemindersField } from './fields/TaskDeadlineFields'
import { AgentReviewOnBreachField } from './fields/AgentReviewOnBreachField'
import { TaskDecisionsField, TaskEditablePrefilledField } from './fields/TaskDecisionsField'
import { TASK_PRIORITY_VALUES } from '../lib/task-inspector-config'
import { AGENT_REVIEW_ASSIGNMENT_MODES } from '../lib/agent-review-inspector'
import type { RouteOrderEntry } from '../lib/route-priority'
import { ConditionBuilder } from '@open-mercato/core/modules/business_rules/components/ConditionBuilder'
import type { GroupCondition } from '@open-mercato/core/modules/business_rules/components/utils/conditionValidation'
import { InputDataPanel } from './InputDataPanel'
import { InspectorPanel, type InspectorPanelVariant } from './InspectorPanel'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { nodeToFormValues, formValuesToNodeUpdates, isJsonSchemaFormat, type NodeFormValues } from '../lib/nodeFormTransforms'
import {
  listStepTypeConversionTargets,
  readUnmappedStepConfig,
  type ConvertibleStepType,
} from '../lib/step-type-conversion'
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

/**
 * StepTypeConversionControl — "Change type…" (spec 4.5, #4237).
 *
 * Conversion is an action on the step, not a form value: it rewrites the node
 * type and its data wholesale, so it runs through its own callback (with a
 * confirmation on the page) instead of the CrudForm submit.
 */
function StepTypeConversionControl({
  nodeType,
  onConvert,
}: {
  nodeType: string | undefined
  onConvert: (targetType: ConvertibleStepType) => void
}) {
  const t = useT()
  const [targetType, setTargetType] = useState<string>('')
  const targets = useMemo(() => listStepTypeConversionTargets(nodeType), [nodeType])

  if (targets.length === 0) return null

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        {t(
          'workflows.stepConversion.description',
          'Keeps this step’s id, name, position and wiring. Configuration the new type cannot execute is parked under Unmapped configuration instead of being deleted.',
        )}
      </p>
      <div className="flex items-center gap-2">
        <Select value={targetType} onValueChange={setTargetType}>
          <SelectTrigger className="w-64" aria-label={t('workflows.stepConversion.targetLabel', 'New step type')}>
            <SelectValue placeholder={t('workflows.stepConversion.targetPlaceholder', 'Select a step type')} />
          </SelectTrigger>
          <SelectContent>
            {targets.map((candidate) => (
              <SelectItem key={candidate} value={candidate}>
                {t(`workflows.nodeTypes.${candidate}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          variant="outline"
          disabled={!targetType}
          onClick={() => {
            if (targetType) onConvert(targetType as ConvertibleStepType)
          }}
        >
          {t('workflows.stepConversion.action', 'Change type…')}
        </Button>
      </div>
    </div>
  )
}

/**
 * UnmappedConfigDrawer — the quarantine made visible (spec 4.5). Read-only: the
 * values are stored verbatim in the step metadata and are recovered by
 * converting back, never edited in place.
 */
function UnmappedConfigDrawer({ value }: { value: Record<string, unknown> }) {
  const t = useT()
  return (
    <details className="rounded-md border border-border bg-muted/30 p-3">
      <summary className="cursor-pointer text-sm font-medium">
        {t('workflows.stepConversion.unmapped.title', 'Unmapped configuration')}
      </summary>
      <p className="mt-2 text-xs text-muted-foreground">
        {t(
          'workflows.stepConversion.unmapped.description',
          'Kept from an earlier type change. It is stored with the step but is not executed; change the step back to recover it.',
        )}
      </p>
      <pre className="mt-2 max-h-64 overflow-auto rounded bg-background p-2 font-mono text-xs">
        {JSON.stringify(value, null, 2)}
      </pre>
    </details>
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
  /**
   * Outgoing routes of a NON-branching step, in evaluation order. Reordering the
   * list derives the transition priorities (spec 4.4) — branching steps order
   * their routes through their own case list instead.
   */
  routeOrder?: RouteOrderEntry[]
  onSaveRouteOrder?: (nodeId: string, entries: RouteOrderEntry[]) => void
  /**
   * In-place step type conversion (spec 4.5). The page confirms the change and
   * rewrites the node, because conversion replaces the node type and its data
   * rather than producing a form value.
   */
  onConvertType?: (nodeId: string, targetType: ConvertibleStepType) => void
  /**
   * How the inspector is presented. Defaults to `overlay` so a caller that has
   * not opted in keeps the modal shape it had.
   */
  variant?: InspectorPanelVariant
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
 * - waitForCondition: ConditionBuilder predicate + mandatory timeout policy
 * - decision: Basic fields only
 */
export function NodeEditDialogCrudForm({ node, isOpen, onClose, onSave, onDelete, ledgerEntries, definitionId, samples, onPinSample, onUnpinSample, branchingRoutes, onSaveBranchingRoutes, routeOrder, onSaveRouteOrder, onConvertType, variant = 'overlay' }: NodeEditDialogCrudFormProps) {
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
          : { ...values, routeOrder: routeOrder ?? [] },
      )
      setShowJsonSchemaWarning(isJsonSchemaFormat(node))
    }
  }, [node, isOpen, branchingRoutes, routeOrder])

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
      } else if (onSaveRouteOrder) {
        const entries = values.routeOrder as RouteOrderEntry[] | undefined
        if (Array.isArray(entries) && entries.length > 0) onSaveRouteOrder(node.id, entries)
      }
      onClose()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new Error(t(message))
    }
  }, [node, onSave, onSaveBranchingRoutes, onSaveRouteOrder, onClose, t])

  const handleDelete = useCallback(() => {
    if (!node || !onDelete) return
    onDelete(node.id)
  }, [node, onDelete])

  // Dynamic groups based on node type
  const typeGroups: CrudFormGroup[] = useMemo(() => {
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

    // Route ordering (spec 4.4) only makes sense once a step has a choice to
    // make. Branching steps order their routes through their own case list.
    if (!isBranchingNodeType(node.type) && (routeOrder?.length ?? 0) > 1) {
      baseGroups.push({
        id: 'routeOrder',
        title: t('workflows.routeOrder.groupTitle'),
        column: 1,
        description: t('workflows.routeOrder.groupDescription'),
        fields: ['routeOrder'],
      })
    }

    const advancedGroup: CrudFormGroup = {
      id: 'advanced',
      title: t('workflows.form.advancedConfiguration'),
      column: 1,
      description: t('workflows.form.descriptions.advancedConfig'),
      fields: ['advancedConfig'],
    }

    // Error handling (spec section 5.9): what this step does when it fails and
    // no error route is wired from its error handle.
    const errorHandlingGroup: CrudFormGroup = {
      id: 'errorHandling',
      title: t('workflows.nodeEditor.groups.errorHandling', 'Error Handling'),
      column: 1,
      description: t(
        'workflows.nodeEditor.groups.errorHandlingDescription',
        'Applies when this step fails and no error route is wired from its error output handle.',
      ),
      fields: ['errorDirectiveMode', 'errorDirectiveFallbackValue'],
    }

    // UserTask: the five task-inspector sections of spec §6.1, in order —
    // What / About what / Who / When / Decisions — followed by the step
    // mechanics every node type shares. Each section is container-agnostic: it
    // declares no width and assumes no modal chrome, so re-hosting the
    // inspector in a docked rail is a re-parent rather than a rewrite.
    if (node.type === 'userTask') {
      return [
        {
          id: 'taskWhat',
          title: t('workflows.tasks.inspector.what.title'),
          column: 1,
          fields: ['stepName', 'taskInstructions'],
        },
        {
          id: 'taskAbout',
          title: t('workflows.tasks.inspector.bindings.title'),
          column: 1,
          fields: ['taskEntityBindings'],
        },
        {
          id: 'taskWho',
          title: t('workflows.tasks.inspector.who.title'),
          column: 1,
          fields: ['assignmentMode'],
        },
        {
          id: 'taskWhen',
          title: t('workflows.tasks.inspector.when.title'),
          column: 1,
          fields: ['taskPriority', 'slaDuration', 'taskReminders', 'taskOnBreach'],
        },
        {
          id: 'taskDecisions',
          title: t('workflows.tasks.inspector.decisions.title'),
          column: 1,
          description: t('workflows.form.descriptions.formFields'),
          fields: ['taskDecisions', 'formFields', 'taskEditablePrefilled', 'formKey'],
        },
        {
          id: 'basic',
          title: t('workflows.form.groups.basic'),
          column: 1,
          fields: ['description', 'timeout'],
        },
        ...baseGroups.slice(1),
        errorHandlingGroup,
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
        errorHandlingGroup,
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
        errorHandlingGroup,
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

    // WaitForCondition specific groups
    if (node.type === 'waitForCondition') {
      return [
        {
          id: 'basic',
          title: t('workflows.form.groups.basic'),
          column: 1,
          fields: ['stepName', 'description'],
        },
        {
          id: 'waitCondition',
          title: t('workflows.nodeEditor.groups.waitCondition', 'Wait Condition'),
          column: 1,
          description: t(
            'workflows.nodeEditor.groups.waitConditionDescription',
            'The workflow pauses here until this condition over the run context becomes true. It is re-checked whenever the context is written and on a periodic poll.',
          ),
          fields: ['waitCondition'],
        },
        {
          id: 'waitConditionTimeout',
          title: t('workflows.nodeEditor.groups.waitConditionTimeout', 'Timeout Policy'),
          column: 1,
          description: t(
            'workflows.nodeEditor.groups.waitConditionTimeoutDescription',
            'A timeout is required so a condition that never becomes true cannot hang the run forever.',
          ),
          fields: ['waitConditionTimeout', 'waitConditionOnTimeout', 'waitConditionPollIntervalMs'],
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
        // Review (spec §7.5): who dispositions the proposal this step raises,
        // and by when. The same Who/When vocabulary the Task inspector authors
        // (§6.1.3 / §6.1.4) — because the thing being authored IS a task.
        {
          id: 'agentReviewWho',
          title: t('workflows.form.invokeAgent.review.whoTitle'),
          column: 1,
          description: t('workflows.form.invokeAgent.review.whoDescription'),
          fields: ['reviewAssignmentMode'],
        },
        {
          id: 'agentReviewWhen',
          title: t('workflows.form.invokeAgent.review.whenTitle'),
          column: 1,
          description: t('workflows.form.invokeAgent.review.whenDescription'),
          fields: ['reviewPriority', 'reviewDeadline', 'reviewReminders', 'reviewOnBreach'],
        },
        errorHandlingGroup,
        advancedGroup,
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
        errorHandlingGroup,
        advancedGroup,
      ]
    }

    // Decision and other types: just basic fields + advanced
    return [
      ...baseGroups,
      advancedGroup,
    ]
  }, [node, t])

  // Quarantined config from an earlier type change, and the conversion control
  // itself (spec 4.5). Both hang off every editable step type, after whatever
  // that type's own inspector renders.
  const unmappedConfig = useMemo(() => readUnmappedStepConfig(node?.data), [node])

  const groups: CrudFormGroup[] = useMemo(() => {
    if (!node) return []
    const extras: CrudFormGroup[] = []
    if (unmappedConfig) {
      extras.push({
        id: 'unmappedConfig',
        column: 1,
        bare: true,
        component: () => <UnmappedConfigDrawer value={unmappedConfig} />,
      })
    }
    if (onConvertType && listStepTypeConversionTargets(node.type).length > 0) {
      extras.push({
        id: 'changeType',
        title: t('workflows.stepConversion.groupTitle', 'Change step type'),
        column: 1,
        bare: false,
        component: () => (
          <StepTypeConversionControl
            nodeType={node.type}
            onConvert={(targetType) => onConvertType(node.id, targetType)}
          />
        ),
      })
    }
    return [...typeGroups, ...extras]
  }, [node, typeGroups, unmappedConfig, onConvertType, t])

  // Define all possible form fields (only relevant ones are used based on groups)
  const fields: CrudField[] = useMemo(() => [
    // Basic fields. A user task's title is the sentence the assignee reads, so
    // it is pill-capable there (spec §6.1 "What") and a plain text input
    // everywhere else.
    node?.type === 'userTask'
      ? {
          id: 'stepName',
          label: t('workflows.tasks.inspector.what.taskTitle'),
          type: 'custom',
          required: true,
          component: (props) => (
            <TemplateTextControl
              id={props.id}
              value={typeof props.value === 'string' ? props.value : ''}
              onValueChange={props.setValue}
              ledgerEntries={ledgerEntries}
              placeholder={t('workflows.form.placeholders.stepName')}
              disabled={props.disabled}
              aria-label={t('workflows.tasks.inspector.what.taskTitle')}
            />
          ),
        }
      : {
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
      label: t('workflows.tasks.inspector.when.deadline'),
      type: 'custom',
      description: t('workflows.nodeEditor.slaDurationDescription'),
      component: (props) => <DurationCrudField {...props} />,
    },

    // Task inspector sections (spec §6.1)
    {
      id: 'taskInstructions',
      label: t('workflows.tasks.inspector.what.instructions'),
      type: 'custom',
      component: (props) => (
        <TemplateTextControl
          id={props.id}
          value={typeof props.value === 'string' ? props.value : ''}
          onValueChange={props.setValue}
          ledgerEntries={ledgerEntries}
          placeholder={t('workflows.tasks.inspector.what.instructionsPlaceholder')}
          disabled={props.disabled}
          multiline
          aria-label={t('workflows.tasks.inspector.what.instructions')}
        />
      ),
    },
    {
      id: 'taskEntityBindings',
      label: t('workflows.tasks.inspector.bindings.label'),
      type: 'custom',
      component: (props) => <TaskEntityBindingsField {...props} ledgerEntries={ledgerEntries} />,
    },
    {
      id: 'assignmentMode',
      label: t('workflows.tasks.inspector.who.label'),
      type: 'custom',
      component: (props) => <TaskAssignmentField {...props} ledgerEntries={ledgerEntries} />,
    },
    {
      id: 'taskPriority',
      label: t('workflows.tasks.inspector.when.priority'),
      type: 'select',
      options: TASK_PRIORITY_VALUES.map((priority) => ({
        value: priority,
        label: t(`workflows.tasks.inspector.when.priorities.${priority}`),
      })),
    },
    {
      id: 'taskReminders',
      label: t('workflows.tasks.inspector.when.reminders'),
      type: 'custom',
      component: (props) => <TaskRemindersField {...props} />,
    },
    {
      id: 'taskOnBreach',
      label: t('workflows.tasks.inspector.when.onBreach'),
      type: 'custom',
      component: (props) => <TaskOnBreachField {...props} routeOrder={routeOrder} />,
    },
    // Invoke Agent — Review (spec §7.5). The assignment tabs and the reminder
    // control are the SAME components the Task inspector renders, pointed at
    // this section's own field ids; only the breach action set differs, because
    // a disposition deadline escalates and never decides.
    {
      id: 'reviewAssignmentMode',
      label: t('workflows.tasks.inspector.who.label'),
      type: 'custom',
      component: (props) => (
        <TaskAssignmentField
          {...props}
          ledgerEntries={ledgerEntries}
          modes={AGENT_REVIEW_ASSIGNMENT_MODES}
          fieldIds={{
            assignedTo: 'reviewAssignedTo',
            assignedToRoles: 'reviewAssignedToRoles',
            assignmentRule: 'reviewAssignmentRule',
          }}
        />
      ),
    },
    {
      id: 'reviewPriority',
      label: t('workflows.tasks.inspector.when.priority'),
      type: 'select',
      options: TASK_PRIORITY_VALUES.map((priority) => ({
        value: priority,
        label: t(`workflows.tasks.inspector.when.priorities.${priority}`),
      })),
    },
    {
      id: 'reviewDeadline',
      label: t('workflows.tasks.inspector.when.deadline'),
      type: 'custom',
      description: t('workflows.form.invokeAgent.review.deadlineDescription'),
      component: (props) => <DurationCrudField {...props} />,
    },
    {
      id: 'reviewReminders',
      label: t('workflows.tasks.inspector.when.reminders'),
      type: 'custom',
      component: (props) => <TaskRemindersField {...props} />,
    },
    {
      id: 'reviewOnBreach',
      label: t('workflows.tasks.inspector.when.onBreach'),
      type: 'custom',
      component: (props) => <AgentReviewOnBreachField {...props} />,
    },
    {
      id: 'taskDecisions',
      label: t('workflows.tasks.inspector.decisions.label'),
      type: 'custom',
      component: (props) => <TaskDecisionsField {...props} routeOrder={routeOrder} />,
    },
    {
      id: 'taskEditablePrefilled',
      label: t('workflows.tasks.inspector.decisions.editablePrefilled'),
      type: 'custom',
      component: (props) => <TaskEditablePrefilledField {...props} />,
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

    // Error directive fields (spec section 5.9)
    {
      id: 'errorDirectiveMode',
      label: t('workflows.form.errorDirective.mode', 'On failure'),
      type: 'select',
      options: [
        { value: 'fail', label: t('workflows.form.errorDirective.modeFail', 'Fail the instance (default)') },
        {
          value: 'continueWithFallback',
          label: t('workflows.form.errorDirective.modeContinue', 'Continue with a fallback value'),
        },
        {
          value: 'failureQueue',
          label: t('workflows.form.errorDirective.modeQueue', 'Send to the failure queue'),
        },
      ],
      description: t(
        'workflows.form.descriptions.errorDirectiveMode',
        'Fail the instance, continue with a fallback value written to the run context under this step id, or park the run for triage.',
      ),
    },
    {
      id: 'errorDirectiveFallbackValue',
      label: t('workflows.form.errorDirective.fallbackValue', 'Fallback value (JSON)'),
      type: 'textarea',
      placeholder: '{ "ok": false }',
      description: t(
        'workflows.form.descriptions.errorDirectiveFallbackValue',
        'JSON value used when the directive is "Continue with a fallback value". Typed against this step output contract; leave empty to continue without writing anything.',
      ),
    },

    // WaitForCondition fields
    {
      id: 'waitCondition',
      label: '',
      type: 'custom',
      component: (props) => (
        <ConditionBuilder
          value={(props.value as GroupCondition | null) ?? null}
          onChangeAction={(next: GroupCondition) => props.setValue(next)}
          entityType="workflow:wait_condition"
        />
      ),
    },
    {
      id: 'waitConditionTimeout',
      label: t('workflows.form.waitCondition.timeout', 'Timeout'),
      type: 'custom',
      description: t('workflows.form.descriptions.waitConditionTimeout', 'How long to wait before the timeout policy applies. Required.'),
      component: (props) => <DurationCrudField {...props} />,
    },
    {
      id: 'waitConditionOnTimeout',
      label: t('workflows.form.waitCondition.onTimeout', 'On timeout'),
      type: 'select',
      options: [
        { value: 'FAIL', label: t('workflows.form.waitCondition.onTimeoutFail', 'Fail the step') },
        { value: 'CONTINUE', label: t('workflows.form.waitCondition.onTimeoutContinue', 'Continue with timedOut') },
      ],
      description: t(
        'workflows.form.descriptions.waitConditionOnTimeout',
        'Fail the step, or continue with "timedOut" set so an outgoing route can branch on it.',
      ),
    },
    {
      id: 'waitConditionPollIntervalMs',
      label: t('workflows.form.waitCondition.pollIntervalMs', 'Poll interval (ms)'),
      type: 'number',
      placeholder: '30000',
      description: t(
        'workflows.form.descriptions.waitConditionPollIntervalMs',
        'Optional backstop poll interval between 5000 and 3600000 ms, and never longer than the timeout. Defaults to 30000.',
      ),
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
      id: 'routeOrder',
      label: '',
      type: 'custom',
      component: (props) => (
        <RouteOrderEditor
          id={props.id}
          value={props.value as RouteOrderEntry[] | undefined}
          setValue={props.setValue}
          disabled={props.disabled}
        />
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
  ], [activityTypeOptions, showJsonSchemaWarning, ledgerEntries, activityTestContext, node?.type, routeOrder, t])

  if (!isOpen || !node) return null

  const nodeTypeLabel = t(`workflows.nodeTypes.${node.type || 'automated'}`)

  const canDelete = !!onDelete

  return (
    <InspectorPanel
      open={isOpen}
      onClose={onClose}
      variant={variant}
      title={t('workflows.nodeEditor.title')}
      typeLabel={nodeTypeLabel}
      description={t('workflows.nodeEditor.description')}
      recordId={node.id}
    >
      {/* JSON Schema Conversion Warning */}
      {showJsonSchemaWarning && (
        <Alert variant="info" className="mb-4">
          <AlertDescription className="text-xs">
            {t('workflows.nodeEditor.jsonSchemaFormat')}
          </AlertDescription>
        </Alert>
      )}

      {/* Remount when the inspected step changes. A docked rail re-targets on a
          canvas click, and CrudForm deliberately preserves fields the author has
          already edited when `initialValues` changes — correct for late-arriving
          field definitions, wrong here: it would carry an unsaved edit from the
          previous step onto this one. */}
      <CrudForm
        key={node.id}
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

      {/* The rail is too narrow for the side column the 1280px modal used, so
          the ledger stacks under the form. Made collapsible in a follow-up. */}
      <InputDataPanel
        entries={ledgerEntries}
        stepId={node.id}
        samples={samples}
        className="mt-4"
      />
    </InspectorPanel>
  )
}
