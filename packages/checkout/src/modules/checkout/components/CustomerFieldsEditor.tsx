"use client"

import * as React from 'react'
import { Plus, Settings2, Trash2 } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Notice } from '@open-mercato/ui/primitives/Notice'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
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
    placeholder: typeof field.placeholder === 'string' ? field.placeholder.trim() : undefined,
    options: field.options?.filter((option) => option.value.trim() && option.label.trim()),
    sortOrder: index,
  }))
}

function createField(index: number): CustomerFieldDefinitionInput {
  return {
    key: `customField${index + 1}`,
    label: 'New field',
    kind: 'text',
    required: false,
    fixed: false,
    placeholder: 'Shown on the checkout form',
    sortOrder: index,
    options: [],
  }
}

export function CustomerFieldsEditor({ value, onChange }: Props) {
  const fields = React.useMemo(
    () => (Array.isArray(value) ? value : [...DEFAULT_CHECKOUT_CUSTOMER_FIELDS]),
    [value],
  )

  const updateField = React.useCallback(
    (index: number, patch: Partial<CustomerFieldDefinitionInput>) => {
      onChange(
        normalize(
          fields.map((field, currentIndex) => (currentIndex === index ? { ...field, ...patch } : field)),
        ),
      )
    },
    [fields, onChange],
  )

  const removeField = React.useCallback(
    (index: number) => {
      onChange(normalize(fields.filter((_, currentIndex) => currentIndex !== index)))
    },
    [fields, onChange],
  )

  return (
    <div className="space-y-4">
      <Notice compact>
        Default customer fields are only starting suggestions. You can rename, reorder, or remove them to keep the form compact.
      </Notice>

      <div className="overflow-hidden rounded-xl border border-border/70 bg-background">
        <div className="hidden grid-cols-[1fr_1fr_1fr_180px_90px_110px] gap-3 border-b bg-muted/30 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground md:grid">
          <div>Field key</div>
          <div>Label</div>
          <div>Placeholder</div>
          <div>Type</div>
          <div>Required</div>
          <div className="text-right">Actions</div>
        </div>

        {fields.length > 0 ? (
          <div className="divide-y divide-border/70">
            {fields.map((field, index) => (
              <div key={`${field.key}:${index}`} className="space-y-3 px-4 py-4">
                <div className="grid gap-3 md:grid-cols-[1fr_1fr_1fr_180px_90px_110px] md:items-center">
                  <div className="space-y-1">
                    <Label className="md:sr-only">Field key</Label>
                    <Input
                      value={field.key}
                      onChange={(event) => updateField(index, { key: event.target.value })}
                      disabled={field.fixed}
                      placeholder="referenceCode"
                    />
                  </div>

                  <div className="space-y-1">
                    <Label className="md:sr-only">Label</Label>
                    <Input
                      value={field.label}
                      onChange={(event) => updateField(index, { label: event.target.value })}
                      placeholder="Reference code"
                    />
                  </div>

                  <div className="space-y-1">
                    <Label className="md:sr-only">Placeholder</Label>
                    <Input
                      value={field.placeholder ?? ''}
                      onChange={(event) => updateField(index, { placeholder: event.target.value })}
                      placeholder="Shown inside the input"
                    />
                  </div>

                  <div className="space-y-1">
                    <Label className="md:sr-only">Type</Label>
                    <select
                      className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                      value={field.kind}
                      onChange={(event) => updateField(index, { kind: event.target.value as CustomerFieldDefinitionInput['kind'] })}
                      disabled={field.fixed}
                    >
                      <option value="text">Text</option>
                      <option value="multiline">Textarea</option>
                      <option value="boolean">Checkbox</option>
                      <option value="select">Select</option>
                      <option value="radio">Radio</option>
                    </select>
                  </div>

                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={field.required}
                      onChange={(event) => updateField(index, { required: event.target.checked })}
                    />
                    Required
                  </label>

                  <div className="flex justify-end gap-2">
                    {!field.fixed ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => removeField(index)}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        Remove
                      </Button>
                    ) : (
                      <Button type="button" variant="outline" size="sm" disabled>
                        Locked
                      </Button>
                    )}
                  </div>
                </div>

                {(field.kind === 'select' || field.kind === 'radio') ? (
                  <div className="space-y-2 rounded-lg border border-dashed border-border/70 bg-muted/20 p-3">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <Settings2 className="h-4 w-4 text-muted-foreground" />
                      Options
                    </div>
                    <Textarea
                      value={(field.options ?? []).map((option) => `${option.value}:${option.label}`).join('\n')}
                      onChange={(event) => {
                        const options = event.target.value
                          .split('\n')
                          .map((line) => line.trim())
                          .filter(Boolean)
                          .map((line) => {
                            const [valuePart, ...labelParts] = line.split(':')
                            const normalizedValue = valuePart?.trim() ?? ''
                            return {
                              value: normalizedValue,
                              label: labelParts.join(':').trim() || normalizedValue,
                            }
                          })
                        updateField(index, { options })
                      }}
                      placeholder={'starter:Starter\npro:Pro'}
                    />
                    <p className="text-xs text-muted-foreground">
                      One option per line in the format <code>value:Label</code>.
                    </p>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <div className="px-4 py-8">
            <Notice compact>
              No customer fields configured yet. Add at least one field if you want to collect buyer details on the pay page.
            </Notice>
          </div>
        )}
      </div>

      <Button
        type="button"
        variant="outline"
        onClick={() => onChange(normalize([...fields, createField(fields.length)]))}
      >
        <Plus className="mr-2 h-4 w-4" />
        Add customer field
      </Button>
    </div>
  )
}

export default CustomerFieldsEditor
