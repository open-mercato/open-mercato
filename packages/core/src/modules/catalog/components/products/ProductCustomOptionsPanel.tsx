"use client"

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { useT } from '@/lib/i18n/context'

export type CustomOptionDraft = {
  id: string
  label: string
  code: string
  description?: string
  inputType: 'text' | 'textarea' | 'number' | 'select'
  isRequired?: boolean
  isMultiple?: boolean
  choices?: Array<{ id: string; label: string; value: string }>
}

type CrudValues = Record<string, unknown>

type Props = {
  values: CrudValues
  setValue: (field: string, value: unknown) => void
}

const INPUT_TYPES: Array<CustomOptionDraft['inputType']> = ['text', 'textarea', 'number', 'select']

export function ProductCustomOptionsPanel({ values, setValue }: Props) {
  const t = useT()
  const options = Array.isArray(values.customOptions)
    ? (values.customOptions as CustomOptionDraft[])
    : []

  const updateOptions = (next: CustomOptionDraft[]) => {
    setValue('customOptions', next)
  }

  const addOption = () => {
    updateOptions([
      ...options,
      {
        id: createLocalId(),
        label: '',
        code: '',
        inputType: 'text',
        isRequired: false,
        isMultiple: false,
        choices: [],
      },
    ])
  }

  const updateOption = (id: string, patch: Partial<CustomOptionDraft>) => {
    updateOptions(options.map((option) => (option.id === id ? { ...option, ...patch } : option)))
  }

  const removeOption = (id: string) => {
    updateOptions(options.filter((option) => option.id !== id))
  }

  return (
    <div className="space-y-4">
      <Button type="button" onClick={addOption}>
        {t('catalog.products.create.options.add', 'Add custom option')}
      </Button>
      {options.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t('catalog.products.create.options.empty', 'No custom options yet.')}
        </p>
      ) : (
        <div className="space-y-4">
          {options.map((option) => (
            <div key={option.id} className="space-y-3 rounded-lg border bg-card p-4">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
                <div>
                  <label className="text-xs font-medium uppercase tracking-wide">
                    {t('catalog.products.create.options.label', 'Label')}
                  </label>
                  <Input
                    value={option.label}
                    onChange={(event) => {
                      const nextLabel = event.target.value
                      updateOption(option.id, {
                        label: nextLabel,
                        code: option.code || slugify(nextLabel),
                      })
                    }}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium uppercase tracking-wide">Code</label>
                  <Input
                    value={option.code}
                    onChange={(event) => updateOption(option.id, { code: event.target.value })}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium uppercase tracking-wide">
                    {t('catalog.products.create.options.type', 'Type')}
                  </label>
                  <select
                    className="w-full rounded border px-3 py-2 text-sm"
                    value={option.inputType}
                    onChange={(event) =>
                      updateOption(option.id, {
                        inputType: event.target.value as CustomOptionDraft['inputType'],
                      })
                    }
                  >
                    {INPUT_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-end justify-between gap-3">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={option.isRequired ?? false}
                      onChange={(event) => updateOption(option.id, { isRequired: event.target.checked })}
                    />
                    {t('catalog.products.create.options.required', 'Required')}
                  </label>
                  {option.inputType === 'select' ? (
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={option.isMultiple ?? false}
                        onChange={(event) => updateOption(option.id, { isMultiple: event.target.checked })}
                      />
                      {t('catalog.products.create.options.multiple', 'Allow multiple')}
                    </label>
                  ) : null}
                </div>
              </div>
              <div>
                <label className="text-xs font-medium uppercase tracking-wide">
                  {t('catalog.products.create.options.description', 'Description')}
                </label>
                <Input
                  value={option.description ?? ''}
                  onChange={(event) => updateOption(option.id, { description: event.target.value })}
                />
              </div>
              {option.inputType === 'select' ? (
                <OptionChoicesEditor
                  choices={option.choices ?? []}
                  onChange={(choices) => updateOption(option.id, { choices })}
                />
              ) : null}
              <div className="flex justify-end">
                <Button type="button" variant="ghost" onClick={() => removeOption(option.id)}>
                  {t('catalog.products.create.remove', 'Remove')}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

type OptionChoicesEditorProps = {
  choices: NonNullable<CustomOptionDraft['choices']>
  onChange: (choices: NonNullable<CustomOptionDraft['choices']>) => void
}

function OptionChoicesEditor({ choices, onChange }: OptionChoicesEditorProps) {
  const t = useT()
  const addChoice = () => {
    onChange([
      ...choices,
      {
        id: createLocalId(),
        label: '',
        value: '',
      },
    ])
  }
  const updateChoice = (id: string, patch: Partial<{ label: string; value: string }>) => {
    onChange(choices.map((choice) => (choice.id === id ? { ...choice, ...patch } : choice)))
  }
  const removeChoice = (id: string) => {
    onChange(choices.filter((choice) => choice.id !== id))
  }
  return (
    <div className="space-y-2 rounded border p-3">
      <div className="text-xs font-semibold uppercase tracking-wide">
        {t('catalog.products.create.options.choices', 'Choices')}
      </div>
      {choices.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {t('catalog.products.create.options.noChoices', 'No choices yet.')}
        </p>
      ) : (
        choices.map((choice) => (
          <div
            key={choice.id}
            className="grid grid-cols-1 gap-2 md:grid-cols-[2fr_2fr_auto]"
          >
            <Input
              placeholder={t('catalog.products.create.options.choiceValue', 'Value')}
              value={choice.value}
              onChange={(event) => updateChoice(choice.id, { value: event.target.value })}
            />
            <Input
              placeholder={t('catalog.products.create.options.choiceLabel', 'Label')}
              value={choice.label}
              onChange={(event) => updateChoice(choice.id, { label: event.target.value })}
            />
            <Button type="button" variant="ghost" onClick={() => removeChoice(choice.id)}>
              {t('catalog.products.create.options.removeChoice', 'Remove')}
            </Button>
          </div>
        ))
      )}
      <Button type="button" variant="secondary" onClick={addChoice}>
        {t('catalog.products.create.options.addChoice', 'Add choice')}
      </Button>
    </div>
  )
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
}

function createLocalId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `opt_${Math.random().toString(36).slice(2, 10)}`
}
