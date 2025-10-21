"use client"

import * as React from 'react'
import type { ComponentProps } from 'react'
import { InlineTextEditor, InlineMultilineEditor, InlineDictionaryEditor, type InlineFieldType } from './InlineEditors'
import type { InlineFieldProps } from './InlineEditors'
import type { CustomerDictionaryKind } from '../../lib/dictionaries'

type EditorVariant = ComponentProps<typeof InlineTextEditor>['variant']

type DetailFieldCommon = {
  key: string
  label: string
  emptyLabel: string
  gridClassName?: string
  editorVariant?: EditorVariant
  activateOnClick?: boolean
  containerClassName?: string
  triggerClassName?: string
  hideLabel?: boolean
}

export type DetailTextFieldConfig = DetailFieldCommon & {
  kind: 'text'
  value: string | null | undefined
  placeholder: string
  onSave: (value: string | null) => Promise<void>
  inputType?: InlineFieldType
  validator?: InlineFieldProps['validator']
  renderDisplay?: InlineFieldProps['renderDisplay']
  recordId?: string
}

export type DetailMultilineFieldConfig = DetailFieldCommon & {
  kind: 'multiline'
  value: string | null | undefined
  placeholder: string
  onSave: (value: string | null) => Promise<void>
  validator?: (value: string) => string | null
}

export type DetailDictionaryFieldConfig = DetailFieldCommon & {
  kind: 'dictionary'
  value: string | null | undefined
  dictionaryKind: CustomerDictionaryKind
  onSave: (value: string | null) => Promise<void>
  selectClassName?: string
}

export type DetailFieldConfig =
  | DetailTextFieldConfig
  | DetailMultilineFieldConfig
  | DetailDictionaryFieldConfig

export type DetailFieldsSectionProps = {
  fields: DetailFieldConfig[]
  className?: string
}

const DEFAULT_CONTAINER_CLASS = 'rounded border bg-muted/20 p-3'
const DEFAULT_TRIGGER_CLASS =
  'h-8 w-8 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100'

export function DetailFieldsSection({ fields, className }: DetailFieldsSectionProps) {
  return (
    <div className={['grid gap-4 sm:grid-cols-2 xl:grid-cols-3', className].filter(Boolean).join(' ')}>
      {fields.map((field) => {
        const variant = field.editorVariant ?? 'muted'
        const activateOnClick = field.activateOnClick ?? true
        const containerClassName = field.containerClassName ?? DEFAULT_CONTAINER_CLASS
        const triggerClassName = field.triggerClassName ?? DEFAULT_TRIGGER_CLASS
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
                type={field.inputType}
                validator={field.validator}
                renderDisplay={field.renderDisplay}
                recordId={field.recordId}
                variant={variant}
                activateOnClick={activateOnClick}
                containerClassName={containerClassName}
                triggerClassName={triggerClassName}
                hideLabel={field.hideLabel}
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

        return (
          <div key={field.key} className={wrapperClassName}>
            <InlineDictionaryEditor
              label={field.label}
              value={field.value}
              emptyLabel={field.emptyLabel}
              onSave={field.onSave}
              kind={field.dictionaryKind}
              variant={variant}
              activateOnClick={activateOnClick}
              containerClassName={containerClassName}
              triggerClassName={triggerClassName}
              selectClassName={field.selectClassName}
            />
          </div>
        )
      })}
    </div>
  )
}
