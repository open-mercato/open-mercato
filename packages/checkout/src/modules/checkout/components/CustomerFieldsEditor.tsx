"use client"
import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { Trash2 } from 'lucide-react'
import type { CustomerFieldDefinitionInput } from '../data/validators'
import { DEFAULT_CHECKOUT_CUSTOMER_FIELDS } from '../setup'

type Props = {
  value: CustomerFieldDefinitionInput[]
  onChange: (next: CustomerFieldDefinitionInput[]) => void
}

function normalize(next: CustomerFieldDefinitionInput[]): CustomerFieldDefinitionInput[] {
  return next.map((field, index) => ({
    ...field,
    key: field.key.trim(),
    label: field.label.trim(),
    options: field.options?.filter((option) => option.value.trim() && option.label.trim()),
    sortOrder: index,
  }))
}

export function CustomerFieldsEditor({ value, onChange }: Props) {
  const fields = React.useMemo(
    () => (Array.isArray(value) && value.length ? value : [...DEFAULT_CHECKOUT_CUSTOMER_FIELDS]),
    [value],
  )

  const updateField = (index: number, patch: Partial<CustomerFieldDefinitionInput>) => {
    onChange(normalize(fields.map((field, currentIndex) => currentIndex === index ? { ...field, ...patch } : field)))
  }

  return (
    <div className="space-y-4">
      {fields.map((field, index) => (
        <div key={`${field.key}:${index}`} className="space-y-3 rounded-lg border p-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Field key</Label>
              <Input value={field.key} onChange={(event) => updateField(index, { key: event.target.value })} disabled={field.fixed} />
            </div>
            <div className="space-y-2">
              <Label>Label</Label>
              <Input value={field.label} onChange={(event) => updateField(index, { label: event.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Type</Label>
              <select
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={field.kind}
                onChange={(event) => updateField(index, { kind: event.target.value as CustomerFieldDefinitionInput['kind'] })}
                disabled={field.fixed}
              >
                <option value="text">Text</option>
                <option value="multiline">Multiline</option>
                <option value="boolean">Boolean</option>
                <option value="select">Select</option>
                <option value="radio">Radio</option>
              </select>
            </div>
            <div className="space-y-2">
              <Label>Placeholder</Label>
              <Input value={'placeholder' in field ? field.placeholder ?? '' : ''} onChange={(event) => updateField(index, { placeholder: event.target.value })} />
            </div>
          </div>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={field.required} onChange={(event) => updateField(index, { required: event.target.checked })} />
              Required
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={field.fixed} disabled={field.fixed} readOnly />
              Fixed
            </label>
          </div>
          {(field.kind === 'select' || field.kind === 'radio') ? (
            <div className="space-y-2">
              <Label>Options</Label>
              <Textarea
                value={(field.options ?? []).map((option) => `${option.value}:${option.label}`).join('\n')}
                onChange={(event) => {
                  const options = event.target.value
                    .split('\n')
                    .map((line) => line.trim())
                    .filter(Boolean)
                    .map((line) => {
                      const [valuePart, ...labelParts] = line.split(':')
                      return {
                        value: valuePart?.trim() ?? '',
                        label: labelParts.join(':').trim() || valuePart?.trim() || '',
                      }
                    })
                  updateField(index, { options })
                }}
                placeholder="value:Label"
              />
            </div>
          ) : null}
          {!field.fixed ? (
            <div className="flex justify-end">
              <Button type="button" variant="outline" size="sm" onClick={() => onChange(normalize(fields.filter((_, currentIndex) => currentIndex !== index)))}>
                <Trash2 className="mr-2 h-4 w-4" />
                Remove
              </Button>
            </div>
          ) : null}
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        onClick={() => onChange(normalize([
          ...fields,
          {
            key: `customField${fields.length + 1}`,
            label: 'New field',
            kind: 'text',
            required: false,
            fixed: false,
            sortOrder: fields.length,
            options: [],
          },
        ]))}
      >
        Add customer field
      </Button>
    </div>
  )
}

export default CustomerFieldsEditor
