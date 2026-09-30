'use client'

import * as React from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Input } from '@open-mercato/ui/primitives/input'
import { Button } from '@open-mercato/ui/primitives/button'
import { Switch } from '@open-mercato/ui/primitives/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { useT } from '@open-mercato/shared/lib/i18n/context'

/**
 * W6 — repeatable group sub-field editor. Lets authors define the sub-fields
 * that repeat per entry (key, label, type, required) and the min/max number of
 * entries. Sub-fields persist under `items.properties`; min/max persist as
 * `x-om-min-items` / `x-om-max-items`. The server (AJV) is authoritative; these
 * are authoring affordances.
 *
 * Nested groups are out of scope — `group` is excluded from the type options.
 */

export type GroupSubFieldRow = {
  key: string
  label: string
  type: string
  required: boolean
}

export type GroupConfigEditorProps = {
  subFields: GroupSubFieldRow[]
  minItems: number | undefined
  maxItems: number | undefined
  /** Selectable sub-field types (excludes `group` — no nesting). */
  typeOptions: Array<{ value: string; label: string }>
  onAddSubField: () => void
  onRemoveSubField: (key: string) => void
  onUpdateSubField: (
    key: string,
    patch: { label?: string; type?: string; required?: boolean },
  ) => void
  onMinItemsChange: (next: number | null) => void
  onMaxItemsChange: (next: number | null) => void
}

function parsePositiveInt(value: string): number | null {
  const trimmed = value.trim()
  if (trimmed.length === 0) return null
  const parsed = Number.parseInt(trimmed, 10)
  if (!Number.isInteger(parsed) || parsed < 0) return null
  return parsed
}

export function GroupConfigEditor({
  subFields,
  minItems,
  maxItems,
  typeOptions,
  onAddSubField,
  onRemoveSubField,
  onUpdateSubField,
  onMinItemsChange,
  onMaxItemsChange,
}: GroupConfigEditorProps) {
  const t = useT()
  return (
    <div className="space-y-3">
      <span className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {t('forms.studio.field.group.heading')}
      </span>
      {subFields.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('forms.studio.field.group.empty')}</p>
      ) : (
        <ul className="space-y-2">
          {subFields.map((subField) => (
            <li
              key={subField.key}
              className="space-y-2 rounded-md border border-border bg-muted/30 p-2"
            >
              <div className="flex items-center gap-2">
                <Input
                  type="text"
                  aria-label={t('forms.studio.field.group.subFieldLabel')}
                  placeholder={t('forms.studio.field.group.subFieldLabel')}
                  value={subField.label}
                  onChange={(event) => onUpdateSubField(subField.key, { label: event.target.value })}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onRemoveSubField(subField.key)}
                  aria-label={t('forms.studio.field.group.deleteSubField')}
                >
                  <Trash2 aria-hidden="true" className="size-4" />
                </Button>
              </div>
              <div className="flex items-center gap-2">
                <Select
                  value={subField.type}
                  onValueChange={(next) => onUpdateSubField(subField.key, { type: next })}
                >
                  <SelectTrigger aria-label={t('forms.studio.field.group.subFieldType')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {typeOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <label className="flex items-center gap-2 whitespace-nowrap text-sm">
                  <Switch
                    checked={subField.required}
                    onCheckedChange={(next) => onUpdateSubField(subField.key, { required: Boolean(next) })}
                  />
                  {t('forms.studio.field.group.subFieldRequired')}
                </label>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Button type="button" variant="outline" size="sm" onClick={onAddSubField}>
        <Plus aria-hidden="true" className="size-4" />
        {t('forms.studio.field.group.addSubField')}
      </Button>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label className="block text-xs font-medium text-muted-foreground">
            {t('forms.studio.field.group.minItems')}
          </label>
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            value={typeof minItems === 'number' ? String(minItems) : ''}
            onChange={(event) => onMinItemsChange(parsePositiveInt(event.target.value))}
          />
        </div>
        <div className="space-y-1">
          <label className="block text-xs font-medium text-muted-foreground">
            {t('forms.studio.field.group.maxItems')}
          </label>
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            value={typeof maxItems === 'number' ? String(maxItems) : ''}
            onChange={(event) => onMaxItemsChange(parsePositiveInt(event.target.value))}
          />
        </div>
      </div>
    </div>
  )
}
