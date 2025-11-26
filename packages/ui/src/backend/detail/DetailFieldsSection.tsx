"use client"

import * as React from 'react'
import {
  InlineMultilineEditor,
  InlineSelectEditor,
  InlineTextEditor,
  type InlineSelectOption,
  type InlineTextEditorProps,
} from './InlineEditors'

type EditorVariant = 'default' | 'muted' | 'plain'

type DetailFieldCommon = {
  key: string
  label: string
  emptyLabel: string
  gridClassName?: string
  editorVariant?: EditorVariant
  activateOnClick?: boolean
  containerClassName?: string
  triggerClassName?: string
}

export type DetailTextFieldConfig = DetailFieldCommon & {
  kind: 'text'
  value: string | null | undefined
  placeholder?: string
  onSave: (value: string | null) => Promise<void>
  inputType?: React.HTMLInputTypeAttribute
  validator?: (value: string) => string | null
  hideLabel?: boolean
  renderDisplay?: InlineTextEditorProps['renderDisplay']
}

export type DetailMultilineFieldConfig = DetailFieldCommon & {
  kind: 'multiline'
  value: string | null | undefined
  placeholder?: string
  onSave: (value: string | null) => Promise<void>
  validator?: (value: string) => string | null
}

export type DetailSelectFieldConfig = DetailFieldCommon & {
  kind: 'select'
  value: string | null | undefined
  onSave: (value: string | null) => Promise<void>
  options: InlineSelectOption[]
}

export type DetailCustomFieldConfig = DetailFieldCommon & {
  kind: 'custom'
  render: () => React.ReactNode
}

export type DetailFieldConfig =
  | DetailTextFieldConfig
  | DetailMultilineFieldConfig
  | DetailSelectFieldConfig
  | DetailCustomFieldConfig

export type DetailFieldsSectionProps = {
  fields: DetailFieldConfig[]
  className?: string
}

export function DetailFieldsSection({ fields, className }: DetailFieldsSectionProps) {
  return (
    <div className={['grid gap-4 sm:grid-cols-2 xl:grid-cols-3', className].filter(Boolean).join(' ')}>
      {fields.map((field) => {
        const variant = field.editorVariant ?? 'muted'
        const activateOnClick = field.activateOnClick ?? true
        const containerClassName = field.containerClassName ?? undefined
        const triggerClassName = field.triggerClassName ?? undefined
        const wrapperClassName = field.gridClassName ?? undefined

        if (field.kind === 'text') {
          return (
            <div key={field.key} className={wrapperClassName}>
              <InlineTextEditor
                label={field.label}
                value={field.value}
                placeholder={field.placeholder}
                emptyLabel={field.emptyLabel}
                onSave={field.onSave}
                inputType={field.inputType}
                validator={field.validator}
                variant={variant}
                activateOnClick={activateOnClick}
                containerClassName={containerClassName}
                triggerClassName={triggerClassName}
                hideLabel={field.hideLabel}
                renderDisplay={field.renderDisplay}
              />
            </div>
          )
        }

        if (field.kind === 'multiline') {
          return (
            <div key={field.key} className={wrapperClassName}>
              <InlineMultilineEditor
                label={field.label}
                value={field.value}
                placeholder={field.placeholder}
                emptyLabel={field.emptyLabel}
                onSave={field.onSave}
                validator={field.validator}
                variant={variant === 'plain' ? 'default' : variant}
                activateOnClick={activateOnClick}
                containerClassName={containerClassName}
                triggerClassName={triggerClassName}
              />
            </div>
          )
        }

        if (field.kind === 'select') {
          return (
            <div key={field.key} className={wrapperClassName}>
              <InlineSelectEditor
                label={field.label}
                value={field.value}
                emptyLabel={field.emptyLabel}
                onSave={field.onSave}
                options={field.options}
                variant={variant}
                activateOnClick={activateOnClick}
                containerClassName={containerClassName}
                triggerClassName={triggerClassName}
              />
            </div>
          )
        }

        return (
          <div key={field.key} className={wrapperClassName}>
            {field.render()}
          </div>
        )
      })}
    </div>
  )
}
