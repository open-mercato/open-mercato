"use client"

import * as React from 'react'
import { Plus, Settings2, Trash2 } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Notice } from '@open-mercato/ui/primitives/Notice'
import type { CustomerFieldDefinitionInput } from '../data/validators'
import { DEFAULT_CHECKOUT_CUSTOMER_FIELDS } from '../lib/defaults'

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
  const t = useT()
  const fields = React.useMemo<CustomerFieldDefinitionInput[]>(
    () => (
      Array.isArray(value)
        ? value
        : DEFAULT_CHECKOUT_CUSTOMER_FIELDS.map((field) => ({ ...field, options: [] }))
    ),
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

  const updateOption = React.useCallback(
    (fieldIndex: number, optionIndex: number, patch: { value?: string; label?: string }) => {
      const field = fields[fieldIndex]
      if (!field) return
      const options = Array.isArray(field.options) ? field.options : []
      updateField(fieldIndex, {
        options: options.map((option: { value: string; label: string }, currentIndex: number) => (
          currentIndex === optionIndex ? { ...option, ...patch } : option
        )),
      })
    },
    [fields, updateField],
  )

  const addOption = React.useCallback(
    (fieldIndex: number) => {
      const field = fields[fieldIndex]
      if (!field) return
      const options = Array.isArray(field.options) ? field.options : []
      updateField(fieldIndex, {
        options: [
          ...options,
          { value: `option_${options.length + 1}`, label: `Option ${options.length + 1}` },
        ],
      })
    },
    [fields, updateField],
  )

  const removeOption = React.useCallback(
    (fieldIndex: number, optionIndex: number) => {
      const field = fields[fieldIndex]
      if (!field) return
      const options = Array.isArray(field.options) ? field.options : []
      updateField(fieldIndex, {
        options: options.filter((_: { value: string; label: string }, currentIndex: number) => currentIndex !== optionIndex),
      })
    },
    [fields, updateField],
  )

  return (
    <div className="space-y-4">
      <Notice compact>
        {t('checkout.customerFieldsEditor.notices.defaultFields')}
      </Notice>

      <div className="overflow-hidden rounded-xl border border-border/70 bg-background">
        <div className="hidden grid-cols-[1fr_1fr_1fr_180px_90px_110px] gap-3 border-b bg-muted/30 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground md:grid">
          <div>{t('checkout.customerFieldsEditor.columns.fieldKey')}</div>
          <div>{t('checkout.customerFieldsEditor.columns.label')}</div>
          <div>{t('checkout.customerFieldsEditor.columns.placeholder')}</div>
          <div>{t('checkout.customerFieldsEditor.columns.type')}</div>
          <div>{t('checkout.customerFieldsEditor.columns.required')}</div>
          <div className="text-right">{t('checkout.customerFieldsEditor.columns.actions')}</div>
        </div>

        {fields.length > 0 ? (
          <div className="divide-y divide-border/70">
            {fields.map((field, index) => (
              <div key={`${field.key}:${index}`} className="space-y-3 px-4 py-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-1">
                    <Label>{t('checkout.customerFieldsEditor.columns.fieldKey')}</Label>
                    <Input
                      value={field.key}
                      onChange={(event) => updateField(index, { key: event.target.value })}
                      disabled={field.fixed}
                      placeholder={t('checkout.customerFieldsEditor.placeholders.fieldKey')}
                    />
                  </div>

                  <div className="space-y-1">
                    <Label>{t('checkout.customerFieldsEditor.columns.label')}</Label>
                    <Input
                      value={field.label}
                      onChange={(event) => updateField(index, { label: event.target.value })}
                      placeholder={t('checkout.customerFieldsEditor.placeholders.label')}
                    />
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-[1.2fr_180px_100px_110px] md:items-end">
                  <div className="space-y-1">
                    <Label>{t('checkout.customerFieldsEditor.columns.placeholder')}</Label>
                    <Input
                      value={field.placeholder ?? ''}
                      onChange={(event) => updateField(index, { placeholder: event.target.value })}
                      placeholder={t('checkout.customerFieldsEditor.placeholders.placeholder')}
                    />
                  </div>

                  <div className="space-y-1">
                    <Label>{t('checkout.customerFieldsEditor.columns.type')}</Label>
                    <select
                      className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                      value={field.kind}
                      onChange={(event) => updateField(index, { kind: event.target.value as CustomerFieldDefinitionInput['kind'] })}
                      disabled={field.fixed}
                    >
                      <option value="text">{t('checkout.customerFieldsEditor.types.text')}</option>
                      <option value="multiline">{t('checkout.customerFieldsEditor.types.multiline')}</option>
                      <option value="boolean">{t('checkout.customerFieldsEditor.types.boolean')}</option>
                      <option value="select">{t('checkout.customerFieldsEditor.types.select')}</option>
                      <option value="radio">{t('checkout.customerFieldsEditor.types.radio')}</option>
                    </select>
                  </div>

                  <label className="flex h-9 items-center gap-2 rounded-md border border-border/70 bg-muted/20 px-3 text-sm">
                    <input
                      type="checkbox"
                      checked={field.required}
                      onChange={(event) => updateField(index, { required: event.target.checked })}
                    />
                    {t('checkout.customerFieldsEditor.columns.required')}
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
                        {t('checkout.common.actions.remove')}
                      </Button>
                    ) : (
                      <Button type="button" variant="outline" size="sm" disabled>
                        {t('checkout.customerFieldsEditor.locked')}
                      </Button>
                    )}
                  </div>
                </div>

                {(field.kind === 'select' || field.kind === 'radio') ? (
                  <div className="space-y-2 rounded-lg border border-dashed border-border/70 bg-muted/20 p-3">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      <Settings2 className="h-4 w-4 text-muted-foreground" />
                      {t('checkout.customerFieldsEditor.options.title')}
                    </div>
                    <div className="overflow-hidden rounded-lg border border-border/70 bg-background">
                      <table className="w-full table-fixed">
                        <thead className="border-b bg-muted/30">
                          <tr className="text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            <th className="px-3 py-2 w-[40%]">{t('checkout.customerFieldsEditor.options.value')}</th>
                            <th className="px-3 py-2">{t('checkout.customerFieldsEditor.options.label')}</th>
                            <th className="px-3 py-2 w-[96px] text-right">{t('checkout.customerFieldsEditor.columns.actions')}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/70">
                          {(field.options ?? []).map((option, optionIndex) => (
                            <tr key={`${field.key}:option:${optionIndex}`}>
                              <td className="px-3 py-2">
                                <Input
                                  value={option.value}
                                  onChange={(event) => updateOption(index, optionIndex, { value: event.target.value })}
                                  placeholder={t('checkout.customerFieldsEditor.options.placeholders.value')}
                                  className="h-8"
                                />
                              </td>
                              <td className="px-3 py-2">
                                <Input
                                  value={option.label}
                                  onChange={(event) => updateOption(index, optionIndex, { label: event.target.value })}
                                  placeholder={t('checkout.customerFieldsEditor.options.placeholders.label')}
                                  className="h-8"
                                />
                              </td>
                              <td className="px-3 py-2 text-right">
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => removeOption(index, optionIndex)}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <Button type="button" variant="outline" size="sm" onClick={() => addOption(index)}>
                      <Plus className="mr-2 h-4 w-4" />
                      {t('checkout.customerFieldsEditor.options.add')}
                    </Button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <div className="px-4 py-8">
            <Notice compact>
              {t('checkout.customerFieldsEditor.notices.empty')}
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
        {t('checkout.customerFieldsEditor.addField')}
      </Button>
    </div>
  )
}

export default CustomerFieldsEditor
