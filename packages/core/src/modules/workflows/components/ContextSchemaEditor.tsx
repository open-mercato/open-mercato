"use client"

import * as React from 'react'
import { useCallback, useState } from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { TagsInput } from '@open-mercato/ui/backend/inputs/TagsInput'
import { Braces, ChevronDown, Plus, X } from 'lucide-react'
import type { WorkflowContextSchema, WorkflowContextSchemaField } from '../data/entities'

const CONTEXT_FIELD_TYPES = ['text', 'number', 'boolean', 'select', 'date'] as const

interface ContextSchemaEditorProps {
  value: WorkflowContextSchema | undefined
  onChange: (next: WorkflowContextSchema | undefined) => void
  className?: string
}

export function ContextSchemaEditor({ value, onChange, className }: ContextSchemaEditorProps) {
  const t = useT()
  const [collapsed, setCollapsed] = useState(false)

  const fields = value?.input?.fields ?? []

  const emitFields = useCallback((nextFields: WorkflowContextSchemaField[]) => {
    onChange(nextFields.length > 0 ? { input: { fields: nextFields } } : undefined)
  }, [onChange])

  const addField = useCallback(() => {
    emitFields([...fields, { name: '', type: 'text' }])
  }, [emitFields, fields])

  const removeField = useCallback((index: number) => {
    emitFields(fields.filter((_, fieldIndex) => fieldIndex !== index))
  }, [emitFields, fields])

  const updateField = useCallback((index: number, patch: Partial<WorkflowContextSchemaField>) => {
    emitFields(fields.map((field, fieldIndex) => {
      if (fieldIndex !== index) return field
      const next = { ...field, ...patch }
      if (next.type !== 'select') delete next.options
      return next
    }))
  }, [emitFields, fields])

  return (
    <div className={className}>
      <div className="rounded-lg border bg-card p-3 md:p-4">
        <div className="mb-1 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <button
            type="button"
            onClick={() => setCollapsed((previous) => !previous)}
            aria-expanded={!collapsed}
            className="flex items-center gap-2 text-left focus-visible:outline-none focus-visible:shadow-focus"
          >
            <Braces className="w-5 h-5 text-muted-foreground" />
            <h3 className="text-sm font-semibold uppercase text-muted-foreground">
              {t('workflows.contextSchema.title')} ({fields.length})
            </h3>
            <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${collapsed ? '-rotate-90' : ''}`} />
          </button>
          <Button size="sm" variant="outline" onClick={addField} className="w-full sm:w-auto">
            <Plus className="w-4 h-4 mr-1" />
            {t('workflows.contextSchema.addField')}
          </Button>
        </div>

        {!collapsed && (
          <>
            <p className="text-xs text-muted-foreground mb-4">
              {t('workflows.contextSchema.description')}
            </p>

            {fields.length === 0 ? (
              <div className="p-4 text-center text-sm text-muted-foreground bg-muted rounded-lg border">
                {t('workflows.contextSchema.emptyState')}
              </div>
            ) : (
              <div className="space-y-2">
                {fields.map((field, index) => (
                  <div key={index} className="rounded-lg border bg-background p-2 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Input
                        value={field.name}
                        onChange={(event) => updateField(index, { name: event.target.value })}
                        placeholder={t('workflows.contextSchema.placeholders.name')}
                        aria-label={t('workflows.contextSchema.fields.name')}
                        className="w-full sm:w-1/4"
                      />
                      <Select
                        value={field.type}
                        onValueChange={(type) => updateField(index, { type: type as WorkflowContextSchemaField['type'] })}
                      >
                        <SelectTrigger
                          size="lg"
                          className="w-full sm:w-[130px]"
                          aria-label={t('workflows.contextSchema.fields.type')}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CONTEXT_FIELD_TYPES.map((type) => (
                            <SelectItem key={type} value={type}>
                              {t(`workflows.contextSchema.types.${type}`)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Input
                        value={field.label ?? ''}
                        onChange={(event) => updateField(index, { label: event.target.value })}
                        placeholder={t('workflows.contextSchema.placeholders.label')}
                        aria-label={t('workflows.contextSchema.fields.label')}
                        className="flex-1 min-w-[120px]"
                      />
                      <label className="flex shrink-0 cursor-pointer items-center gap-2">
                        <Checkbox
                          checked={field.required === true}
                          onCheckedChange={(checked) => updateField(index, { required: checked === true })}
                          aria-label={t('workflows.contextSchema.fields.required')}
                        />
                        <span className="text-xs text-muted-foreground">
                          {t('workflows.contextSchema.fields.required')}
                        </span>
                      </label>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="shrink-0"
                        onClick={() => removeField(index)}
                        aria-label={t('workflows.contextSchema.removeField')}
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                    {field.type === 'select' && (
                      <div className="space-y-1">
                        <Label className="text-xs">{t('workflows.contextSchema.fields.options')}</Label>
                        <TagsInput
                          value={field.options ?? []}
                          onChange={(options) => updateField(index, { options })}
                          placeholder={t('workflows.contextSchema.placeholders.options')}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
