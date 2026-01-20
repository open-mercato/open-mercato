'use client'

import {Node} from '@xyflow/react'
import {useEffect, useState} from 'react'
import {Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle} from '@open-mercato/ui/primitives/dialog'
import {Button} from '@open-mercato/ui/primitives/button'
import {Badge} from '@open-mercato/ui/primitives/badge'
import {Alert, AlertDescription} from '@open-mercato/ui/primitives/alert'
import {ChevronDown, Info, Plus, Trash2} from 'lucide-react'
import {sanitizeId} from '../lib/graph-utils'
import {WorkflowDefinition, WorkflowSelector} from './WorkflowSelector'
import {JsonBuilder} from '@open-mercato/ui/backend/JsonBuilder'
import {StartPreConditionsEditor, type StartPreCondition} from './fields/StartPreConditionsEditor'

export interface NodeEditDialogProps {
  node: Node | null
  isOpen: boolean
  onClose: () => void
  onSave: (nodeId: string, updates: Partial<Node['data']>) => void
  onDelete?: (nodeId: string) => void
}

/**
 * NodeEditDialog - Modal dialog for editing step properties
 *
 * Allows editing:
 * - Label (name)
 * - Description
 * - User task configuration (assignedTo, assignedToRoles, formKey)
 * - Automated task configuration (activityType, activityId)
 */
interface FormField {
  name: string
  type: string
  label: string
  required: boolean
  placeholder?: string
  options?: string[] // For select/radio fields
  defaultValue?: string
}

export function NodeEditDialog({ node, isOpen, onClose, onSave, onDelete }: NodeEditDialogProps) {
  const [stepName, setStepName] = useState('')
  const [description, setDescription] = useState('')
  const [assignedTo, setAssignedTo] = useState('')
  const [assignedToRoles, setAssignedToRoles] = useState('')
  const [formKey, setFormKey] = useState('')
  const [activityType, setActivityType] = useState('')
  const [activityId, setActivityId] = useState('')
  const [timeout, setTimeout] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [advancedConfig, setAdvancedConfig] = useState<Record<string, any>>({})
  const [formFields, setFormFields] = useState<FormField[]>([])
  const [expandedFields, setExpandedFields] = useState<Set<number>>(new Set())
  const [isJsonSchemaFormat, setIsJsonSchemaFormat] = useState(false)
  // Advanced userTaskConfig fields (Issue 4.3)
  const [assignmentRule, setAssignmentRule] = useState('')
  const [slaDuration, setSlaDuration] = useState('')
  const [escalationRules, setEscalationRules] = useState<any[]>([])

  // Sub-workflow configuration fields (Phase 8)
  const [subWorkflowId, setSubWorkflowId] = useState('')
  const [subWorkflowVersion, setSubWorkflowVersion] = useState('')
  const [inputMappings, setInputMappings] = useState<Array<{ key: string; value: string }>>([])
  const [outputMappings, setOutputMappings] = useState<Array<{ key: string; value: string }>>([])
  const [showWorkflowSelector, setShowWorkflowSelector] = useState(false)

  // Wait for signal configuration fields
  const [signalName, setSignalName] = useState('')
  const [signalTimeout, setSignalTimeout] = useState('')

  // Step activities state (for AUTOMATED steps)
  const [stepActivities, setStepActivities] = useState<any[]>([])
  const [expandedStepActivities, setExpandedStepActivities] = useState<Set<number>>(new Set())

  // Pre-conditions state (for START steps)
  const [preConditions, setPreConditions] = useState<StartPreCondition[]>([])

  // Convert JSON Schema to our custom format
  const convertJsonSchemaToFields = (schema: any): FormField[] => {
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

  // Map JSON Schema types to our field types
  const mapJsonSchemaTypeToFieldType = (propDef: any): string => {
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

  // Load node data when dialog opens
  useEffect(() => {
    if (node && isOpen) {
      const nodeData = node.data as any
      setStepName(nodeData?.stepName || nodeData?.label || '')
      setDescription(nodeData?.description || '')
      setAssignedTo(nodeData?.assignedTo || '')
      setAssignedToRoles(nodeData?.assignedToRoles?.join(', ') || '')
      setFormKey(nodeData?.formKey || '')
      setActivityType(nodeData?.activityType || '')
      setActivityId(nodeData?.activityId || '')
      setTimeout(nodeData?.timeout || '')

      // Load advanced userTaskConfig fields (Issue 4.3)
      if (node.type === 'userTask' && nodeData?.userTaskConfig) {
        setAssignmentRule(nodeData.userTaskConfig.assignmentRule || nodeData.assignmentRule || '')
        setSlaDuration(nodeData.userTaskConfig.slaDuration || nodeData.slaDuration || '')
        setEscalationRules(nodeData.userTaskConfig.escalationRules || nodeData.escalationRules || [])
      } else {
        setAssignmentRule('')
        setSlaDuration('')
        setEscalationRules([])
      }

      // Load sub-workflow configuration (Phase 8)
      if (node.type === 'subWorkflow' && nodeData?.config) {
        setSubWorkflowId(nodeData.config.subWorkflowId || '')
        setSubWorkflowVersion(nodeData.config.version?.toString() || '')

        // Convert inputMapping object to array for editing
        if (nodeData.config.inputMapping) {
          const mappings = Object.entries(nodeData.config.inputMapping).map(([key, value]) => ({
            key,
            value: value as string
          }))
          setInputMappings(mappings)
        } else {
          setInputMappings([])
        }

        // Convert outputMapping object to array for editing
        if (nodeData.config.outputMapping) {
          const mappings = Object.entries(nodeData.config.outputMapping).map(([key, value]) => ({
            key,
            value: value as string
          }))
          setOutputMappings(mappings)
        } else {
          setOutputMappings([])
        }
      } else {
        setSubWorkflowId('')
        setSubWorkflowVersion('')
        setInputMappings([])
        setOutputMappings([])
      }

      // Load signal configuration
      if (node.type === 'waitForSignal' && nodeData?.signalConfig) {
        setSignalName(nodeData.signalConfig.signalName || '')
        setSignalTimeout(nodeData.signalConfig.timeout || 'PT5M')
      } else {
        setSignalName('')
        setSignalTimeout('')
      }

      // Load step activities (for AUTOMATED steps)
      if (node.type === 'automated' && nodeData?.activities) {
        setStepActivities(nodeData.activities)
      } else if (node.type === 'automated') {
        setStepActivities([])
      }

      // Load pre-conditions (for START steps)
      if (node.type === 'start' && nodeData?.preConditions) {
        setPreConditions(nodeData.preConditions)
      } else if (node.type === 'start') {
        setPreConditions([])
      }

      // Load form fields from userTaskConfig.formSchema
      if (nodeData?.userTaskConfig?.formSchema) {
        const schema = nodeData.userTaskConfig.formSchema

        // Check if it's our custom format (with fields array) or JSON Schema format
        if (schema.fields && Array.isArray(schema.fields)) {
          // Custom format
          setFormFields(schema.fields)
          setIsJsonSchemaFormat(false)
        } else if (schema.properties) {
          // JSON Schema format - convert to our format
          setFormFields(convertJsonSchemaToFields(schema))
          setIsJsonSchemaFormat(true)
        } else {
          setFormFields([])
          setIsJsonSchemaFormat(false)
        }
      } else {
        setFormFields([])
        setIsJsonSchemaFormat(false)
      }

      // Load advanced config (userTaskConfig for USER_TASK, other custom fields)
      const advancedFields: any = {}
      if (nodeData?.userTaskConfig) {
        advancedFields.userTaskConfig = nodeData.userTaskConfig
      }
      if (nodeData?.retryPolicy) {
        advancedFields.retryPolicy = nodeData.retryPolicy
      }
      setAdvancedConfig(advancedFields)
      setExpandedFields(new Set())
    }
  }, [node, isOpen])

  const addFormField = () => {
    const newField: FormField = {
      name: `field_${Date.now()}`,
      type: 'text',
      label: 'New Field',
      required: false,
      placeholder: '',
    }
    setFormFields([...formFields, newField])
    // Auto-expand the new field
    const newExpanded = new Set(expandedFields)
    newExpanded.add(formFields.length)
    setExpandedFields(newExpanded)
  }

  const removeFormField = (index: number) => {
    if (confirm('Are you sure you want to remove this field?')) {
      setFormFields(formFields.filter((_, i) => i !== index))
      const newExpanded = new Set(expandedFields)
      newExpanded.delete(index)
      setExpandedFields(newExpanded)
    }
  }

  const updateFormField = (index: number, field: keyof FormField, value: any) => {
    const updated = [...formFields]
    updated[index] = { ...updated[index], [field]: value }
    setFormFields(updated)
  }

  const toggleFieldExpanded = (index: number) => {
    const newExpanded = new Set(expandedFields)
    if (newExpanded.has(index)) {
      newExpanded.delete(index)
    } else {
      newExpanded.add(index)
    }
    setExpandedFields(newExpanded)
  }

  const handleWorkflowSelect = (workflowId: string, workflow: WorkflowDefinition) => {
    setSubWorkflowId(workflowId)
    setSubWorkflowVersion(workflow.version.toString())
    setShowWorkflowSelector(false)
  }

  const handleSave = () => {
    if (!node) return

    // Validate and sanitize step ID
    const sanitizedId = sanitizeId(node.id)
    if (sanitizedId !== node.id) {
      alert(`⚠️ Step ID was sanitized from "${node.id}" to "${sanitizedId}" to match schema requirements (lowercase letters, numbers, hyphens, and underscores only).`)
    }

    const updates: Partial<Node['data']> = {
      stepName,
      label: stepName, // Keep label for backward compatibility
      description: description || undefined,
      timeout: timeout || undefined,
    }

    // User task specific fields
    if (node.type === 'userTask') {
      updates.assignedTo = assignedTo || undefined
      updates.assignedToRoles = assignedToRoles
        ? assignedToRoles.split(',').map((r) => r.trim()).filter(Boolean)
        : []
      updates.formKey = formKey || undefined

      // Build userTaskConfig with all fields (Issue 4.3 - preserve advanced fields)
      updates.userTaskConfig = {
        ...(formFields.length > 0 && {
          formSchema: {
            fields: formFields,
          },
        }),
        ...(assignedTo && { assignedTo }),
        ...(assignedToRoles && { assignedToRoles: assignedToRoles.split(',').map((r) => r.trim()).filter(Boolean) }),
        // Preserve advanced fields loaded from node data
        ...(assignmentRule && { assignmentRule }),
        ...(slaDuration && { slaDuration }),
        ...(escalationRules && escalationRules.length > 0 && { escalationRules }),
      }
    }

    // Automated task specific fields
    if (node.type === 'automated') {
      updates.activityType = activityType || undefined
      updates.activityId = activityId || undefined
    }

    // Sub-workflow specific fields (Phase 8)
    if (node.type === 'subWorkflow') {
      const config: any = {}

      if (subWorkflowId) {
        config.subWorkflowId = subWorkflowId
      }

      if (subWorkflowVersion) {
        const versionNum = parseInt(subWorkflowVersion, 10)
        if (!isNaN(versionNum)) {
          config.version = versionNum
        }
      }

      // Convert inputMappings array to object
      if (inputMappings.length > 0) {
        config.inputMapping = inputMappings
          .filter(m => m.key && m.value)
          .reduce((acc, m) => ({ ...acc, [m.key]: m.value }), {})
      }

      // Convert outputMappings array to object
      if (outputMappings.length > 0) {
        config.outputMapping = outputMappings
          .filter(m => m.key && m.value)
          .reduce((acc, m) => ({ ...acc, [m.key]: m.value }), {})
      }

      if (Object.keys(config).length > 0) {
        updates.config = config
      }
    }

    // Wait for signal specific fields
    if (node.type === 'waitForSignal') {
      const config: any = {}

      if (signalName) {
        config.signalName = signalName
      }

      if (signalTimeout) {
        config.timeout = signalTimeout
      }

      if (Object.keys(config).length > 0) {
        updates.signalConfig = config
      }
    }

    // Step activities (for AUTOMATED steps)
    if (node.type === 'automated' && stepActivities.length > 0) {
      updates.activities = stepActivities
    }

    // Pre-conditions (for START steps)
    if (node.type === 'start') {
      // Filter out empty rule IDs
      updates.preConditions = preConditions.filter(pc => pc.ruleId && pc.ruleId.trim())
    }

    // Merge advanced config
    if (advancedConfig && Object.keys(advancedConfig).length > 0) {
      Object.assign(updates, advancedConfig)
    }

    onSave(sanitizedId, updates)
    onClose()
  }

  const handleDelete = () => {
    if (!node || !onDelete) return
    if (confirm(`Are you sure you want to delete the step "${stepName || node.id}"?`)) {
      onDelete(node.id)
      onClose()
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      handleSave()
    }
    if (e.key === 'Escape') {
      onClose()
    }
  }

  if (!isOpen || !node) return null

  const nodeTypeLabel = {
    start: 'START',
    end: 'END',
    userTask: 'USER TASK',
    automated: 'AUTOMATED',
    decision: 'DECISION',
  }[node.type || 'automated']

  // START nodes are partially editable (pre-conditions only), END nodes are not editable
  const isEditable = node.type !== 'end'
  const isStartNode = node.type === 'start'

  const badgeVariant =
    node.type === 'start' ? 'default' :
    node.type === 'end' ? 'secondary' :
    node.type === 'userTask' ? 'outline' : 'muted'

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-2 mb-2">
            <DialogTitle>Edit Step</DialogTitle>
            <Badge variant={badgeVariant}>
              {nodeTypeLabel}
            </Badge>
          </div>
          <div className="space-y-1 text-sm text-muted-foreground">
            <div className="flex items-center gap-2 text-xs">
              <span className="font-medium">ID:</span>
              <code className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono">{node.id}</code>
            </div>
            {(node.data as any)?.stepName && (
              <div className="flex items-center gap-2 text-xs">
                <span className="font-medium">Name:</span>
                <span>{(node.data as any).stepName}</span>
              </div>
            )}
          </div>
        </DialogHeader>

        <div className="space-y-4">
          {!isEditable ? (
            <Alert variant="info">
              <Info className="size-4" />
              <AlertDescription>
                END steps cannot be edited. They represent fixed workflow exit points.
              </AlertDescription>
            </Alert>
          ) : isStartNode ? (
            <div className="space-y-4">
              {/* Info Alert for START nodes */}
              <Alert variant="info">
                <Info className="size-4" />
                <AlertDescription>
                  START steps mark the beginning of the workflow. You can define pre-conditions that must pass before the workflow can be started.
                </AlertDescription>
              </Alert>

              {/* Pre-Conditions Editor for START nodes */}
              <StartPreConditionsEditor
                value={preConditions}
                setValue={setPreConditions}
              />
            </div>
          ) : (
            <div className="space-y-4">
              {/* Step Name */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Step Name *
                </label>
                <input
                  type="text"
                  value={stepName}
                  onChange={(e) => setStepName(e.target.value)}
                  placeholder="Enter step name"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  autoFocus
                />
                <p className="text-xs text-gray-500 mt-1">
                  Display name shown on the step
                </p>
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Description
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Optional description"
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Additional context about this step
                </p>
              </div>

              {/* Timeout */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Timeout
                </label>
                <input
                  type="text"
                  value={timeout}
                  onChange={(e) => setTimeout(e.target.value)}
                  placeholder="PT30S or 30000"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                <p className="text-xs text-gray-500 mt-1">
                  ISO 8601 duration (e.g., PT30S) or milliseconds (e.g., 30000)
                </p>
              </div>

              {/* User Task Configuration */}
              {node.type === 'userTask' && (
                <>
                  <div className="border-t border-gray-200 pt-4 mt-4">
                    <h3 className="text-sm font-semibold text-gray-900 mb-3">
                      User Task Configuration
                    </h3>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Assigned To (User ID)
                    </label>
                    <input
                      type="text"
                      value={assignedTo}
                      onChange={(e) => setAssignedTo(e.target.value)}
                      placeholder="user123"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Specific user ID to assign this task to
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Assigned To Roles
                    </label>
                    <input
                      type="text"
                      value={assignedToRoles}
                      onChange={(e) => setAssignedToRoles(e.target.value)}
                      placeholder="Manager, Reviewer"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Comma-separated list of roles (e.g., "Manager, Reviewer")
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Form Key
                    </label>
                    <input
                      type="text"
                      value={formKey}
                      onChange={(e) => setFormKey(e.target.value)}
                      placeholder="approval_form"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Identifier for the form to display to users
                    </p>
                  </div>

                  {/* Form Schema Builder */}
                  <div className="border-t border-gray-200 pt-4 mt-4">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <h3 className="text-sm font-semibold text-gray-900">
                          Form Fields ({formFields.length})
                        </h3>
                        <p className="text-xs text-gray-500 mt-0.5">
                          Define the form structure for this user task
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        onClick={addFormField}
                      >
                        <Plus className="size-3 mr-1" />
                        Add Field
                      </Button>
                    </div>

                    {/* JSON Schema Format Notice */}
                    {isJsonSchemaFormat && (
                      <Alert variant="info" className="mb-3">
                        <Info className="size-4" />
                        <AlertDescription>
                          This form uses JSON Schema format. Fields have been converted for visual editing.
                          When you save, it will be converted to the simplified format. To preserve the original JSON Schema,
                          edit it in the "Advanced Configuration (JSON)" section below.
                        </AlertDescription>
                      </Alert>
                    )}

                    {formFields.length === 0 && (
                      <div className="p-4 text-center text-sm text-gray-500 bg-gray-50 rounded-lg border border-gray-200">
                        No form fields defined. Click "Add Field" to create one.
                      </div>
                    )}

                    <div className="space-y-2">
                      {formFields.map((field, index) => {
                        const isExpanded = expandedFields.has(index)
                        return (
                          <div key={index} className="border border-gray-200 rounded-lg bg-gray-50">
                            <button
                              type="button"
                              onClick={() => toggleFieldExpanded(index)}
                              className="w-full px-4 py-3 text-left flex items-center justify-between hover:bg-gray-100 transition-colors rounded-t-lg"
                            >
                              <div className="flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-semibold text-gray-900">
                                    {field.label || field.name}
                                  </span>
                                  <Badge variant="secondary" className="text-xs">
                                    {field.type}
                                  </Badge>
                                  {field.required && (
                                    <Badge variant="destructive" className="text-xs text-white">
                                      Required
                                    </Badge>
                                  )}
                                </div>
                                <p className="text-xs text-gray-600 mt-1">
                                  Field name: <code className="bg-white px-1 rounded">{field.name}</code>
                                </p>
                              </div>
                              <ChevronDown
                                className={`w-5 h-5 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                              />
                            </button>

                            {isExpanded && (
                              <div className="px-4 pb-4 space-y-3 border-t border-gray-200 bg-white">
                                {/* Field Name */}
                                <div className="pt-3">
                                  <label className="block text-xs font-medium text-gray-700 mb-1">Field Name *</label>
                                  <input
                                    type="text"
                                    value={field.name}
                                    onChange={(e) => updateFormField(index, 'name', e.target.value)}
                                    className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                                    placeholder="field_name"
                                  />
                                  <p className="text-xs text-gray-500 mt-0.5">Unique identifier for this field</p>
                                </div>

                                {/* Field Label */}
                                <div>
                                  <label className="block text-xs font-medium text-gray-700 mb-1">Field Label *</label>
                                  <input
                                    type="text"
                                    value={field.label}
                                    onChange={(e) => updateFormField(index, 'label', e.target.value)}
                                    className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                                    placeholder="Field Label"
                                  />
                                  <p className="text-xs text-gray-500 mt-0.5">Display label shown to users</p>
                                </div>

                                {/* Field Type */}
                                <div>
                                  <label className="block text-xs font-medium text-gray-700 mb-1">Field Type *</label>
                                  <select
                                    value={field.type}
                                    onChange={(e) => updateFormField(index, 'type', e.target.value)}
                                    className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                                  >
                                    <option value="text">Text</option>
                                    <option value="number">Number</option>
                                    <option value="email">Email</option>
                                    <option value="tel">Phone</option>
                                    <option value="url">URL</option>
                                    <option value="textarea">Text Area</option>
                                    <option value="select">Select (Dropdown)</option>
                                    <option value="radio">Radio Buttons</option>
                                    <option value="checkbox">Checkbox</option>
                                    <option value="date">Date</option>
                                    <option value="time">Time</option>
                                    <option value="datetime-local">Date & Time</option>
                                  </select>
                                </div>

                                {/* Placeholder */}
                                <div>
                                  <label className="block text-xs font-medium text-gray-700 mb-1">Placeholder</label>
                                  <input
                                    type="text"
                                    value={field.placeholder || ''}
                                    onChange={(e) => updateFormField(index, 'placeholder', e.target.value)}
                                    className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                                    placeholder="Enter placeholder text..."
                                  />
                                </div>

                                {/* Default Value */}
                                <div>
                                  <label className="block text-xs font-medium text-gray-700 mb-1">Default Value</label>
                                  <input
                                    type="text"
                                    value={field.defaultValue || ''}
                                    onChange={(e) => updateFormField(index, 'defaultValue', e.target.value)}
                                    className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                                    placeholder="Default value..."
                                  />
                                </div>

                                {/* Options (for select/radio) */}
                                {(field.type === 'select' || field.type === 'radio') && (
                                  <div>
                                    <label className="block text-xs font-medium text-gray-700 mb-1">Options (comma-separated)</label>
                                    <input
                                      type="text"
                                      value={field.options?.join(', ') || ''}
                                      onChange={(e) => updateFormField(index, 'options', e.target.value.split(',').map(o => o.trim()).filter(Boolean))}
                                      className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                                      placeholder="Option 1, Option 2, Option 3"
                                    />
                                    <p className="text-xs text-gray-500 mt-0.5">Comma-separated list of options</p>
                                  </div>
                                )}

                                {/* Required Checkbox */}
                                <div>
                                  <label className="flex items-center gap-2 text-xs font-medium text-gray-700">
                                    <input
                                      type="checkbox"
                                      checked={field.required}
                                      onChange={(e) => updateFormField(index, 'required', e.target.checked)}
                                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                    />
                                    Required field
                                  </label>
                                </div>

                                {/* Delete Button */}
                                <div className="border-t border-gray-200 pt-3">
                                  <Button
                                    type="button"
                                    variant="destructive"
                                    size="sm"
                                    onClick={() => removeFormField(index)}
                                  >
                                    <Trash2 className="size-4 mr-1" />
                                    Remove Field
                                  </Button>
                                </div>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </>
              )}

              {/* Automated Step Activities */}
              {node.type === 'automated' && (
                <>
                  <div className="border-t border-gray-200 pt-4 mt-4">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <h3 className="text-sm font-semibold text-gray-900">
                          Step Activities ({stepActivities.length})
                        </h3>
                        <p className="text-xs text-gray-500 mt-0.5">
                          Activities to execute when this step runs
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => {
                          setStepActivities([
                            ...stepActivities,
                            {
                              activityId: `activity_${stepActivities.length + 1}`,
                              activityName: `Activity ${stepActivities.length + 1}`,
                              activityType: 'CALL_API',
                              config: {},
                              async: false,
                            },
                          ])
                        }}
                      >
                        <Plus className="size-3 mr-1" />
                        Add Activity
                      </Button>
                    </div>

                    {stepActivities.length === 0 && (
                      <div className="p-4 text-center text-sm text-gray-500 bg-gray-50 rounded-lg border border-gray-200">
                        No activities defined. Click "Add Activity" to create one.
                      </div>
                    )}

                    <div className="space-y-2">
                      {stepActivities.map((activity, index) => {
                        const isExpanded = expandedStepActivities.has(index)
                        return (
                          <div key={index} className="border border-gray-200 rounded-lg bg-gray-50">
                            {/* Activity Header (Collapsed) */}
                            <button
                              type="button"
                              onClick={() => {
                                const newExpanded = new Set(expandedStepActivities)
                                if (isExpanded) {
                                  newExpanded.delete(index)
                                } else {
                                  newExpanded.add(index)
                                }
                                setExpandedStepActivities(newExpanded)
                              }}
                              className="w-full px-4 py-3 text-left flex items-center justify-between hover:bg-gray-100 transition-colors rounded-t-lg"
                            >
                              <div className="flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-semibold text-gray-900">
                                    {activity.activityName || activity.activityId || `Activity ${index + 1}`}
                                  </span>
                                  <Badge variant="secondary" className="text-xs">
                                    {activity.activityType}
                                  </Badge>
                                  {activity.async && (
                                    <Badge variant="outline" className="text-xs">
                                      Async
                                    </Badge>
                                  )}
                                </div>
                                <p className="text-xs text-gray-600 mt-1">
                                  ID: <code className="bg-white px-1 rounded">{activity.activityId}</code>
                                </p>
                              </div>
                              <ChevronDown
                                className={`w-5 h-5 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                              />
                            </button>

                            {/* Activity Body (Expanded) */}
                            {isExpanded && (
                              <div className="px-4 pb-4 space-y-3 border-t border-gray-200 bg-white">
                                {/* Activity ID */}
                                <div className="pt-3">
                                  <label className="block text-xs font-medium text-gray-700 mb-1">
                                    Activity ID *
                                  </label>
                                  <input
                                    type="text"
                                    value={activity.activityId}
                                    onChange={(e) => {
                                      const updated = [...stepActivities]
                                      updated[index].activityId = e.target.value
                                      setStepActivities(updated)
                                    }}
                                    className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs focus:ring-1 focus:ring-blue-500"
                                    placeholder="send_email"
                                  />
                                </div>

                                {/* Activity Name */}
                                <div>
                                  <label className="block text-xs font-medium text-gray-700 mb-1">
                                    Activity Name *
                                  </label>
                                  <input
                                    type="text"
                                    value={activity.activityName || ''}
                                    onChange={(e) => {
                                      const updated = [...stepActivities]
                                      updated[index].activityName = e.target.value
                                      setStepActivities(updated)
                                    }}
                                    className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs focus:ring-1 focus:ring-blue-500"
                                    placeholder="Send Welcome Email"
                                  />
                                </div>

                                {/* Activity Type */}
                                <div>
                                  <label className="block text-xs font-medium text-gray-700 mb-1">
                                    Activity Type *
                                  </label>
                                  <select
                                    value={activity.activityType}
                                    onChange={(e) => {
                                      const updated = [...stepActivities]
                                      updated[index].activityType = e.target.value
                                      setStepActivities(updated)
                                    }}
                                    className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs focus:ring-1 focus:ring-blue-500"
                                  >
                                    <option value="SEND_EMAIL">Send Email</option>
                                    <option value="CALL_API">Call API</option>
                                    <option value="UPDATE_ENTITY">Update Entity</option>
                                    <option value="EMIT_EVENT">Emit Event</option>
                                    <option value="CALL_WEBHOOK">Call Webhook</option>
                                    <option value="EXECUTE_FUNCTION">Execute Function</option>
                                  </select>
                                </div>

                                {/* Timeout */}
                                <div>
                                  <label className="block text-xs font-medium text-gray-700 mb-1">
                                    Timeout
                                  </label>
                                  <input
                                    type="text"
                                    value={activity.timeoutMs || ''}
                                    onChange={(e) => {
                                      const updated = [...stepActivities]
                                      updated[index].timeoutMs = e.target.value ? parseInt(e.target.value) : undefined
                                      setStepActivities(updated)
                                    }}
                                    className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs focus:ring-1 focus:ring-blue-500"
                                    placeholder="30000"
                                  />
                                  <p className="text-xs text-gray-500 mt-1">Timeout in milliseconds (e.g., 30000 = 30 seconds)</p>
                                </div>

                                {/* Retry Policy Grid */}
                                <div className="border border-gray-200 rounded-lg p-3 bg-gray-50">
                                  <label className="block text-xs font-semibold text-gray-700 mb-2">
                                    Retry Policy
                                  </label>
                                  <div className="grid grid-cols-2 gap-2">
                                    <div>
                                      <label className="block text-xs text-gray-600 mb-1">Max Attempts</label>
                                      <input
                                        type="number"
                                        value={activity.retryPolicy?.maxAttempts || 1}
                                        onChange={(e) => {
                                          const updated = [...stepActivities]
                                          if (!updated[index].retryPolicy) updated[index].retryPolicy = {}
                                          updated[index].retryPolicy.maxAttempts = parseInt(e.target.value) || 1
                                          setStepActivities(updated)
                                        }}
                                        min="1"
                                        max="10"
                                        className="w-full px-2 py-1 border border-gray-300 rounded text-xs"
                                      />
                                    </div>
                                    <div>
                                      <label className="block text-xs text-gray-600 mb-1">Initial Interval (ms)</label>
                                      <input
                                        type="number"
                                        value={activity.retryPolicy?.initialIntervalMs || 1000}
                                        onChange={(e) => {
                                          const updated = [...stepActivities]
                                          if (!updated[index].retryPolicy) updated[index].retryPolicy = {}
                                          updated[index].retryPolicy.initialIntervalMs = parseInt(e.target.value) || 1000
                                          setStepActivities(updated)
                                        }}
                                        className="w-full px-2 py-1 border border-gray-300 rounded text-xs"
                                      />
                                    </div>
                                    <div>
                                      <label className="block text-xs text-gray-600 mb-1">Backoff Coefficient</label>
                                      <input
                                        type="number"
                                        step="0.1"
                                        value={activity.retryPolicy?.backoffCoefficient || 2}
                                        onChange={(e) => {
                                          const updated = [...stepActivities]
                                          if (!updated[index].retryPolicy) updated[index].retryPolicy = {}
                                          updated[index].retryPolicy.backoffCoefficient = parseFloat(e.target.value) || 2
                                          setStepActivities(updated)
                                        }}
                                        className="w-full px-2 py-1 border border-gray-300 rounded text-xs"
                                      />
                                    </div>
                                    <div>
                                      <label className="block text-xs text-gray-600 mb-1">Max Interval (ms)</label>
                                      <input
                                        type="number"
                                        value={activity.retryPolicy?.maxIntervalMs || 60000}
                                        onChange={(e) => {
                                          const updated = [...stepActivities]
                                          if (!updated[index].retryPolicy) updated[index].retryPolicy = {}
                                          updated[index].retryPolicy.maxIntervalMs = parseInt(e.target.value) || 60000
                                          setStepActivities(updated)
                                        }}
                                        className="w-full px-2 py-1 border border-gray-300 rounded text-xs"
                                      />
                                    </div>
                                  </div>
                                </div>

                                {/* Activity Flags */}
                                <div className="flex gap-4">
                                  <label className="flex items-center gap-2 cursor-pointer">
                                    <input
                                      type="checkbox"
                                      checked={activity.async || false}
                                      onChange={(e) => {
                                        const updated = [...stepActivities]
                                        updated[index].async = e.target.checked
                                        setStepActivities(updated)
                                      }}
                                      className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                                    />
                                    <span className="text-xs text-gray-700">Execute Asynchronously</span>
                                  </label>
                                </div>

                                {/* Activity Config JSON */}
                                <div>
                                  <label className="block text-xs font-medium text-gray-700 mb-1">
                                    Configuration (JSON)
                                  </label>
                                  <JsonBuilder
                                    value={activity.config || {}}
                                    onChange={(config) => {
                                      const updated = [...stepActivities]
                                      updated[index].config = config
                                      setStepActivities(updated)
                                    }}
                                  />
                                  <p className="text-xs text-gray-500 mt-1">
                                    Activity-specific configuration. Supports variable interpolation: {`{{context.field}}`}, {`{{workflow.instanceId}}`}
                                  </p>
                                </div>

                                {/* Delete Button */}
                                <div className="pt-3 border-t border-gray-100">
                                  <Button
                                    type="button"
                                    variant="destructive"
                                    size="sm"
                                    onClick={() => {
                                      setStepActivities(stepActivities.filter((_, i) => i !== index))
                                      const newExpanded = new Set(expandedStepActivities)
                                      newExpanded.delete(index)
                                      setExpandedStepActivities(newExpanded)
                                    }}
                                  >
                                    <Trash2 className="size-3 mr-1" />
                                    Delete Activity
                                  </Button>
                                </div>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </>
              )}

              {/* Sub-Workflow Configuration (Phase 8) */}
              {node.type === 'subWorkflow' && (
                <>
                  <div className="border-t border-gray-200 pt-4 mt-4">
                    <h3 className="text-sm font-semibold text-gray-900 mb-3">
                      Sub-Workflow Configuration
                    </h3>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Workflow to Invoke *
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={subWorkflowId}
                        onChange={(e) => setSubWorkflowId(e.target.value)}
                        placeholder="child-workflow"
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        readOnly
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setShowWorkflowSelector(true)}
                      >
                        Browse...
                      </Button>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                      Workflow ID of the sub-workflow to invoke
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Version
                    </label>
                    <input
                      type="number"
                      value={subWorkflowVersion}
                      onChange={(e) => setSubWorkflowVersion(e.target.value)}
                      placeholder="Latest version"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Specific version to invoke (leave empty for latest)
                    </p>
                  </div>

                  {/* Input Mapping */}
                  <div className="border-t border-gray-200 pt-4 mt-4">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <h4 className="text-sm font-semibold text-gray-900">
                          Input Mapping ({inputMappings.length})
                        </h4>
                        <p className="text-xs text-gray-500 mt-0.5">
                          Map data from parent workflow to child workflow context
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => setInputMappings([...inputMappings, { key: '', value: '' }])}
                      >
                        <Plus className="size-3 mr-1" />
                        Add Mapping
                      </Button>
                    </div>

                    {inputMappings.length === 0 ? (
                      <p className="text-sm text-gray-500 italic">
                        No input mappings. Entire parent context will be passed to child.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {inputMappings.map((mapping, index) => (
                          <div key={index} className="flex gap-2 items-start">
                            <div className="flex-1">
                              <input
                                type="text"
                                value={mapping.key}
                                onChange={(e) => {
                                  const newMappings = [...inputMappings]
                                  newMappings[index].key = e.target.value
                                  setInputMappings(newMappings)
                                }}
                                placeholder="childKey"
                                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500"
                              />
                              <p className="text-xs text-gray-500 mt-0.5">Target key in child context</p>
                            </div>
                            <span className="text-gray-400 mt-2">→</span>
                            <div className="flex-1">
                              <input
                                type="text"
                                value={mapping.value}
                                onChange={(e) => {
                                  const newMappings = [...inputMappings]
                                  newMappings[index].value = e.target.value
                                  setInputMappings(newMappings)
                                }}
                                placeholder="parent.field.path"
                                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500"
                              />
                              <p className="text-xs text-gray-500 mt-0.5">Source path in parent context</p>
                            </div>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setInputMappings(inputMappings.filter((_, i) => i !== index))
                              }}
                              className="mt-1"
                            >
                              <Trash2 className="size-3" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Output Mapping */}
                  <div className="border-t border-gray-200 pt-4 mt-4">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <h4 className="text-sm font-semibold text-gray-900">
                          Output Mapping ({outputMappings.length})
                        </h4>
                        <p className="text-xs text-gray-500 mt-0.5">
                          Map data from child workflow back to parent context
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => setOutputMappings([...outputMappings, { key: '', value: '' }])}
                      >
                        <Plus className="size-3 mr-1" />
                        Add Mapping
                      </Button>
                    </div>

                    {outputMappings.length === 0 ? (
                      <p className="text-sm text-gray-500 italic">
                        No output mappings. Entire child context will be returned to parent.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {outputMappings.map((mapping, index) => (
                          <div key={index} className="flex gap-2 items-start">
                            <div className="flex-1">
                              <input
                                type="text"
                                value={mapping.key}
                                onChange={(e) => {
                                  const newMappings = [...outputMappings]
                                  newMappings[index].key = e.target.value
                                  setOutputMappings(newMappings)
                                }}
                                placeholder="parentKey"
                                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500"
                              />
                              <p className="text-xs text-gray-500 mt-0.5">Target key in parent context</p>
                            </div>
                            <span className="text-gray-400 mt-2">←</span>
                            <div className="flex-1">
                              <input
                                type="text"
                                value={mapping.value}
                                onChange={(e) => {
                                  const newMappings = [...outputMappings]
                                  newMappings[index].value = e.target.value
                                  setOutputMappings(newMappings)
                                }}
                                placeholder="child.result.path"
                                className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm focus:ring-2 focus:ring-blue-500"
                              />
                              <p className="text-xs text-gray-500 mt-0.5">Source path in child context</p>
                            </div>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setOutputMappings(outputMappings.filter((_, i) => i !== index))
                              }}
                              className="mt-1"
                            >
                              <Trash2 className="size-3" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* Wait for Signal Configuration */}
              {node.type === 'waitForSignal' && (
                <>
                  <div className="border-t border-gray-200 pt-4 mt-4">
                    <h3 className="text-sm font-semibold text-gray-900 mb-3">
                      Signal Configuration
                    </h3>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Signal Name *
                    </label>
                    <input
                      type="text"
                      value={signalName}
                      onChange={(e) => setSignalName(e.target.value)}
                      placeholder="payment_confirmed"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Name of the signal to wait for (e.g., payment_confirmed, approval_received)
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Timeout
                    </label>
                    <input
                      type="text"
                      value={signalTimeout}
                      onChange={(e) => setSignalTimeout(e.target.value)}
                      placeholder="PT5M"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      ISO 8601 duration (e.g., PT5M for 5 minutes, PT1H for 1 hour, PT30S for 30 seconds)
                    </p>
                  </div>
                </>
              )}

              {/* Advanced Configuration */}
              <div className="border-t border-gray-200 pt-4 mt-4">
                <button
                  type="button"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="flex items-center justify-between w-full text-left"
                >
                  <h3 className="text-sm font-semibold text-gray-900">
                    Advanced Configuration (JSON)
                  </h3>
                  <svg
                    className={`w-5 h-5 transition-transform ${showAdvanced ? 'rotate-180' : ''}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {showAdvanced && (
                  <div className="mt-3">
                    <JsonBuilder
                      value={advancedConfig}
                      onChange={setAdvancedConfig}
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Add custom fields like userTaskConfig, retryPolicy, or other step-specific configuration
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="flex justify-between">
          {onDelete && (
            <Button
              type="button"
              variant="destructive"
              onClick={handleDelete}
            >
              <Trash2 className="size-4" />
              Delete Step
            </Button>
          )}
          <div className="flex gap-2 ml-auto">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
            >
              Cancel
            </Button>
            {isEditable && (
              <Button
                type="button"
                onClick={handleSave}
              >
                Save Changes
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>

      {/* Workflow Selector Dialog */}
      {node?.type === 'subWorkflow' && (
        <WorkflowSelector
          isOpen={showWorkflowSelector}
          onClose={() => setShowWorkflowSelector(false)}
          onSelect={handleWorkflowSelect}
          excludeWorkflowIds={[]}
          title="Select Sub-Workflow"
          description="Choose a workflow to invoke as a sub-workflow step"
          onlyEnabled={true}
        />
      )}
    </Dialog>
  )
}
