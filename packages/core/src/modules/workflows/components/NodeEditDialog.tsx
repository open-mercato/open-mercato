'use client'

import { Node } from '@xyflow/react'
import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@open-mercato/ui/primitives/dialog'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { Label } from '@open-mercato/ui/primitives/label'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Separator } from '@open-mercato/ui/primitives/separator'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { cn } from '@open-mercato/shared/lib/utils'
import { Trash2, ChevronDown, Info, Plus } from 'lucide-react'
import { sanitizeId, validateId } from '../lib/graph-utils'

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
  const [advancedConfig, setAdvancedConfig] = useState('')
  const [formFields, setFormFields] = useState<FormField[]>([])
  const [expandedFields, setExpandedFields] = useState<Set<number>>(new Set())
  const [isJsonSchemaFormat, setIsJsonSchemaFormat] = useState(false)
  // Advanced userTaskConfig fields (Issue 4.3)
  const [assignmentRule, setAssignmentRule] = useState('')
  const [slaDuration, setSlaDuration] = useState('')
  const [escalationRules, setEscalationRules] = useState<any[]>([])

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
      setAdvancedConfig(Object.keys(advancedFields).length > 0 ? JSON.stringify(advancedFields, null, 2) : '')
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

    // Parse advanced config (JSON)
    if (advancedConfig.trim()) {
      try {
        const parsed = JSON.parse(advancedConfig)
        Object.assign(updates, parsed)
      } catch (error) {
        alert('Invalid JSON in Advanced Configuration. Please check your syntax.')
        return
      }
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

  const isEditable = node.type !== 'start' && node.type !== 'end'

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
                {nodeTypeLabel} steps cannot be edited. They represent fixed workflow entry/exit points.
              </AlertDescription>
            </Alert>
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

              {/* Automated Task Configuration */}
              {node.type === 'automated' && (
                <>
                  <div className="border-t border-gray-200 pt-4 mt-4">
                    <h3 className="text-sm font-semibold text-gray-900 mb-3">
                      Automated Task Configuration
                    </h3>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Activity Type
                    </label>
                    <select
                      value={activityType}
                      onChange={(e) => setActivityType(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    >
                      <option value="">-- Select activity type --</option>
                      <option value="CALL_API">Call API</option>
                      <option value="SEND_EMAIL">Send Email</option>
                      <option value="SEND_NOTIFICATION">Send Notification</option>
                      <option value="UPDATE_ENTITY">Update Entity</option>
                      <option value="EXECUTE_BUSINESS_RULE">Execute Business Rule</option>
                      <option value="WAIT">Wait</option>
                    </select>
                    <p className="text-xs text-gray-500 mt-1">
                      Type of automated activity to execute (schema-compliant values only)
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Activity ID
                    </label>
                    <input
                      type="text"
                      value={activityId}
                      onChange={(e) => setActivityId(e.target.value)}
                      placeholder="send_welcome_email"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Unique identifier for this activity
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
                    <textarea
                      value={advancedConfig}
                      onChange={(e) => setAdvancedConfig(e.target.value)}
                      placeholder='{"userTaskConfig": {"formSchema": {...}}, "retryPolicy": {...}}'
                      rows={8}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs font-mono focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
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
          {isEditable && onDelete && (
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
    </Dialog>
  )
}
