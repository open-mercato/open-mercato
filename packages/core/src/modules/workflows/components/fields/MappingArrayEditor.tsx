'use client'

import { useState } from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { ChevronDown, Plus, Trash2 } from 'lucide-react'
import type { CrudCustomFieldRenderProps } from '@open-mercato/ui/backend/CrudForm'

/**
 * Mapping definition structure for SubWorkflow input/output
 */
export interface Mapping {
  key: string
  value: string
}

interface MappingArrayEditorProps extends CrudCustomFieldRenderProps {
  value: Mapping[]
  label?: string
  description?: string
}

/**
 * MappingArrayEditor - Custom field component for managing SubWorkflow input/output mappings
 *
 * Provides an interface to add, edit, and remove key-value pair mappings.
 * Values support template expressions like {{context.foo}} for dynamic data binding.
 *
 * Used by NodeEditDialog (SubWorkflow type only)
 */
export function MappingArrayEditor({
  id,
  value = [],
  error,
  setValue,
  disabled,
  label: labelProp,
  description: descriptionProp,
}: MappingArrayEditorProps) {
  const t = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const label = labelProp ?? t('workflows.fieldEditors.mappings.label')
  const description = descriptionProp ?? t('workflows.fieldEditors.mappings.description')
  const [expandedIndices, setExpandedIndices] = useState<Set<number>>(new Set())

  const mappings = Array.isArray(value) ? value : []

  const toggleExpanded = (index: number) => {
    const newExpanded = new Set(expandedIndices)
    if (newExpanded.has(index)) {
      newExpanded.delete(index)
    } else {
      newExpanded.add(index)
    }
    setExpandedIndices(newExpanded)
  }

  const addMapping = () => {
    const newMapping: Mapping = {
      key: `key_${Date.now()}`,
      value: '',
    }
    const newMappings = [...mappings, newMapping]
    setValue(newMappings)

    // Auto-expand the newly added mapping
    const newExpanded = new Set(expandedIndices)
    newExpanded.add(mappings.length)
    setExpandedIndices(newExpanded)
  }

  const removeMapping = async (index: number) => {
    const confirmed = await confirm({
      title: t('workflows.fieldEditors.mappings.removeMapping'),
      text: t('workflows.fieldEditors.mappings.confirmRemove'),
      variant: 'destructive',
    })
    if (!confirmed) return

    const newMappings = mappings.filter((_, i) => i !== index)
    setValue(newMappings)

    // Remove from expanded set
    const newExpanded = new Set(expandedIndices)
    newExpanded.delete(index)
    setExpandedIndices(newExpanded)
  }

  const updateMapping = (index: number, field: keyof Mapping, fieldValue: string) => {
    const updated = [...mappings]
    updated[index] = { ...updated[index], [field]: fieldValue }
    setValue(updated)
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Label className="text-sm font-semibold">{label} ({mappings.length})</Label>
          <p className="text-xs text-muted-foreground mt-0.5">
            {description}
          </p>
          {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
        </div>
        <Button
          type="button"
          size="sm"
          onClick={addMapping}
          disabled={disabled}
          className="w-full sm:w-auto"
        >
          <Plus className="size-3 mr-1" />
          {t('workflows.fieldEditors.mappings.addMapping')}
        </Button>
      </div>

      {mappings.length === 0 ? (
        <div className="p-4 text-center text-sm text-muted-foreground bg-muted rounded-lg border">
          {t('workflows.fieldEditors.mappings.emptyState')}
        </div>
      ) : (
        <div className="space-y-2">
          {mappings.map((mapping, index) => {
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
                        {mapping.key || `Mapping ${index + 1}`}
                      </span>
                    </div>
                    <p className="text-xs text-gray-600 mt-1 font-mono truncate">
                      {mapping.value ? (
                        <>
                          <span className="text-gray-400">=</span> {mapping.value}
                        </>
                      ) : (
                        <span className="text-gray-400 italic">{t('workflows.common.noValueSet')}</span>
                      )}
                    </p>
                  </div>
                  <ChevronDown
                    className={`w-5 h-5 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                  />
                </button>

                {/* Expanded Content */}
                {isExpanded && (
                  <div className="px-4 pb-4 space-y-3 border-t border-gray-200 bg-white">
                    {/* Key Field */}
                    <div className="pt-3">
                      <Label htmlFor={`${id}-${index}-key`} className="text-xs font-medium mb-1">
                        {t('workflows.fieldEditors.mappings.key')} *
                      </Label>
                      <Input
                        id={`${id}-${index}-key`}
                        type="text"
                        value={mapping.key}
                        onChange={(e) => updateMapping(index, 'key', e.target.value)}
                        placeholder={t('workflows.fieldEditors.mappings.keyPlaceholder')}
                        className="text-xs"
                        disabled={disabled}
                      />
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {t('workflows.fieldEditors.mappings.keyHint')}
                      </p>
                    </div>

                    {/* Value Field */}
                    <div>
                      <Label htmlFor={`${id}-${index}-value`} className="text-xs font-medium mb-1">
                        {t('workflows.fieldEditors.mappings.value')} *
                      </Label>
                      <Input
                        id={`${id}-${index}-value`}
                        type="text"
                        value={mapping.value}
                        onChange={(e) => updateMapping(index, 'value', e.target.value)}
                        placeholder={t('workflows.fieldEditors.mappings.valuePlaceholder')}
                        className="text-xs font-mono"
                        disabled={disabled}
                      />
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {t('workflows.fieldEditors.mappings.valueHint')}
                      </p>
                    </div>

                    {/* Delete Button */}
                    <div className="border-t border-gray-200 pt-3">
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        onClick={() => removeMapping(index)}
                        disabled={disabled}
                      >
                        <Trash2 className="size-4 mr-1" />
                        {t('workflows.fieldEditors.mappings.removeMapping')}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
      {ConfirmDialogElement}
    </div>
  )
}
