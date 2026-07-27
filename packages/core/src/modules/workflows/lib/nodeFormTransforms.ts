/**
 * Node Form Transforms
 *
 * Utilities to convert between React Flow node data structures and CrudForm field values.
 * Handles bidirectional transformation for all 7 node types with proper type safety.
 */

import type { Node } from '@xyflow/react'
import type { FormField } from '../components/fields/FormFieldArrayEditor'
import type { Activity } from '../components/fields/ActivityArrayEditor'
import type { Mapping } from '../components/fields/MappingArrayEditor'
import type { StartPreCondition } from '../components/fields/StartPreConditionsEditor'
import type { AgentInvokeConfigValue } from '../components/fields/AgentInvokeConfigField'
import type { InvokeAgentConfig } from '../data/validators'
import { sanitizeId } from './graph-utils'
import { isFutureIsoDateString, isValidDurationString } from '../data/validators'
import { isPlainRecord, parseAdvancedConfigValue } from './advanced-config'

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

  // Start node pre-conditions
  preConditions?: StartPreCondition[]

  // InvokeAgent fields
  agentConfig?: AgentInvokeConfigValue

  // Advanced configuration. JsonBuilder emits the parsed object; legacy
  // callers may still provide a JSON string.
  advancedConfig?: Record<string, unknown> | string
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
    }
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
      ...(values.slaDuration && { slaDuration: values.slaDuration }),
      ...(values.escalationRules && values.escalationRules.length > 0 && {
        escalationRules: values.escalationRules
      }),
    }
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

    const config: InvokeAgentConfig = {
      // Preserve config the visual editor does not expose (e.g. `subject`).
      ...existingConfig,
      agentId: agent?.agentId || '',
      input: mappingsToRecord(agent?.inputs),
      onResult,
    }
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
