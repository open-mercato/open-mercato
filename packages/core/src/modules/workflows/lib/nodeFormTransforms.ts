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
import { sanitizeId } from './graph-utils'

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
  assignedToRoles?: string // Comma-separated in form
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

  // Advanced configuration (JSON)
  advancedConfig?: string
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
    values.assignedToRoles = nodeData?.assignedToRoles?.join(', ') || ''
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

  // Advanced config (preserve all fields not explicitly handled)
  const advancedFields: any = {}
  if (nodeData?.userTaskConfig) {
    advancedFields.userTaskConfig = nodeData.userTaskConfig
  }
  if (nodeData?.retryPolicy) {
    advancedFields.retryPolicy = nodeData.retryPolicy
  }
  values.advancedConfig = Object.keys(advancedFields).length > 0
    ? JSON.stringify(advancedFields, null, 2)
    : ''

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
    updates.assignedTo = values.assignedTo || undefined
    updates.assignedToRoles = values.assignedToRoles
      ? values.assignedToRoles.split(',').map((r) => r.trim()).filter(Boolean)
      : []
    updates.formKey = values.formKey || undefined

    // Build userTaskConfig with all fields
    updates.userTaskConfig = {
      ...(values.formFields && values.formFields.length > 0 && {
        formSchema: {
          fields: values.formFields,
        },
      }),
      ...(values.assignedTo && { assignedTo: values.assignedTo }),
      ...(values.assignedToRoles && {
        assignedToRoles: values.assignedToRoles.split(',').map((r) => r.trim()).filter(Boolean)
      }),
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

  // Parse advanced config (JSON) and merge
  if (values.advancedConfig && values.advancedConfig.trim()) {
    try {
      const parsed = JSON.parse(values.advancedConfig)
      Object.assign(updates, parsed)
    } catch (error) {
      console.error('Invalid JSON in Advanced Configuration:', error)
      throw new Error('Invalid JSON in Advanced Configuration. Please check your syntax.')
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
