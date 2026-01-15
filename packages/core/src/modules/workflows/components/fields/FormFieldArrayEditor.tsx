'use client'

import { useState } from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { ChevronDown, Plus, Trash2, Info } from 'lucide-react'
import type { CrudCustomFieldRenderProps } from '@open-mercato/ui/backend/CrudForm'

/**
 * Form field definition structure
 */
export interface FormField {
  name: string
  type: string
  label: string
  required: boolean
  placeholder?: string
  options?: string[]
  defaultValue?: string
}

interface FormFieldArrayEditorProps extends CrudCustomFieldRenderProps {
  value: FormField[]
  isJsonSchemaFormat?: boolean
}

/**
 * FormFieldArrayEditor - Custom field component for managing UserTask form fields
 *
 * Provides an interface to add, edit, and remove form field definitions for user tasks.
 * Supports 12 field types with conditional options for select/radio types.
 *
 * Displays a warning banner if the form was converted from JSON Schema format.
 *
 * Used by NodeEditDialog (UserTask type only)
 */
export function FormFieldArrayEditor({
  id,
  value = [],
  error,
  setValue,
  disabled,
  isJsonSchemaFormat = false,
}: FormFieldArrayEditorProps) {
  const [expandedIndices, setExpandedIndices] = useState<Set<number>>(new Set())

  const formFields = Array.isArray(value) ? value : []

  const toggleExpanded = (index: number) => {
    const newExpanded = new Set(expandedIndices)
    if (newExpanded.has(index)) {
      newExpanded.delete(index)
    } else {
      newExpanded.add(index)
    }
    setExpandedIndices(newExpanded)
  }

  const addFormField = () => {
    const newField: FormField = {
      name: `field_${Date.now()}`,
      type: 'text',
      label: 'New Field',
      required: false,
      placeholder: '',
    }
    const newFields = [...formFields, newField]
    setValue(newFields)

    // Auto-expand the newly added field
    const newExpanded = new Set(expandedIndices)
    newExpanded.add(formFields.length)
    setExpandedIndices(newExpanded)
  }

  const removeFormField = (index: number) => {
    if (typeof window !== 'undefined' && !window.confirm('Are you sure you want to remove this field?')) {
      return
    }
    const newFields = formFields.filter((_, i) => i !== index)
    setValue(newFields)

    // Remove from expanded set
    const newExpanded = new Set(expandedIndices)
    newExpanded.delete(index)
    setExpandedIndices(newExpanded)
  }

  const updateFormField = (index: number, fieldKey: keyof FormField, fieldValue: any) => {
    const updated = [...formFields]
    updated[index] = { ...updated[index], [fieldKey]: fieldValue }
    setValue(updated)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-sm font-semibold">Form Fields ({formFields.length})</Label>
          <p className="text-xs text-muted-foreground mt-0.5">
            Define the form structure for this user task
          </p>
          {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
        </div>
        <Button
          type="button"
          size="sm"
          onClick={addFormField}
          disabled={disabled}
        >
          <Plus className="size-3 mr-1" />
          Add Field
        </Button>
      </div>

      {/* JSON Schema Format Notice */}
      {isJsonSchemaFormat && (
        <Alert variant="default" className="border-blue-200 bg-blue-50">
          <Info className="size-4" />
          <AlertDescription className="text-xs">
            This form uses JSON Schema format. Fields have been converted for visual editing.
            When you save, it will be converted to the simplified format. To preserve the original JSON Schema,
            edit it in the "Advanced Configuration (JSON)" section below.
          </AlertDescription>
        </Alert>
      )}

      {formFields.length === 0 ? (
        <div className="p-4 text-center text-sm text-muted-foreground bg-muted rounded-lg border">
          No form fields defined. Click "Add Field" to create one.
        </div>
      ) : (
        <div className="space-y-2">
          {formFields.map((field, index) => {
            const isExpanded = expandedIndices.has(index)
            return (
              <div key={index} className="border border-gray-200 rounded-lg bg-gray-50">
                {/* Collapsed Header */}
                <button
                  type="button"
                  onClick={() => toggleExpanded(index)}
                  disabled={disabled}
                  className="w-full px-4 py-3 text-left flex items-center justify-between hover:bg-gray-100 transition-colors rounded-t-lg disabled:opacity-50"
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

                {/* Expanded Content */}
                {isExpanded && (
                  <div className="px-4 pb-4 space-y-3 border-t border-gray-200 bg-white">
                    {/* Field Name */}
                    <div className="pt-3">
                      <Label htmlFor={`${id}-${index}-name`} className="text-xs font-medium mb-1">
                        Field Name *
                      </Label>
                      <Input
                        id={`${id}-${index}-name`}
                        type="text"
                        value={field.name}
                        onChange={(e) => updateFormField(index, 'name', e.target.value)}
                        placeholder="field_name"
                        className="text-xs"
                        disabled={disabled}
                      />
                      <p className="text-xs text-muted-foreground mt-0.5">Unique identifier for this field</p>
                    </div>

                    {/* Field Label */}
                    <div>
                      <Label htmlFor={`${id}-${index}-label`} className="text-xs font-medium mb-1">
                        Field Label *
                      </Label>
                      <Input
                        id={`${id}-${index}-label`}
                        type="text"
                        value={field.label}
                        onChange={(e) => updateFormField(index, 'label', e.target.value)}
                        placeholder="Field Label"
                        className="text-xs"
                        disabled={disabled}
                      />
                      <p className="text-xs text-muted-foreground mt-0.5">Display label shown to users</p>
                    </div>

                    {/* Field Type */}
                    <div>
                      <Label htmlFor={`${id}-${index}-type`} className="text-xs font-medium mb-1">
                        Field Type *
                      </Label>
                      <select
                        id={`${id}-${index}-type`}
                        value={field.type}
                        onChange={(e) => updateFormField(index, 'type', e.target.value)}
                        className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        disabled={disabled}
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
                      <Label htmlFor={`${id}-${index}-placeholder`} className="text-xs font-medium mb-1">
                        Placeholder
                      </Label>
                      <Input
                        id={`${id}-${index}-placeholder`}
                        type="text"
                        value={field.placeholder || ''}
                        onChange={(e) => updateFormField(index, 'placeholder', e.target.value)}
                        placeholder="Enter placeholder text..."
                        className="text-xs"
                        disabled={disabled}
                      />
                    </div>

                    {/* Default Value */}
                    <div>
                      <Label htmlFor={`${id}-${index}-defaultValue`} className="text-xs font-medium mb-1">
                        Default Value
                      </Label>
                      <Input
                        id={`${id}-${index}-defaultValue`}
                        type="text"
                        value={field.defaultValue || ''}
                        onChange={(e) => updateFormField(index, 'defaultValue', e.target.value)}
                        placeholder="Default value..."
                        className="text-xs"
                        disabled={disabled}
                      />
                    </div>

                    {/* Options (for select/radio) */}
                    {(field.type === 'select' || field.type === 'radio') && (
                      <div>
                        <Label htmlFor={`${id}-${index}-options`} className="text-xs font-medium mb-1">
                          Options (comma-separated)
                        </Label>
                        <Input
                          id={`${id}-${index}-options`}
                          type="text"
                          value={field.options?.join(', ') || ''}
                          onChange={(e) =>
                            updateFormField(
                              index,
                              'options',
                              e.target.value
                                .split(',')
                                .map((o) => o.trim())
                                .filter(Boolean)
                            )
                          }
                          placeholder="Option 1, Option 2, Option 3"
                          className="text-xs"
                          disabled={disabled}
                        />
                        <p className="text-xs text-muted-foreground mt-0.5">Comma-separated list of options</p>
                      </div>
                    )}

                    {/* Required Checkbox */}
                    <div>
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          id={`${id}-${index}-required`}
                          checked={field.required}
                          onChange={(e) => updateFormField(index, 'required', e.target.checked)}
                          className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          disabled={disabled}
                        />
                        <Label htmlFor={`${id}-${index}-required`} className="text-xs font-medium cursor-pointer">
                          Required field
                        </Label>
                      </div>
                    </div>

                    {/* Delete Button */}
                    <div className="border-t border-gray-200 pt-3">
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        onClick={() => removeFormField(index)}
                        disabled={disabled}
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
      )}
    </div>
  )
}
