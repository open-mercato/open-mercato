"use client"

import * as React from 'react'
import type { CrudCustomFieldRenderProps } from '@open-mercato/ui/backend/CrudForm'
import { FieldRegistry } from '@open-mercato/ui/backend/fields/registry'
import { useT } from '@/lib/i18n/context'
import { DictionarySelectControl } from '../components/DictionarySelectControl'

type DictionaryFieldDefinition = {
  dictionaryId?: string
  dictionaryInlineCreate?: boolean
}

type Props = CrudCustomFieldRenderProps & { def?: DictionaryFieldDefinition }

function DictionaryFieldInput({ value, onChange, disabled, def }: Props) {
  const t = useT()
  const dictionaryId = def?.dictionaryId
  if (!dictionaryId) {
    return (
      <div className="rounded border border-dashed p-3 text-sm text-muted-foreground">
        {t('dictionaries.config.entries.error.load', 'Failed to load dictionary entries.')}
      </div>
    )
  }
  const normalizedValue = typeof value === 'string' ? value : Array.isArray(value) ? String(value[0] ?? '') : undefined
  return (
    <DictionarySelectControl
      dictionaryId={dictionaryId}
      value={normalizedValue ?? ''}
      onChange={(next) => onChange(next ?? undefined)}
      allowInlineCreate={def?.dictionaryInlineCreate !== false}
      disabled={disabled}
    />
  )
}

FieldRegistry.register('dictionary', {
  input: DictionaryFieldInput,
})
