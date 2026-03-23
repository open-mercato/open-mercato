"use client"

import * as React from 'react'
import { Plus, Settings2, Trash2 } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Notice } from '@open-mercato/ui/primitives/Notice'
import type { CustomerFieldDefinitionInput } from '../data/validators'
import { getLocalizedDefaultCheckoutCustomerFields } from '../lib/defaults'

type Props = {
  value: CustomerFieldDefinitionInput[]
  onChange: (next: CustomerFieldDefinitionInput[]) => void
  errors?: Record<string, string>
}

function withSortOrder(next: CustomerFieldDefinitionInput[]): CustomerFieldDefinitionInput[] {
  return next.map((field, index) => ({
    ...field,
    sortOrder: index,
  }))
}

function createField(index: number, t: ReturnType<typeof useT>): CustomerFieldDefinitionInput {
  return {
    key: `customField${index + 1}`,
    label: t('checkout.customerFieldsEditor.newFieldLabel'),
    kind: 'text',
    required: false,
    fixed: false,
    placeholder: t('checkout.customerFieldsEditor.newFieldPlaceholder'),
    sortOrder: index,
    options: [],
  }
}

export function CustomerFieldsEditor({ value, onChange, errors }: Props) {
  const t = useT()
  const fields = React.useMemo<CustomerFieldDefinitionInput[]>(
    () => (
      Array.isArray(value)
        ? value
        : getLocalizedDefaultCheckoutCustomerFields(t).map((field) => ({ ...field, options: [] }))
    ),
    [t, value],
  )

  const updateField = React.useCallback(
    (index: number, patch: Partial<CustomerFieldDefinitionInput>) => {
      onChange(
        withSortOrder(
          fields.map((field, currentIndex) => (currentIndex === index ? { ...field, ...patch } : field)),
        ),
      )
    },
    [fields, onChange],
  )

  const removeField = React.useCallback(
    (index: number) => {
      onChange(withSortOrder(fields.filter((_, currentIndex) => currentIndex !== index)))
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
          {
            value: `option_${options.length + 1}`,
            label: t('checkout.customerFieldsEditor.options.defaultLabel', 'Option {index}', { index: options.length + 1 }),
          },
        ],
      })
    },
    [fields, t, updateField],
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

  const readFieldError = React.useCallback(
    (fieldIndex: number, key: string) => errors?.[`customerFieldsSchema.${fieldIndex}.${key}`],
    [errors],
  )

  const readOptionError = React.useCallback(
    (fieldIndex: number, optionIndex: number, key: string) => (
      errors?.[`customerFieldsSchema.${fieldIndex}.options.${optionIndex}.${key}`]
    ),
    [errors],
  )

  const readNestedError = React.useCallback(
    (path: string) => {
      if (!errors) return undefined
      if (errors[path]) return errors[path]
      const prefix = `${path}.`
      const nestedEntry = Object.entries(errors).find(([key]) => key.startsWith(prefix))
      return nestedEntry?.[1]
    },
    [errors],
  )

  const inputClassName = React.useCallback(
    (error?: string) => (error ? 'border-destructive focus-visible:ring-destructive/30' : undefined),
    [],
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
            {fields.map((field, index) => {
              const keyError = readFieldError(index, 'key')
              const labelError = readFieldError(index, 'label')
              const placeholderError = readFieldError(index, 'placeholder')
              const kindError = readFieldError(index, 'kind')
              const optionsError = readNestedError(`customerFieldsSchema.${index}.options`)

              return (
                <div key={index} className="space-y-3 px-4 py-4">
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-1">
                      <Label>{t('checkout.customerFieldsEditor.columns.fieldKey')}</Label>
                      <Input
                        value={field.key}
                        onChange={(event) => updateField(index, { key: event.target.value })}
                        disabled={field.fixed}
                        placeholder={t('checkout.customerFieldsEditor.placeholders.fieldKey')}
                        className={inputClassName(keyError)}
                        aria-invalid={Boolean(keyError)}
                      />
                      {keyError ? <p className="text-xs text-destructive">{keyError}</p> : null}
                    </div>

                    <div className="space-y-1">
                      <Label>{t('checkout.customerFieldsEditor.columns.label')}</Label>
                      <Input
                        value={field.label}
                        onChange={(event) => updateField(index, { label: event.target.value })}
                        placeholder={t('checkout.customerFieldsEditor.placeholders.label')}
                        className={inputClassName(labelError)}
                        aria-invalid={Boolean(labelError)}
                      />
                      {labelError ? <p className="text-xs text-destructive">{labelError}</p> : null}
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-[1.2fr_180px_100px_110px] md:items-end">
                    <div className="space-y-1">
                      <Label>{t('checkout.customerFieldsEditor.columns.placeholder')}</Label>
                      <Input
                        value={field.placeholder ?? ''}
                        onChange={(event) => updateField(index, { placeholder: event.target.value })}
                        placeholder={t('checkout.customerFieldsEditor.placeholders.placeholder')}
                        className={inputClassName(placeholderError)}
                        aria-invalid={Boolean(placeholderError)}
                      />
                      {placeholderError ? <p className="text-xs text-destructive">{placeholderError}</p> : null}
                    </div>

                    <div className="space-y-1">
                      <Label>{t('checkout.customerFieldsEditor.columns.type')}</Label>
                      <select
                        className={kindError
                          ? 'w-full rounded-md border border-destructive bg-background px-3 py-2 text-sm focus-visible:ring-destructive/30'
                          : 'w-full rounded-md border bg-background px-3 py-2 text-sm'}
                        value={field.kind}
                        onChange={(event) => updateField(index, { kind: event.target.value as CustomerFieldDefinitionInput['kind'] })}
                        disabled={field.fixed}
                        aria-invalid={Boolean(kindError)}
                      >
                        <option value="text">{t('checkout.customerFieldsEditor.types.text')}</option>
                        <option value="multiline">{t('checkout.customerFieldsEditor.types.multiline')}</option>
                        <option value="boolean">{t('checkout.customerFieldsEditor.types.boolean')}</option>
                        <option value="select">{t('checkout.customerFieldsEditor.types.select')}</option>
                        <option value="radio">{t('checkout.customerFieldsEditor.types.radio')}</option>
                      </select>
                      {kindError ? <p className="text-xs text-destructive">{kindError}</p> : null}
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
                      {optionsError ? <p className="text-xs text-destructive">{optionsError}</p> : null}
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
                            {(field.options ?? []).map((option, optionIndex) => {
                              const optionValueError = readOptionError(index, optionIndex, 'value')
                              const optionLabelError = readOptionError(index, optionIndex, 'label')

                              return (
                                <tr key={optionIndex}>
                                  <td className="px-3 py-2">
                                    <Input
                                      value={option.value}
                                      onChange={(event) => updateOption(index, optionIndex, { value: event.target.value })}
                                      placeholder={t('checkout.customerFieldsEditor.options.placeholders.value')}
                                      className={`h-8 ${inputClassName(optionValueError) ?? ''}`.trim()}
                                      aria-invalid={Boolean(optionValueError)}
                                    />
                                    {optionValueError ? (
                                      <p className="mt-1 text-xs text-destructive">{optionValueError}</p>
                                    ) : null}
                                  </td>
                                  <td className="px-3 py-2">
                                    <Input
                                      value={option.label}
                                      onChange={(event) => updateOption(index, optionIndex, { label: event.target.value })}
                                      placeholder={t('checkout.customerFieldsEditor.options.placeholders.label')}
                                      className={`h-8 ${inputClassName(optionLabelError) ?? ''}`.trim()}
                                      aria-invalid={Boolean(optionLabelError)}
                                    />
                                    {optionLabelError ? (
                                      <p className="mt-1 text-xs text-destructive">{optionLabelError}</p>
                                    ) : null}
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
                              )
                            })}
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
              )})}
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
        onClick={() => onChange(withSortOrder([...fields, createField(fields.length, t)]))}
      >
        <Plus className="mr-2 h-4 w-4" />
        {t('checkout.customerFieldsEditor.addField')}
      </Button>
    </div>
  )
}

export default CustomerFieldsEditor
