/**
 * Node Form Transforms
 *
 * Utilities to convert between React Flow node data structures and CrudForm field values.
 * Handles bidirectional transformation for all 7 node types with proper type safety.
 */

import type { Node } from '@xyflow/react'
import type { SwitchRoutesValue } from './branching-routes'
import type { RouteOrderEntry } from './route-priority'
import type { FormField } from '../components/fields/FormFieldArrayEditor'
import type { Activity } from '../components/fields/ActivityArrayEditor'
import type { Mapping } from '../components/fields/MappingArrayEditor'
import type { StartPreCondition } from '../components/fields/StartPreConditionsEditor'
import type { AgentInvokeConfigValue, AgentSubjectValue } from '../components/fields/AgentInvokeConfigField'
import type { InvokeAgentConfig, UserTaskAssigneeKind, UserTaskConfig } from '../data/validators'
import { sanitizeId } from './graph-utils'
import { isFutureIsoDateString, isValidDurationString } from '../data/validators'
import { isPlainRecord, parseAdvancedConfigValue } from './advanced-config'
import {
  applyEditedTaskText,
  coerceAssignmentModeToAssigneeKind,
  decisionsToDrafts,
  deriveTaskAssigneeKind,
  deriveTaskAssignmentMode,
  draftsToDecisions,
  draftsToEntityBindings,
  draftToOnBreach,
  entityBindingsToDrafts,
  flattenTaskTextForEditing,
  isTaskAssigneeKind,
  isTaskPriority,
  offsetsToReminders,
  onBreachToDraft,
  remindersToOffsets,
  resolveTaskAssigneeKindPersistence,
  resolveTaskDeadlinePersistence,
  type TaskAssignmentMode,
  type TaskDecisionDraft,
  type TaskEntityBindingDraft,
  type TaskOnBreachDraft,
} from './task-inspector-config'
import {
  agentReviewToFormValues,
  formValuesToAgentReview,
  type AgentReviewFormValues,
  type AgentReviewOnBreachDraft,
} from './agent-review-inspector'

// userTaskConfig keys owned by dedicated form fields. At dialog load they are
// EXCLUDED from the Advanced Configuration blob (only genuinely unhandled keys
// travel through it), and at save the freshly built structured config is
// authoritative over anything the advanced blob still carries for these keys.
const USER_TASK_STRUCTURED_CONFIG_KEYS = [
  'formSchema',
  'assignedTo',
  'assignedToRoles',
  'assignmentRule',
  'slaDuration',
  'escalationRules',
  // Task inspector vocabulary (spec §6.1). Structural from here on: the five
  // inspector sections own these keys, so they must not ALSO travel through the
  // Advanced Configuration blob where a stale copy could win on save.
  'instructions',
  'entityBindings',
  'priority',
  'deadline',
  'reminders',
  'onBreach',
  'decisions',
  'editablePrefilled',
  // The §7.1 portal audience, owned by the "Who" section's audience picker.
  'assigneeKind',
] as const

/**
 * Inspector keys mirrored onto `node.data` by `definitionToGraph`. Both places
 * are read (top level first, exactly as `graphToDefinition` resolves them), and
 * a save writes BOTH so clearing a value in the inspector cannot be undone by a
 * stale top-level copy left over from the load.
 */
const USER_TASK_INSPECTOR_NODE_KEYS = [
  'instructions',
  'entityBindings',
  'priority',
  'deadline',
  'reminders',
  'onBreach',
  'decisions',
  'editablePrefilled',
  'assigneeKind',
] as const

// Signal name the INVOKE_AGENT step parks on when a proposal is routed to a
// human. Mirrors INVOKE_AGENT_SIGNAL_NAME in lib/activity-executor.ts —
// duplicated here to avoid pulling server-only deps into the client bundle.
const INVOKE_AGENT_SIGNAL_NAME = 'agent_orchestrator.proposal.ready'

type InvokeAgentActivity = {
  activityId?: string
  activityName?: string
  activityType?: string
  config?: Partial<InvokeAgentConfig>
}

function findInvokeAgentActivity(node: Node): InvokeAgentActivity | undefined {
  const activities = (node.data as any)?.activities as InvokeAgentActivity[] | undefined
  if (!Array.isArray(activities)) return undefined
  return activities.find((activity) => activity?.activityType === 'INVOKE_AGENT')
}

function findInvokeAgentConfig(node: Node): Partial<InvokeAgentConfig> {
  return findInvokeAgentActivity(node)?.config || {}
}

const SUBJECT_FORM_KEYS = ['subjectType', 'subjectId', 'subjectLabel'] as const

function subjectToFormValue(subject: unknown): AgentSubjectValue {
  const record = isPlainRecord(subject) ? subject : {}
  return {
    subjectType: typeof record.subjectType === 'string' ? record.subjectType : '',
    subjectId: typeof record.subjectId === 'string' ? record.subjectId : '',
    subjectLabel: typeof record.subjectLabel === 'string' ? record.subjectLabel : '',
  }
}

/**
 * Writes the three edited subject keys back onto the stored descriptor while
 * preserving every other key the editor does not expose (the enterprise
 * projection accepts a passthrough shape). A subject left entirely blank is
 * removed rather than persisted as empty strings.
 */
function formValueToSubject(
  existing: unknown,
  edited: AgentSubjectValue | undefined,
): Record<string, unknown> | undefined {
  const next: Record<string, unknown> = isPlainRecord(existing) ? { ...existing } : {}
  for (const key of SUBJECT_FORM_KEYS) {
    const value = edited?.[key]?.trim() ?? ''
    if (value) next[key] = value
    else delete next[key]
  }
  return Object.keys(next).length > 0 ? next : undefined
}

function mappingsToRecord(rows: Mapping[] | undefined): Record<string, string> {
  return (rows || []).reduce<Record<string, string>>((acc, row) => {
    const key = row.key.trim()
    if (key) acc[key] = row.value
    return acc
  }, {})
}

/**
 * Form values interface matching CrudForm field structure
 */
export interface NodeFormValues {
  // Common fields (all node types)
  stepName: string
  description?: string
  timeout?: string

  // UserTask fields
  assignedTo?: string
  assignedToRoles?: string[] | string // Array from RolesMultiSelect; legacy comma-separated string still accepted
  formKey?: string
  formFields?: FormField[]
  assignmentRule?: string
  slaDuration?: string
  escalationRules?: any[]

  // Task inspector sections (spec §6.1). Editor-side drafts: the mapping back
  // onto `userTaskConfig` lives in `lib/task-inspector-config.ts`, which is
  // where the "untouched means unchanged" rules are stated and tested.
  assignmentMode?: TaskAssignmentMode
  /**
   * Which principal namespace this task is addressed to (§7.1). Editor-side
   * only: `'user'` is the absent-by-default backoffice audience, so it is not
   * necessarily written back — `resolveTaskAssigneeKindPersistence` decides.
   */
  taskAssigneeKind?: UserTaskAssigneeKind
  taskInstructions?: string
  taskEntityBindings?: TaskEntityBindingDraft[]
  taskPriority?: string
  taskReminders?: string[]
  taskOnBreach?: TaskOnBreachDraft
  taskDecisions?: TaskDecisionDraft[]
  taskEditablePrefilled?: string[]

  // Automated fields
  activityType?: string
  activityId?: string
  stepActivities?: Activity[]

  // SubWorkflow fields
  subWorkflowId?: string
  subWorkflowVersion?: string
  inputMappings?: Mapping[]
  outputMappings?: Mapping[]

  // WaitForSignal fields
  signalName?: string
  signalTimeout?: string

  // WaitForTimer fields
  timerDuration?: string
  timerUntil?: string

  // WaitForCondition fields. The predicate is a business_rules
  // ConditionExpression, edited with the shared ConditionBuilder.
  waitCondition?: unknown
  waitConditionTimeout?: string
  waitConditionOnTimeout?: string
  waitConditionPollIntervalMs?: string | number

  // Error directive (spec section 5.9): what happens when this step fails and
  // no error route is wired. 'fail' (or unset) keeps today's behavior.
  errorDirectiveMode?: string
  errorDirectiveFallbackValue?: string

  // Start node pre-conditions
  preConditions?: StartPreCondition[]

  // Branching (IF_ELSE / SWITCH) outgoing routes — edited in the node dialog,
  // applied to edges by the editor page, never written into step data.
  branchingRoutes?: SwitchRoutesValue

  // Outgoing route order of a non-branching step (spec 4.4). Same contract as
  // branchingRoutes: transition state, applied to edges, never step data.
  routeOrder?: RouteOrderEntry[]

  // InvokeAgent fields
  agentConfig?: AgentInvokeConfigValue

  // The Invoke Agent node's Review section (spec §7.5). Editor-side drafts; the
  // mapping back onto the INVOKE_AGENT activity config lives in
  // `lib/agent-review-inspector.ts`, which owns the "untouched means unchanged"
  // rule the task inspector states for its own keys.
  reviewAssignmentMode?: TaskAssignmentMode
  reviewAssignedTo?: string
  reviewAssignedToRoles?: string[]
  reviewAssignmentRule?: string
  reviewPriority?: string
  reviewDeadline?: string
  reviewReminders?: string[]
  reviewOnBreach?: AgentReviewOnBreachDraft

  // Advanced configuration. JsonBuilder emits the parsed object; legacy
  // callers may still provide a JSON string.
  advancedConfig?: Record<string, unknown> | string
}

/**
 * The inspector vocabulary as the engine would resolve it: `definitionToGraph`
 * mirrors each key onto `node.data`, and `graphToDefinition` reads the top-level
 * copy FIRST (`node.data[key] ?? node.data.userTaskConfig?.[key]`). Reading it
 * the same way here is what keeps the dialog showing what a save would persist.
 */
function readUserTaskInspectorConfig(node: Node): Partial<UserTaskConfig> {
  const nodeData = (node.data ?? {}) as Record<string, unknown>
  const stored = isPlainRecord(nodeData.userTaskConfig) ? nodeData.userTaskConfig : {}
  const merged: Record<string, unknown> = { ...stored }
  for (const key of USER_TASK_INSPECTOR_NODE_KEYS) {
    if (nodeData[key] !== undefined) merged[key] = nodeData[key]
  }
  return merged as Partial<UserTaskConfig>
}

function normalizeAssignedToRoles(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((role) => (typeof role === 'string' ? role.trim() : ''))
      .filter(Boolean)
  }
  if (typeof value === 'string') {
    return value.split(',').map((role) => role.trim()).filter(Boolean)
  }
  return []
}

/**
 * Convert JSON Schema format to custom FormField format
 */
function convertJsonSchemaToFields(schema: any): FormField[] {
  if (!schema || !schema.properties) return []

  const fields: FormField[] = []
  const properties = schema.properties
  const required = schema.required || []

  for (const [name, prop] of Object.entries(properties)) {
    const propDef = prop as any
    const field: FormField = {
      name,
      type: mapJsonSchemaTypeToFieldType(propDef),
      label: propDef.title || name,
      required: required.includes(name),
      placeholder: propDef.description || undefined,
    }

    // Handle enum for select fields
    if (propDef.enum) {
      field.options = propDef.enum
    }

    // Handle default value
    if (propDef.default !== undefined) {
      field.defaultValue = String(propDef.default)
    }

    fields.push(field)
  }

  return fields
}

/**
 * Map JSON Schema types to FormField types
 */
function mapJsonSchemaTypeToFieldType(propDef: any): string {
  if (propDef.enum) return 'select'

  switch (propDef.type) {
    case 'string':
      if (propDef.format === 'email') return 'email'
      if (propDef.format === 'uri') return 'url'
      if (propDef.format === 'date') return 'date'
      if (propDef.format === 'time') return 'time'
      if (propDef.format === 'date-time') return 'datetime-local'
      if (propDef.maxLength && propDef.maxLength > 200) return 'textarea'
      return 'text'
    case 'number':
    case 'integer':
      return 'number'
    case 'boolean':
      return 'checkbox'
    default:
      return 'text'
  }
}

/**
 * Convert Node data to CrudForm values
 *
 * Handles all 7 node types: start, end, userTask, automated, subWorkflow, waitForSignal, decision
 */
export function nodeToFormValues(node: Node): NodeFormValues {
  const nodeData = node.data as any

  const values: NodeFormValues = {
    stepName: nodeData?.stepName || nodeData?.label || '',
    description: nodeData?.description || '',
    timeout: nodeData?.timeout || '',
  }

  const errorDirective = nodeData?.errorDirective
  if (isPlainRecord(errorDirective)) {
    values.errorDirectiveMode = typeof errorDirective.mode === 'string' ? errorDirective.mode : 'fail'
    values.errorDirectiveFallbackValue =
      errorDirective.fallbackValue === undefined ? '' : JSON.stringify(errorDirective.fallbackValue, null, 2)
  } else {
    values.errorDirectiveMode = 'fail'
    values.errorDirectiveFallbackValue = ''
  }

  // UserTask fields
  if (node.type === 'userTask') {
    values.assignedTo = nodeData?.assignedTo || ''
    values.assignedToRoles = normalizeAssignedToRoles(nodeData?.assignedToRoles)
    values.formKey = nodeData?.formKey || ''

    // Advanced userTaskConfig fields
    if (nodeData?.userTaskConfig) {
      values.assignmentRule = nodeData.userTaskConfig.assignmentRule || nodeData.assignmentRule || ''
      values.slaDuration = nodeData.userTaskConfig.slaDuration || nodeData.slaDuration || ''
      values.escalationRules = nodeData.userTaskConfig.escalationRules || nodeData.escalationRules || []
    }

    // Task inspector sections (spec §6.1). The deadline control edits whichever
    // key carries the duration, so it seeds from `deadline` first and falls back
    // to the legacy bare `slaDuration`.
    const inspectorConfig = readUserTaskInspectorConfig(node)
    if (inspectorConfig.deadline?.duration) values.slaDuration = inspectorConfig.deadline.duration
    // The audience gates which assignment tabs the engine can honour, so the tab
    // a stored config opens on is derived against it rather than on its own.
    values.taskAssigneeKind = deriveTaskAssigneeKind(inspectorConfig)
    values.assignmentMode = coerceAssignmentModeToAssigneeKind(
      deriveTaskAssignmentMode({
        assignedTo: values.assignedTo,
        assignmentRule: values.assignmentRule,
      }),
      values.taskAssigneeKind,
    )
    values.taskInstructions = flattenTaskTextForEditing(inspectorConfig.instructions)
    values.taskEntityBindings = entityBindingsToDrafts(inspectorConfig.entityBindings)
    values.taskPriority = isTaskPriority(inspectorConfig.priority) ? inspectorConfig.priority : ''
    values.taskReminders = remindersToOffsets(inspectorConfig.reminders)
    values.taskOnBreach = onBreachToDraft(inspectorConfig.onBreach)
    values.taskDecisions = decisionsToDrafts(inspectorConfig.decisions)
    values.taskEditablePrefilled = Array.isArray(inspectorConfig.editablePrefilled)
      ? [...inspectorConfig.editablePrefilled]
      : []

    // Load form fields from userTaskConfig.formSchema
    if (nodeData?.userTaskConfig?.formSchema) {
      const schema = nodeData.userTaskConfig.formSchema

      // Check if it's our custom format (with fields array) or JSON Schema format
      if (schema.fields && Array.isArray(schema.fields)) {
        // Custom format
        values.formFields = schema.fields
      } else if (schema.properties) {
        // JSON Schema format - convert to our format
        values.formFields = convertJsonSchemaToFields(schema)
      } else {
        values.formFields = []
      }
    } else {
      values.formFields = []
    }
  }

  // Automated fields
  if (node.type === 'automated') {
    values.activityType = nodeData?.activityType || ''
    values.activityId = nodeData?.activityId || ''
    values.stepActivities = nodeData?.activities || []
  }

  // SubWorkflow fields
  if (node.type === 'subWorkflow' && nodeData?.config) {
    values.subWorkflowId = nodeData.config.subWorkflowId || ''
    values.subWorkflowVersion = nodeData.config.version?.toString() || ''

    // Convert inputMapping object to array for editing
    if (nodeData.config.inputMapping) {
      values.inputMappings = Object.entries(nodeData.config.inputMapping).map(([key, value]) => ({
        key,
        value: value as string
      }))
    } else {
      values.inputMappings = []
    }

    // Convert outputMapping object to array for editing
    if (nodeData.config.outputMapping) {
      values.outputMappings = Object.entries(nodeData.config.outputMapping).map(([key, value]) => ({
        key,
        value: value as string
      }))
    } else {
      values.outputMappings = []
    }
  }

  // WaitForSignal fields
  if (node.type === 'waitForSignal' && nodeData?.signalConfig) {
    values.signalName = nodeData.signalConfig.signalName || ''
    values.signalTimeout = nodeData.signalConfig.timeout || 'PT5M'
  }

  // WaitForTimer fields
  if (node.type === 'waitForTimer') {
    values.timerDuration = nodeData?.config?.duration || ''
    values.timerUntil = nodeData?.config?.until || ''
  }

  // WaitForCondition fields
  if (node.type === 'waitForCondition') {
    const config = nodeData?.config || {}
    values.waitCondition = config.condition ?? null
    values.waitConditionTimeout = config.timeout || ''
    values.waitConditionOnTimeout = config.onTimeout === 'CONTINUE' ? 'CONTINUE' : 'FAIL'
    values.waitConditionPollIntervalMs =
      typeof config.pollIntervalMs === 'number' ? String(config.pollIntervalMs) : ''
  }

  // Start node pre-conditions
  if (node.type === 'start' && nodeData?.preConditions) {
    values.preConditions = nodeData.preConditions
  } else if (node.type === 'start') {
    values.preConditions = []
  }

  // InvokeAgent fields. The node stores its config on the single INVOKE_AGENT
  // activity inside node.data.activities (see formValuesToNodeUpdates).
  if (node.type === 'invokeAgent') {
    const config = findInvokeAgentConfig(node)
    const inputEntries = Object.entries(config.input || {})
    const onResult = config.onResult
    values.agentConfig = {
      agentId: config.agentId || '',
      inputs:
        inputEntries.length > 0
          ? inputEntries.map(([key, value]) => ({
              key,
              value: typeof value === 'string' ? value : JSON.stringify(value),
            }))
          : [{ key: 'dealId', value: '{{deal.id}}' }],
      resultMode: onResult && 'alwaysAsk' in onResult ? 'alwaysAsk' : 'autoApprove',
      autoApproveThreshold:
        onResult && 'autoApproveThreshold' in onResult ? String(onResult.autoApproveThreshold) : '0.8',
      outputs: Object.entries(config.outputMapping || {}).map(([key, value]) => ({
        key,
        value: String(value),
      })),
      subject: subjectToFormValue(config.subject),
    }
    Object.assign(values, agentReviewToFormValues(config.review))
  }

  // Advanced config (preserve only fields not explicitly handled by form fields)
  const advancedFields: Record<string, unknown> = {}
  if (isPlainRecord(nodeData?.userTaskConfig)) {
    if (node.type === 'userTask') {
      const unhandledEntries = Object.entries(nodeData.userTaskConfig).filter(
        ([key]) => !USER_TASK_STRUCTURED_CONFIG_KEYS.includes(key as (typeof USER_TASK_STRUCTURED_CONFIG_KEYS)[number]),
      )
      if (unhandledEntries.length > 0) {
        advancedFields.userTaskConfig = Object.fromEntries(unhandledEntries)
      }
    } else {
      advancedFields.userTaskConfig = nodeData.userTaskConfig
    }
  }
  if (nodeData?.retryPolicy) {
    advancedFields.retryPolicy = nodeData.retryPolicy
  }
  values.advancedConfig = Object.keys(advancedFields).length > 0 ? advancedFields : undefined

  return values
}

/**
 * Convert CrudForm values back to Node data updates
 *
 * Returns partial node data to be merged with existing node data.
 * Handles sanitization and validation.
 */
export function formValuesToNodeUpdates(
  values: NodeFormValues,
  node: Node
): Partial<Node['data']> {
  const updates: Partial<Node['data']> = {
    stepName: values.stepName,
    label: values.stepName, // Keep label for backward compatibility
    description: values.description || undefined,
    timeout: values.timeout || undefined,
  }

  // UserTask specific fields
  if (node.type === 'userTask') {
    const assignedToRoles = normalizeAssignedToRoles(values.assignedToRoles)
    updates.assignedTo = values.assignedTo || undefined
    updates.assignedToRoles = assignedToRoles
    updates.formKey = values.formKey || undefined

    // Task inspector sections (spec §6.1). Every value below is optional and
    // absent-by-default: a step whose inspector sections were never touched
    // produces exactly the config it produced before this section existed.
    const inspectorConfig = readUserTaskInspectorConfig(node)
    const deadline = resolveTaskDeadlinePersistence(inspectorConfig, values.slaDuration ?? '')
    const instructions = applyEditedTaskText(inspectorConfig.instructions, values.taskInstructions ?? '')
    const entityBindings = draftsToEntityBindings(values.taskEntityBindings)
    const priority = isTaskPriority(values.taskPriority) ? values.taskPriority : undefined
    const reminders = offsetsToReminders(values.taskReminders)
    const onBreach = draftToOnBreach(values.taskOnBreach)
    const decisions = draftsToDecisions(values.taskDecisions)
    const editablePrefilled = values.taskEditablePrefilled?.filter((entry) => entry.trim().length > 0)
    // Only `'customer'` is written: the backoffice audience is what an absent
    // key has always meant, so a step nobody re-addressed adds no key.
    const assigneeKind = resolveTaskAssigneeKindPersistence(
      inspectorConfig.assigneeKind,
      isTaskAssigneeKind(values.taskAssigneeKind) ? values.taskAssigneeKind : 'user',
    )

    // Build userTaskConfig with all fields
    updates.userTaskConfig = {
      ...(values.formFields && values.formFields.length > 0 && {
        formSchema: {
          fields: values.formFields,
        },
      }),
      ...(values.assignedTo && { assignedTo: values.assignedTo }),
      ...(assignedToRoles.length > 0 && { assignedToRoles }),
      // Preserve advanced fields
      ...(values.assignmentRule && { assignmentRule: values.assignmentRule }),
      ...deadline,
      ...(values.escalationRules && values.escalationRules.length > 0 && {
        escalationRules: values.escalationRules
      }),
      ...(instructions !== undefined && { instructions }),
      ...(entityBindings !== undefined && { entityBindings }),
      ...(priority !== undefined && { priority }),
      ...(reminders !== undefined && { reminders }),
      ...(onBreach !== undefined && { onBreach }),
      ...(decisions !== undefined && { decisions }),
      ...(editablePrefilled?.length ? { editablePrefilled } : {}),
      ...(assigneeKind !== undefined && { assigneeKind }),
    }

    // Mirror onto `node.data` so a CLEARED value cannot be resurrected by the
    // copy `definitionToGraph` left at the top level (`graphToDefinition` reads
    // the top-level key first).
    updates.instructions = instructions
    updates.entityBindings = entityBindings
    updates.priority = priority
    updates.deadline = deadline.deadline
    updates.slaDuration = deadline.slaDuration
    updates.reminders = reminders
    updates.onBreach = onBreach
    updates.decisions = decisions
    updates.editablePrefilled = editablePrefilled?.length ? editablePrefilled : undefined
    updates.assigneeKind = assigneeKind
  }

  // Automated task specific fields
  if (node.type === 'automated') {
    updates.activityType = values.activityType || undefined
    updates.activityId = values.activityId || undefined

    // Step activities
    if (values.stepActivities && values.stepActivities.length > 0) {
      updates.activities = values.stepActivities
    }
  }

  // SubWorkflow specific fields
  if (node.type === 'subWorkflow') {
    const config: any = {}

    if (values.subWorkflowId) {
      config.subWorkflowId = values.subWorkflowId
    }

    if (values.subWorkflowVersion) {
      const versionNum = parseInt(values.subWorkflowVersion, 10)
      if (!isNaN(versionNum)) {
        config.version = versionNum
      }
    }

    // Convert inputMappings array to object
    if (values.inputMappings && values.inputMappings.length > 0) {
      config.inputMapping = values.inputMappings
        .filter(m => m.key && m.value)
        .reduce((acc, m) => ({ ...acc, [m.key]: m.value }), {})
    }

    // Convert outputMappings array to object
    if (values.outputMappings && values.outputMappings.length > 0) {
      config.outputMapping = values.outputMappings
        .filter(m => m.key && m.value)
        .reduce((acc, m) => ({ ...acc, [m.key]: m.value }), {})
    }

    if (Object.keys(config).length > 0) {
      updates.config = config
    }
  }

  // WaitForSignal specific fields
  if (node.type === 'waitForSignal') {
    const config: any = {}

    if (values.signalName) {
      config.signalName = values.signalName
    }

    if (values.signalTimeout) {
      config.timeout = values.signalTimeout
    }

    if (Object.keys(config).length > 0) {
      updates.signalConfig = config
    }
  }

  // WaitForTimer specific fields (duration XOR until)
  if (node.type === 'waitForTimer') {
    const duration = typeof values.timerDuration === 'string' ? values.timerDuration.trim() : ''
    const until = typeof values.timerUntil === 'string' ? values.timerUntil.trim() : ''

    if (duration && until) {
      throw new Error('workflows.validation.timerDurationXorUntil')
    }
    if (!duration && !until) {
      throw new Error('workflows.validation.timerDurationOrUntilRequired')
    }
    if (duration && !isValidDurationString(duration)) {
      throw new Error('workflows.validation.invalidDuration')
    }
    if (until && !isFutureIsoDateString(until)) {
      throw new Error('workflows.validation.untilMustBeFuture')
    }

    updates.config = duration ? { duration } : { until }
  }

  // WaitForCondition specific fields. Fail closed at author time on the two
  // mandatory pieces; the full rule set (expression safety, poll bounds,
  // outgoing transition) is enforced by the definition schema on save.
  if (node.type === 'waitForCondition') {
    const condition = values.waitCondition
    if (!isPlainRecord(condition)) {
      throw new Error('workflows.validation.conditionRequired')
    }

    const timeout = typeof values.waitConditionTimeout === 'string' ? values.waitConditionTimeout.trim() : ''
    if (!timeout) {
      throw new Error('workflows.validation.conditionTimeoutRequired')
    }
    if (!isValidDurationString(timeout)) {
      throw new Error('workflows.validation.invalidDuration')
    }

    const config: Record<string, unknown> = {
      condition,
      timeout,
      onTimeout: values.waitConditionOnTimeout === 'CONTINUE' ? 'CONTINUE' : 'FAIL',
    }

    const rawPollInterval = values.waitConditionPollIntervalMs
    const pollIntervalText = typeof rawPollInterval === 'number' ? String(rawPollInterval) : (rawPollInterval ?? '').trim()
    if (pollIntervalText) {
      const pollIntervalMs = Number(pollIntervalText)
      if (!Number.isInteger(pollIntervalMs)) {
        throw new Error('workflows.validation.conditionPollIntervalInvalid')
      }
      config.pollIntervalMs = pollIntervalMs
    }

    updates.config = config
  }

  // Start node pre-conditions
  if (node.type === 'start') {
    if (values.preConditions && values.preConditions.length > 0) {
      // Filter out empty rule IDs
      updates.preConditions = values.preConditions.filter(pc => pc.ruleId && pc.ruleId.trim())
    } else {
      updates.preConditions = []
    }
  }

  // InvokeAgent step. Compiles to an AUTOMATED step (mapped in graph-utils)
  // carrying ONE INVOKE_AGENT activity plus a signalConfig so the step-handler
  // can park-and-resume the human path. Mirrors the legacy NodeEditDialog.
  if (node.type === 'invokeAgent') {
    const agent = values.agentConfig
    const existingActivity = findInvokeAgentActivity(node)
    const existingConfig = existingActivity?.config || {}
    const outputMapping = mappingsToRecord(agent?.outputs)

    const onResult: InvokeAgentConfig['onResult'] =
      agent?.resultMode === 'alwaysAsk'
        ? { alwaysAsk: true }
        : { autoApproveThreshold: Number.parseFloat(agent?.autoApproveThreshold ?? '') || 0 }

    const subject = formValueToSubject(existingConfig.subject, agent?.subject)
    const review = formValuesToAgentReview(values as Partial<AgentReviewFormValues>)
    const config: InvokeAgentConfig = {
      // Preserve config the visual editor does not expose.
      ...existingConfig,
      agentId: agent?.agentId || '',
      input: mappingsToRecord(agent?.inputs),
      onResult,
    }
    // A CLEARED Review section must not be resurrected by the copy
    // `...existingConfig` carried in, which is why this deletes rather than
    // merely skipping the assignment.
    if (review) config.review = review
    else delete config.review
    if (subject) config.subject = subject
    else delete config.subject
    if (Object.keys(outputMapping).length > 0) {
      config.outputMapping = outputMapping
    } else {
      delete config.outputMapping
    }

    updates.agentId = config.agentId || undefined
    updates.activities = [
      {
        activityId: existingActivity?.activityId || 'invoke_agent',
        activityName: existingActivity?.activityName || 'Invoke Agent',
        activityType: 'INVOKE_AGENT',
        config,
      },
    ]
    updates.signalConfig = { signalName: INVOKE_AGENT_SIGNAL_NAME }
  }

  // Merge the advanced config (object from JsonBuilder, or legacy JSON string).
  // Error directive (spec section 5.9). Only a non-default directive is written,
  // so a step whose picker was never touched saves byte-identically.
  const errorDirectiveMode = values.errorDirectiveMode
  if (errorDirectiveMode === 'continueWithFallback' || errorDirectiveMode === 'failureQueue') {
    const directive: Record<string, unknown> = { mode: errorDirectiveMode }
    const rawFallback = (values.errorDirectiveFallbackValue ?? '').trim()
    if (errorDirectiveMode === 'continueWithFallback' && rawFallback) {
      try {
        directive.fallbackValue = JSON.parse(rawFallback)
      } catch {
        throw new Error('workflows.validation.errorDirectiveFallbackInvalid')
      }
    }
    updates.errorDirective = directive
  } else {
    updates.errorDirective = undefined
  }

  // For user tasks the structured fields are authoritative: the advanced blob
  // only contributes keys the dialog does not handle structurally.
  const advanced = parseAdvancedConfigValue(values.advancedConfig)
  if (advanced) {
    const structuredUserTaskConfig =
      node.type === 'userTask' && isPlainRecord(updates.userTaskConfig) ? updates.userTaskConfig : undefined
    Object.assign(updates, advanced)
    if (structuredUserTaskConfig) {
      const advancedUserTaskConfig = isPlainRecord(advanced.userTaskConfig) ? { ...advanced.userTaskConfig } : {}
      for (const key of USER_TASK_STRUCTURED_CONFIG_KEYS) {
        delete advancedUserTaskConfig[key]
      }
      updates.userTaskConfig = { ...advancedUserTaskConfig, ...structuredUserTaskConfig }
    }
  }

  return updates
}

/**
 * Check if form fields are in JSON Schema format
 * (used to show conversion warning)
 */
export function isJsonSchemaFormat(node: Node): boolean {
  const nodeData = node.data as any
  if (node.type !== 'userTask') return false

  const schema = nodeData?.userTaskConfig?.formSchema
  if (!schema) return false

  // JSON Schema format has properties, not fields
  return Boolean(schema.properties && !schema.fields)
}
