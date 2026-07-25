'use client'

import type {Node} from '@xyflow/react'
import {useEffect, useState} from 'react'
import {Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle} from '@open-mercato/ui/primitives/dialog'
import {Button} from '@open-mercato/ui/primitives/button'
import {Input} from '@open-mercato/ui/primitives/input'
import {Textarea} from '@open-mercato/ui/primitives/textarea'
import {Checkbox} from '@open-mercato/ui/primitives/checkbox'
import {Badge} from '@open-mercato/ui/primitives/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import {Alert, AlertDescription} from '@open-mercato/ui/primitives/alert'
import {ChevronDown, Plus, Trash2} from 'lucide-react'
import {sanitizeId} from '../lib/graph-utils'
import {WorkflowDefinition, WorkflowSelector} from './WorkflowSelector'
import {JsonBuilder} from '@open-mercato/ui/backend/JsonBuilder'
import {StartPreConditionsEditor, type StartPreCondition} from './fields/StartPreConditionsEditor'
import {useT} from '@open-mercato/shared/lib/i18n/context'
import {useDialogKeyHandler} from '@open-mercato/ui/hooks/useDialogKeyHandler'
import {useConfirmDialog} from '@open-mercato/ui/backend/confirm-dialog'
import {isFutureIsoDateString, isValidDurationString} from '../data/validators'

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
  const t = useT()
  const { confirm: confirmDialog, ConfirmDialogElement } = useConfirmDialog()
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

  // Wait for timer configuration fields
  const [timerDuration, setTimerDuration] = useState('')
  const [timerUntil, setTimerUntil] = useState('')

  // Step activities state (for AUTOMATED steps)
  const [stepActivities, setStepActivities] = useState<any[]>([])
  const [expandedStepActivities, setExpandedStepActivities] = useState<Set<number>>(new Set())

  // Pre-conditions state (for START steps)
  const [preConditions, setPreConditions] = useState<StartPreCondition[]>([])

  // Inline validation errors keyed by field name
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

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

      // Load timer configuration
      if (node.type === 'waitForTimer') {
        setTimerDuration(nodeData?.config?.duration || '')
        setTimerUntil(nodeData?.config?.until || '')
      } else {
        setTimerDuration('')
        setTimerUntil('')
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
      setFieldErrors({})
    }
  }, [node, isOpen])

  const addFormField = () => {
    const newField: FormField = {
      name: `field_${Date.now()}`,
      type: 'text',
      label: t('workflows.form.newField'),
      required: false,
      placeholder: '',
    }
    setFormFields(prev => [...prev, newField])
    // Auto-expand the new field
    const newExpanded = new Set(expandedFields)
    newExpanded.add(formFields.length)
    setExpandedFields(newExpanded)
  }

  const removeFormField = async (index: number) => {
    const confirmed = await confirmDialog({
      title: t('workflows.confirm.removeField'),
      variant: 'destructive',
    })
    if (confirmed) {
      setFormFields(prev => prev.filter((_, i) => i !== index))
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

    // Pre-save validation for wait-related fields. Surface inline errors instead
    // of silently saving an invalid value that will only blow up later when the
    // whole workflow is serialized through the API zod schema.
    const errors: Record<string, string> = {}

    if (node.type === 'waitForTimer') {
      if (timerDuration && !isValidDurationString(timerDuration)) {
        errors.timerDuration = t('workflows.validation.invalidDuration')
      }
      if (timerUntil && !isFutureIsoDateString(timerUntil)) {
        errors.timerUntil = t('workflows.validation.untilMustBeFuture')
      }
    }

    if (node.type === 'waitForSignal' && signalTimeout && !isValidDurationString(signalTimeout)) {
      errors.signalTimeout = t('workflows.validation.invalidDuration')
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors)
      return
    }
    setFieldErrors({})

    // Validate and sanitize step ID
    const sanitizedId = sanitizeId(node.id)
    if (sanitizedId !== node.id) {
      alert(t('workflows.nodeEditor.stepIdSanitized', { from: node.id, to: sanitizedId }))
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

    // Wait for timer specific fields (duration XOR until)
    if (node.type === 'waitForTimer') {
      const config: any = {}
      if (timerDuration) {
        config.duration = timerDuration
      } else if (timerUntil) {
        config.until = timerUntil
      }
      updates.config = Object.keys(config).length > 0 ? config : undefined
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
    onDelete(node.id)
  }

  const handleKeyDown = useDialogKeyHandler({ onConfirm: handleSave, onCancel: onClose })

  if (!isOpen || !node) return null

  const nodeTypeLabel = {
    start: t('workflows.nodeTypes.start'),
    end: t('workflows.nodeTypes.end'),
    userTask: t('workflows.nodeTypes.userTask'),
    automated: t('workflows.nodeTypes.automated'),
    decision: t('workflows.nodeTypes.decision'),
    waitForSignal: t('workflows.nodeTypes.waitForSignal'),
    waitForTimer: t('workflows.nodeTypes.waitForTimer'),
    subWorkflow: t('workflows.nodeTypes.subWorkflow'),
    parallelFork: t('workflows.nodeTypes.parallelFork'),
    parallelJoin: t('workflows.nodeTypes.parallelJoin'),
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
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <div className="flex items-center gap-2 mb-2">
            <DialogTitle>{t('workflows.nodeEditor.title')}</DialogTitle>
            <Badge variant={badgeVariant}>
              {nodeTypeLabel}
            </Badge>
          </div>
          <div className="space-y-1 text-sm text-muted-foreground">
            <div className="flex items-center gap-2 text-xs">
              <span className="font-medium">{t('workflows.fields.id')}:</span>
              <code className="px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono">{node.id}</code>
            </div>
            {(node.data as any)?.stepName && (
              <div className="flex items-center gap-2 text-xs">
                <span className="font-medium">{t('workflows.fields.name')}:</span>
                <span>{(node.data as any).stepName}</span>
              </div>
            )}
          </div>
        </DialogHeader>

        <div className="space-y-4">
          {!isEditable ? (
            <Alert variant="info">
              <AlertDescription>
                {t('workflows.nodeEditor.endStepsNotEditable')}
              </AlertDescription>
            </Alert>
          ) : isStartNode ? (
            <div className="space-y-4">
              {/* Info Alert for START nodes */}
              <Alert variant="info">
                <AlertDescription>
                  {t('workflows.nodeEditor.startStepsInfo')}
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
                <label className="block text-sm font-medium text-foreground mb-1">
                  {t('workflows.form.stepName')} *
                </label>
                <Input
                  type="text"
                  value={stepName}
                  onChange={(e) => setStepName(e.target.value)}
                  placeholder={t('workflows.form.placeholders.stepName')}
                  autoFocus
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {t('workflows.form.descriptions.stepName')}
                </p>
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  {t('workflows.form.description')}
                </label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t('workflows.form.placeholders.description')}
                  rows={3}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {t('workflows.form.descriptions.description')}
                </p>
              </div>

              {/* Timeout — hidden for wait nodes that already expose their own time-bound config
                  (waitForTimer uses duration/until, waitForSignal uses signalConfig.timeout). */}
              {node.type !== 'waitForSignal' && node.type !== 'waitForTimer' && (
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">
                    {t('workflows.form.timeout')}
                  </label>
                  <Input
                    type="text"
                    value={timeout}
                    onChange={(e) => setTimeout(e.target.value)}
                    placeholder={t('workflows.form.placeholders.timeout')}
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    {t('workflows.form.descriptions.timeout')}
                  </p>
                </div>
              )}

              {/* User Task Configuration */}
              {node.type === 'userTask' && (
                <>
                  <div className="border-t border-border pt-4 mt-4">
                    <h3 className="text-sm font-semibold text-foreground mb-3">
                      {t('workflows.nodeEditor.userTaskConfig')}
                    </h3>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1">
                      {t('workflows.form.assignedTo')}
                    </label>
                    <Input
                      type="text"
                      value={assignedTo}
                      onChange={(e) => setAssignedTo(e.target.value)}
                      placeholder={t('workflows.form.placeholders.userId')}
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      {t('workflows.form.descriptions.assignedTo')}
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1">
                      {t('workflows.form.assignedToRoles')}
                    </label>
                    <Input
                      type="text"
                      value={assignedToRoles}
                      onChange={(e) => setAssignedToRoles(e.target.value)}
                      placeholder={t('workflows.form.placeholders.roles')}
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      {t('workflows.form.descriptions.assignedToRoles')}
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1">
                      {t('workflows.form.formKey')}
                    </label>
                    <Input
                      type="text"
                      value={formKey}
                      onChange={(e) => setFormKey(e.target.value)}
                      placeholder={t('workflows.form.placeholders.formKey')}
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      {t('workflows.form.descriptions.formKey')}
                    </p>
                  </div>

                  {/* Form Schema Builder */}
                  <div className="border-t border-border pt-4 mt-4">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <h3 className="text-sm font-semibold text-foreground">
                          {t('workflows.form.formFields', { count: formFields.length })}
                        </h3>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {t('workflows.form.descriptions.formFields')}
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        onClick={addFormField}
                      >
                        <Plus className="size-3 mr-1" />
                        {t('workflows.form.addField')}
                      </Button>
                    </div>

                    {/* JSON Schema Format Notice */}
                    {isJsonSchemaFormat && (
                      <Alert variant="info" className="mb-3">
                        <AlertDescription>
                          {t('workflows.nodeEditor.jsonSchemaFormat')}
                        </AlertDescription>
                      </Alert>
                    )}

                    {formFields.length === 0 && (
                      <div className="p-4 text-center text-sm text-muted-foreground bg-muted rounded-lg border border-border">
                        {t('workflows.nodeEditor.noFormFields')}
                      </div>
                    )}

                    <div className="space-y-2">
                      {formFields.map((field, index) => {
                        const isExpanded = expandedFields.has(index)
                        return (
                          <div key={index} className="border border-border rounded-lg bg-muted">
                            <Button
                              type="button"
                              variant="ghost"
                              onClick={() => toggleFieldExpanded(index)}
                              className="h-auto w-full justify-between rounded-t-lg px-4 py-3 text-left hover:bg-muted/80"
                            >
                              <div className="flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-semibold text-foreground">
                                    {field.label || field.name}
                                  </span>
                                  <Badge variant="secondary" className="text-xs">
                                    {field.type}
                                  </Badge>
                                  {field.required && (
                                    <Badge variant="destructive" className="text-xs">
                                      {t('workflows.form.required')}
                                    </Badge>
                                  )}
                                </div>
                                <p className="text-xs text-muted-foreground mt-1">
                                  Field name: <code className="bg-background px-1 rounded">{field.name}</code>
                                </p>
                              </div>
                              <ChevronDown
                                className={`size-5 text-muted-foreground transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                              />
                            </Button>

                            {isExpanded && (
                              <div className="px-4 pb-4 space-y-3 border-t border-border bg-background">
                                {/* Field Name */}
                                <div className="pt-3">
                                  <label className="block text-xs font-medium text-foreground mb-1">{t('workflows.form.fieldName')} *</label>
                                  <Input
                                    type="text"
                                    size="sm"
                                    value={field.name}
                                    onChange={(e) => updateFormField(index, 'name', e.target.value)}
                                    placeholder={t('workflows.form.placeholders.fieldName')}
                                  />
                                  <p className="text-xs text-muted-foreground mt-0.5">{t('workflows.form.descriptions.fieldName')}</p>
                                </div>

                                {/* Field Label */}
                                <div>
                                  <label className="block text-xs font-medium text-foreground mb-1">{t('workflows.form.fieldLabel')} *</label>
                                  <Input
                                    type="text"
                                    size="sm"
                                    value={field.label}
                                    onChange={(e) => updateFormField(index, 'label', e.target.value)}
                                    placeholder={t('workflows.form.placeholders.fieldLabel')}
                                  />
                                  <p className="text-xs text-muted-foreground mt-0.5">{t('workflows.form.descriptions.fieldLabel')}</p>
                                </div>

                                {/* Field Type */}
                                <div>
                                  <label className="block text-xs font-medium text-foreground mb-1">{t('workflows.form.fieldType')} *</label>
                                  <Select
                                    value={field.type}
                                    onValueChange={(value) => updateFormField(index, 'type', value)}
                                  >
                                    <SelectTrigger size="sm">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="text">{t('workflows.form.fieldTypes.text')}</SelectItem>
                                      <SelectItem value="number">{t('workflows.form.fieldTypes.number')}</SelectItem>
                                      <SelectItem value="email">{t('workflows.form.fieldTypes.email')}</SelectItem>
                                      <SelectItem value="tel">{t('workflows.form.fieldTypes.tel')}</SelectItem>
                                      <SelectItem value="url">{t('workflows.form.fieldTypes.url')}</SelectItem>
                                      <SelectItem value="textarea">{t('workflows.form.fieldTypes.textarea')}</SelectItem>
                                      <SelectItem value="select">{t('workflows.form.fieldTypes.select')}</SelectItem>
                                      <SelectItem value="radio">{t('workflows.form.fieldTypes.radio')}</SelectItem>
                                      <SelectItem value="checkbox">{t('workflows.form.fieldTypes.checkbox')}</SelectItem>
                                      <SelectItem value="date">{t('workflows.form.fieldTypes.date')}</SelectItem>
                                      <SelectItem value="time">{t('workflows.form.fieldTypes.time')}</SelectItem>
                                      <SelectItem value="datetime-local">{t('workflows.form.fieldTypes.datetime-local')}</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>

                                {/* Placeholder */}
                                <div>
                                  <label className="block text-xs font-medium text-foreground mb-1">{t('workflows.form.placeholder')}</label>
                                  <Input
                                    type="text"
                                    size="sm"
                                    value={field.placeholder || ''}
                                    onChange={(e) => updateFormField(index, 'placeholder', e.target.value)}
                                    placeholder={t('workflows.form.placeholders.placeholder')}
                                  />
                                </div>

                                {/* Default Value */}
                                <div>
                                  <label className="block text-xs font-medium text-foreground mb-1">{t('workflows.form.defaultValue')}</label>
                                  <Input
                                    type="text"
                                    size="sm"
                                    value={field.defaultValue || ''}
                                    onChange={(e) => updateFormField(index, 'defaultValue', e.target.value)}
                                    placeholder={t('workflows.form.placeholders.defaultValue')}
                                  />
                                </div>

                                {/* Options (for select/radio) */}
                                {(field.type === 'select' || field.type === 'radio') && (
                                  <div>
                                    <label className="block text-xs font-medium text-foreground mb-1">{t('workflows.form.options')}</label>
                                    <Input
                                      type="text"
                                      size="sm"
                                      value={field.options?.join(', ') || ''}
                                      onChange={(e) => updateFormField(index, 'options', e.target.value.split(',').map(o => o.trim()).filter(Boolean))}
                                      placeholder={t('workflows.form.placeholders.options')}
                                    />
                                    <p className="text-xs text-muted-foreground mt-0.5">{t('workflows.form.descriptions.options')}</p>
                                  </div>
                                )}

                                {/* Required Checkbox */}
                                <div>
                                  <label className="flex items-center gap-2 text-xs font-medium text-foreground">
                                    <Checkbox
                                      checked={field.required}
                                      onCheckedChange={(checked) => updateFormField(index, 'required', checked === true)}
                                    />
                                    {t('workflows.form.requiredField')}
                                  </label>
                                </div>

                                {/* Delete Button */}
                                <div className="border-t border-border pt-3">
                                  <Button
                                    type="button"
                                    variant="destructive"
                                    size="sm"
                                    onClick={() => removeFormField(index)}
                                  >
                                    <Trash2 className="size-4 mr-1" />
                                    {t('workflows.form.removeField')}
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
                  <div className="border-t border-border pt-4 mt-4">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <h3 className="text-sm font-semibold text-foreground">
                          {t('workflows.form.stepActivities', { count: stepActivities.length })}
                        </h3>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {t('workflows.form.descriptions.activities')}
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
                              activityName: `${t('workflows.activities.singular')} ${stepActivities.length + 1}`,
                              activityType: 'CALL_API',
                              config: {},
                              async: false,
                            },
                          ])
                        }}
                      >
                        <Plus className="size-3 mr-1" />
                        {t('workflows.form.addActivity')}
                      </Button>
                    </div>

                    {stepActivities.length === 0 && (
                      <div className="p-4 text-center text-sm text-muted-foreground bg-muted rounded-lg border border-border">
                        {t('workflows.nodeEditor.noActivities')}
                      </div>
                    )}

                    <div className="space-y-2">
                      {stepActivities.map((activity, index) => {
                        const isExpanded = expandedStepActivities.has(index)
                        return (
                          <div key={index} className="border border-border rounded-lg bg-muted">
                            {/* Activity Header (Collapsed) */}
                            <Button
                              type="button"
                              variant="ghost"
                              onClick={() => {
                                const newExpanded = new Set(expandedStepActivities)
                                if (isExpanded) {
                                  newExpanded.delete(index)
                                } else {
                                  newExpanded.add(index)
                                }
                                setExpandedStepActivities(newExpanded)
                              }}
                              className="h-auto w-full justify-between rounded-t-lg px-4 py-3 text-left hover:bg-muted/80"
                            >
                              <div className="flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="text-sm font-semibold text-foreground">
                                    {activity.activityName || activity.activityId || `Activity ${index + 1}`}
                                  </span>
                                  <Badge variant="secondary" className="text-xs">
                                    {activity.activityType}
                                  </Badge>
                                  {activity.async && (
                                    <Badge variant="outline" className="text-xs">
                                      {t('workflows.form.async')}
                                    </Badge>
                                  )}
                                </div>
                                <p className="text-xs text-muted-foreground mt-1">
                                  ID: <code className="bg-background px-1 rounded">{activity.activityId}</code>
                                </p>
                              </div>
                              <ChevronDown
                                className={`size-5 text-muted-foreground transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                              />
                            </Button>

                            {/* Activity Body (Expanded) */}
                            {isExpanded && (
                              <div className="px-4 pb-4 space-y-3 border-t border-border bg-background">
                                {/* Activity ID */}
                                <div className="pt-3">
                                  <label className="block text-xs font-medium text-foreground mb-1">
                                    {t('workflows.form.activityId')} *
                                  </label>
                                  <Input
                                    type="text"
                                    size="sm"
                                    value={activity.activityId}
                                    onChange={(e) => {
                                      const updated = [...stepActivities]
                                      updated[index].activityId = e.target.value
                                      setStepActivities(updated)
                                    }}
                                    placeholder={t('workflows.form.placeholders.activityId')}
                                  />
                                </div>

                                {/* Activity Name */}
                                <div>
                                  <label className="block text-xs font-medium text-foreground mb-1">
                                    {t('workflows.form.activityName')} *
                                  </label>
                                  <Input
                                    type="text"
                                    size="sm"
                                    value={activity.activityName || ''}
                                    onChange={(e) => {
                                      const updated = [...stepActivities]
                                      updated[index].activityName = e.target.value
                                      setStepActivities(updated)
                                    }}
                                    placeholder={t('workflows.form.placeholders.activityName')}
                                  />
                                </div>

                                {/* Activity Type */}
                                <div>
                                  <label className="block text-xs font-medium text-foreground mb-1">
                                    {t('workflows.form.activityType')} *
                                  </label>
                                  <Select
                                    value={activity.activityType}
                                    onValueChange={(value) => {
                                      const updated = [...stepActivities]
                                      updated[index].activityType = value
                                      setStepActivities(updated)
                                    }}
                                  >
                                    <SelectTrigger size="sm">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="SEND_EMAIL">{t('workflows.activities.types.SEND_EMAIL')}</SelectItem>
                                      <SelectItem value="CALL_API">{t('workflows.activities.types.CALL_API')}</SelectItem>
                                      <SelectItem value="UPDATE_ENTITY">{t('workflows.activities.types.UPDATE_ENTITY')}</SelectItem>
                                      <SelectItem value="EMIT_EVENT">{t('workflows.activities.types.EMIT_EVENT')}</SelectItem>
                                      <SelectItem value="CALL_WEBHOOK">{t('workflows.activities.types.CALL_WEBHOOK')}</SelectItem>
                                      <SelectItem value="EXECUTE_FUNCTION">{t('workflows.activities.types.EXECUTE_FUNCTION')}</SelectItem>
                                      <SelectItem value="WAIT">{t('workflows.activities.types.WAIT')}</SelectItem>
                                    </SelectContent>
                                  </Select>
                                </div>

                                {/* Timeout */}
                                <div>
                                  <label className="block text-xs font-medium text-foreground mb-1">
                                    {t('workflows.form.timeout')}
                                  </label>
                                  <Input
                                    type="text"
                                    size="sm"
                                    value={activity.timeoutMs || ''}
                                    onChange={(e) => {
                                      const updated = [...stepActivities]
                                      updated[index].timeoutMs = e.target.value ? parseInt(e.target.value) : undefined
                                      setStepActivities(updated)
                                    }}
                                    placeholder={t('workflows.form.placeholders.timeoutMs')}
                                  />
                                  <p className="text-xs text-muted-foreground mt-1">{t('workflows.form.descriptions.timeoutMs')}</p>
                                </div>

                                {/* Retry Policy Grid */}
                                <div className="border border-border rounded-lg p-3 bg-muted">
                                  <label className="block text-xs font-semibold text-foreground mb-2">
                                    {t('workflows.form.retryPolicy')}
                                  </label>
                                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                    <div>
                                      <label className="block text-xs text-muted-foreground mb-1">{t('workflows.form.maxAttempts')}</label>
                                      <Input
                                        type="number"
                                        size="sm"
                                        value={activity.retryPolicy?.maxAttempts || 1}
                                        onChange={(e) => {
                                          const updated = [...stepActivities]
                                          if (!updated[index].retryPolicy) updated[index].retryPolicy = {}
                                          updated[index].retryPolicy.maxAttempts = parseInt(e.target.value) || 1
                                          setStepActivities(updated)
                                        }}
                                        min="1"
                                        max="10"
                                      />
                                    </div>
                                    <div>
                                      <label className="block text-xs text-muted-foreground mb-1">{t('workflows.form.initialInterval')}</label>
                                      <Input
                                        type="number"
                                        size="sm"
                                        value={activity.retryPolicy?.initialIntervalMs || 1000}
                                        onChange={(e) => {
                                          const updated = [...stepActivities]
                                          if (!updated[index].retryPolicy) updated[index].retryPolicy = {}
                                          updated[index].retryPolicy.initialIntervalMs = parseInt(e.target.value) || 1000
                                          setStepActivities(updated)
                                        }}
                                      />
                                    </div>
                                    <div>
                                      <label className="block text-xs text-muted-foreground mb-1">{t('workflows.form.backoffCoefficient')}</label>
                                      <Input
                                        type="number"
                                        size="sm"
                                        step="0.1"
                                        value={activity.retryPolicy?.backoffCoefficient || 2}
                                        onChange={(e) => {
                                          const updated = [...stepActivities]
                                          if (!updated[index].retryPolicy) updated[index].retryPolicy = {}
                                          updated[index].retryPolicy.backoffCoefficient = parseFloat(e.target.value) || 2
                                          setStepActivities(updated)
                                        }}
                                      />
                                    </div>
                                    <div>
                                      <label className="block text-xs text-muted-foreground mb-1">{t('workflows.form.maxInterval')}</label>
                                      <Input
                                        type="number"
                                        size="sm"
                                        value={activity.retryPolicy?.maxIntervalMs || 60000}
                                        onChange={(e) => {
                                          const updated = [...stepActivities]
                                          if (!updated[index].retryPolicy) updated[index].retryPolicy = {}
                                          updated[index].retryPolicy.maxIntervalMs = parseInt(e.target.value) || 60000
                                          setStepActivities(updated)
                                        }}
                                      />
                                    </div>
                                  </div>
                                </div>

                                {/* Activity Flags */}
                                <div className="flex gap-4">
                                  <label className="flex items-center gap-2 cursor-pointer">
                                    <Checkbox
                                      checked={activity.async || false}
                                      onCheckedChange={(checked) => {
                                        const updated = [...stepActivities]
                                        updated[index].async = checked === true
                                        setStepActivities(updated)
                                      }}
                                    />
                                    <span className="text-xs text-foreground">{t('workflows.form.executeAsync')}</span>
                                  </label>
                                </div>

                                {/* WAIT Activity: Duration / Until fields */}
                                {activity.activityType === 'WAIT' && (
                                  <div className="space-y-3">
                                    <div>
                                      <label className="block text-xs font-medium text-foreground mb-1">
                                        {t('workflows.activities.waitDuration')}
                                      </label>
                                      <Input
                                        size="sm"
                                        type="text"
                                        value={activity.config?.duration || ''}
                                        onChange={(e) => {
                                          const updated = [...stepActivities]
                                          updated[index].config = { ...updated[index].config, duration: e.target.value, until: undefined }
                                          setStepActivities(updated)
                                        }}
                                        placeholder={t('workflows.activities.waitDurationPlaceholder')}
                                      />
                                      <p className="text-xs text-muted-foreground mt-1">{t('workflows.activities.waitDurationDescription')}</p>
                                    </div>
                                    <div className="text-xs text-center text-muted-foreground">{t('workflows.activities.waitOr')}</div>
                                    <div>
                                      <label className="block text-xs font-medium text-foreground mb-1">
                                        {t('workflows.activities.waitUntil')}
                                      </label>
                                      <Input
                                        size="sm"
                                        type="datetime-local"
                                        value={activity.config?.until ? activity.config.until.slice(0, 16) : ''}
                                        onChange={(e) => {
                                          const updated = [...stepActivities]
                                          updated[index].config = { ...updated[index].config, until: e.target.value ? new Date(e.target.value).toISOString() : undefined, duration: undefined }
                                          setStepActivities(updated)
                                        }}
                                      />
                                      <p className="text-xs text-muted-foreground mt-1">{t('workflows.activities.waitUntilDescription')}</p>
                                    </div>
                                  </div>
                                )}

                                {/* Activity Config JSON (hidden for WAIT) */}
                                {activity.activityType !== 'WAIT' && (
                                <div>
                                  <label className="block text-xs font-medium text-foreground mb-1">
                                    {t('workflows.form.configuration')}
                                  </label>
                                  <JsonBuilder
                                    value={activity.config || {}}
                                    onChange={(config) => {
                                      const updated = [...stepActivities]
                                      updated[index].config = config
                                      setStepActivities(updated)
                                    }}
                                  />
                                  <p className="text-xs text-muted-foreground mt-1">
                                    {t('workflows.form.descriptions.activityConfig')}
                                  </p>
                                </div>
                                )}

                                {/* Delete Button */}
                                <div className="pt-3 border-t border-border">
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
                                    {t('workflows.form.deleteActivity')}
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
                  <div className="border-t border-border pt-4 mt-4">
                    <h3 className="text-sm font-semibold text-foreground mb-3">
                      {t('workflows.form.subWorkflowConfig')}
                    </h3>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1">
                      {t('workflows.form.workflowToInvoke')} *
                    </label>
                    <div className="flex gap-2">
                      <Input
                        type="text"
                        value={subWorkflowId}
                        onChange={(e) => setSubWorkflowId(e.target.value)}
                        placeholder={t('workflows.form.placeholders.subWorkflowId')}
                        className="flex-1"
                        readOnly
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setShowWorkflowSelector(true)}
                      >
                        {t('workflows.form.browse')}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      {t('workflows.form.descriptions.subWorkflowId')}
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1">
                      {t('workflows.form.version')}
                    </label>
                    <Input
                      type="number"
                      value={subWorkflowVersion}
                      onChange={(e) => setSubWorkflowVersion(e.target.value)}
                      placeholder={t('workflows.form.placeholders.version')}
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      {t('workflows.form.descriptions.subWorkflowVersion')}
                    </p>
                  </div>

                  {/* Input Mapping */}
                  <div className="border-t border-border pt-4 mt-4">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <h4 className="text-sm font-semibold text-foreground">
                          {t('workflows.form.inputMapping', { count: inputMappings.length })}
                        </h4>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {t('workflows.form.descriptions.inputMapping')}
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => setInputMappings(prev => [...prev, { key: '', value: '' }])}
                      >
                        <Plus className="size-3 mr-1" />
                        {t('workflows.form.addMapping')}
                      </Button>
                    </div>

                    {inputMappings.length === 0 ? (
                      <p className="text-sm text-muted-foreground italic">
                        {t('workflows.nodeEditor.noInputMappings')}
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {inputMappings.map((mapping, index) => (
                          <div key={index} className="flex gap-2 items-start">
                            <div className="flex-1">
                              <Input
                                type="text"
                                value={mapping.key}
                                onChange={(e) => {
                                  const newMappings = [...inputMappings]
                                  newMappings[index].key = e.target.value
                                  setInputMappings(newMappings)
                                }}
                                placeholder={t('workflows.form.placeholders.childKey')}
                              />
                              <p className="text-xs text-muted-foreground mt-0.5">{t('workflows.form.descriptions.childKey')}</p>
                            </div>
                            <span className="text-muted-foreground mt-2">→</span>
                            <div className="flex-1">
                              <Input
                                type="text"
                                value={mapping.value}
                                onChange={(e) => {
                                  const newMappings = [...inputMappings]
                                  newMappings[index].value = e.target.value
                                  setInputMappings(newMappings)
                                }}
                                placeholder={t('workflows.form.placeholders.parentPath')}
                              />
                              <p className="text-xs text-muted-foreground mt-0.5">{t('workflows.form.descriptions.parentPath')}</p>
                            </div>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setInputMappings(prev => prev.filter((_, i) => i !== index))
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
                  <div className="border-t border-border pt-4 mt-4">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <h4 className="text-sm font-semibold text-foreground">
                          {t('workflows.form.outputMapping', { count: outputMappings.length })}
                        </h4>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {t('workflows.form.descriptions.outputMapping')}
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => setOutputMappings(prev => [...prev, { key: '', value: '' }])}
                      >
                        <Plus className="size-3 mr-1" />
                        {t('workflows.form.addMapping')}
                      </Button>
                    </div>

                    {outputMappings.length === 0 ? (
                      <p className="text-sm text-muted-foreground italic">
                        {t('workflows.nodeEditor.noOutputMappings')}
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {outputMappings.map((mapping, index) => (
                          <div key={index} className="flex gap-2 items-start">
                            <div className="flex-1">
                              <Input
                                type="text"
                                value={mapping.key}
                                onChange={(e) => {
                                  const newMappings = [...outputMappings]
                                  newMappings[index].key = e.target.value
                                  setOutputMappings(newMappings)
                                }}
                                placeholder={t('workflows.form.placeholders.parentKey')}
                              />
                              <p className="text-xs text-muted-foreground mt-0.5">{t('workflows.form.descriptions.parentKey')}</p>
                            </div>
                            <span className="text-muted-foreground mt-2">←</span>
                            <div className="flex-1">
                              <Input
                                type="text"
                                value={mapping.value}
                                onChange={(e) => {
                                  const newMappings = [...outputMappings]
                                  newMappings[index].value = e.target.value
                                  setOutputMappings(newMappings)
                                }}
                                placeholder={t('workflows.form.placeholders.childPath')}
                              />
                              <p className="text-xs text-muted-foreground mt-0.5">{t('workflows.form.descriptions.childPath')}</p>
                            </div>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setOutputMappings(prev => prev.filter((_, i) => i !== index))
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
                  <div className="border-t border-border pt-4 mt-4">
                    <h3 className="text-sm font-semibold text-foreground mb-3">
                      {t('workflows.form.signalConfig')}
                    </h3>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1">
                      {t('workflows.form.signalName')} *
                    </label>
                    <Input
                      type="text"
                      value={signalName}
                      onChange={(e) => setSignalName(e.target.value)}
                      placeholder={t('workflows.form.placeholders.signalName')}
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      {t('workflows.form.descriptions.signalName')}
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1">
                      {t('workflows.form.timeout')}
                    </label>
                    <Input
                      type="text"
                      value={signalTimeout}
                      onChange={(e) => {
                        setSignalTimeout(e.target.value)
                        if (fieldErrors.signalTimeout) {
                          const next = { ...fieldErrors }
                          delete next.signalTimeout
                          setFieldErrors(next)
                        }
                      }}
                      placeholder={t('workflows.form.placeholders.signalTimeout')}
                      aria-invalid={fieldErrors.signalTimeout ? true : undefined}
                    />
                    {fieldErrors.signalTimeout ? (
                      <p className="text-xs text-destructive mt-1">
                        {fieldErrors.signalTimeout}
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground mt-1">
                        {t('workflows.form.descriptions.signalTimeout')}
                      </p>
                    )}
                  </div>
                </>
              )}

              {/* Wait for Timer Configuration */}
              {node.type === 'waitForTimer' && (
                <>
                  <div className="border-t border-border pt-4 mt-4">
                    <h3 className="text-sm font-semibold text-foreground mb-3">
                      {t('workflows.steps.types.WAIT_FOR_TIMER')}
                    </h3>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1">
                      {t('workflows.activities.waitDuration')}
                    </label>
                    <Input
                      type="text"
                      value={timerDuration}
                      onChange={(e) => {
                        setTimerDuration(e.target.value)
                        if (e.target.value) setTimerUntil('')
                        if (fieldErrors.timerDuration) {
                          const next = { ...fieldErrors }
                          delete next.timerDuration
                          setFieldErrors(next)
                        }
                      }}
                      placeholder={t('workflows.activities.waitDurationPlaceholder')}
                      aria-invalid={fieldErrors.timerDuration ? true : undefined}
                    />
                    {fieldErrors.timerDuration ? (
                      <p className="text-xs text-destructive mt-1">
                        {fieldErrors.timerDuration}
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground mt-1">
                        {t('workflows.activities.waitDurationDescription')}
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1">
                      {t('workflows.activities.waitUntil')}
                    </label>
                    <Input
                      type="datetime-local"
                      value={timerUntil ? timerUntil.slice(0, 16) : ''}
                      min={new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16)}
                      onChange={(e) => {
                        const next = e.target.value ? new Date(e.target.value).toISOString() : ''
                        setTimerUntil(next)
                        if (next) setTimerDuration('')
                        if (fieldErrors.timerUntil) {
                          const nextErrors = { ...fieldErrors }
                          delete nextErrors.timerUntil
                          setFieldErrors(nextErrors)
                        }
                      }}
                      aria-invalid={fieldErrors.timerUntil ? true : undefined}
                    />
                    {fieldErrors.timerUntil ? (
                      <p className="text-xs text-destructive mt-1">
                        {fieldErrors.timerUntil}
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground mt-1">
                        {t('workflows.activities.waitUntilDescription')}
                      </p>
                    )}
                  </div>
                </>
              )}

              {/* Advanced Configuration */}
              <div className="border-t border-border pt-4 mt-4">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="h-auto w-full justify-between px-0 py-0 text-left hover:bg-transparent"
                >
                  <h3 className="text-sm font-semibold text-foreground">
                    {t('workflows.form.advancedConfiguration')}
                  </h3>
                  <ChevronDown
                    className={`size-5 transition-transform ${showAdvanced ? 'rotate-180' : ''}`}
                  />
                </Button>
                {showAdvanced && (
                  <div className="mt-3">
                    <JsonBuilder
                      value={advancedConfig}
                      onChange={setAdvancedConfig}
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      {t('workflows.form.descriptions.advancedConfig')}
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
              {t('workflows.form.deleteStep')}
            </Button>
          )}
          <div className="flex gap-2 ml-auto">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
            >
              {t('workflows.actions.cancel')}
            </Button>
            {isEditable && (
              <Button
                type="button"
                onClick={handleSave}
              >
                {t('workflows.actions.saveChanges')}
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
          title={t('workflows.dialogs.selectSubWorkflow')}
          description={t('workflows.dialogs.selectSubWorkflowDescription')}
          onlyEnabled={true}
        />
      )}
      {ConfirmDialogElement}
    </Dialog>
  )
}
