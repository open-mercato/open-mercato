"use client"

import * as React from 'react'
import { Languages } from 'lucide-react'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { normalizeCustomFieldOptions } from '@open-mercato/shared/modules/entities/options'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { readRequestOrganizationScope } from '@open-mercato/shared/lib/frontend/organizationEvents'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import type { FieldDefinition } from '@open-mercato/ui/backend/custom-fields/FieldDefinitionsEditor'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { TranslationManager } from './TranslationManager'

export type DictionaryEntryContext = {
  dictionaryId: string
  entry: { id: string; label: string }
}

export type FieldDefinitionContext = {
  entityId: string
  definition: FieldDefinition
}

type TranslationActionProps = {
  entityType: string
  recordId: string
  baseValues: Record<string, string>
  translatableFields: string[]
  label: string
  title: string
  description?: string
  compact?: boolean
  disabled?: boolean
  requiresSelectedOrganization?: boolean
}

function TranslationAction({ label, title, description, disabled, requiresSelectedOrganization, ...managerProps }: TranslationActionProps) {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const [open, setOpen] = React.useState(false)
  const requiresOrganization = open && requiresSelectedOrganization && readRequestOrganizationScope()?.organizationId === null
  const dialogDescription = requiresOrganization
    ? t('translations.manager.selectOrganization', 'Select a specific organization in the header to edit translations.')
    : description

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <IconButton
        type="button"
        variant={managerProps.compact ? 'outline' : 'ghost'}
        size={managerProps.compact ? 'sm' : 'lg'}
        onClick={() => setOpen(true)}
        aria-label={label}
        title={label}
        disabled={disabled}
      >
        <Languages className="size-4" />
      </IconButton>
      <DialogContent className="max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {dialogDescription ? <DialogDescription>{dialogDescription}</DialogDescription> : null}
        </DialogHeader>
        {open && !requiresOrganization ? <TranslationManager key={scopeVersion} mode="embedded" {...managerProps} /> : null}
      </DialogContent>
    </Dialog>
  )
}

export function DictionaryEntryTranslationAction({ context, disabled }: InjectionWidgetComponentProps<DictionaryEntryContext>) {
  const t = useT()
  const entry = context.entry
  if (!entry.id) return null

  return (
    <TranslationAction
      entityType="dictionaries:dictionary_entry"
      recordId={entry.id}
      baseValues={{ label: entry.label }}
      translatableFields={['label']}
      label={t('dictionaries.config.entries.actions.translate', 'Translate')}
      title={t('translations.manager.translateEntry', 'Translate: {{label}}', { label: entry.label })}
      description={t('translations.manager.translateEntryDescription', 'Manage translations for this dictionary entry.')}
      disabled={disabled}
      requiresSelectedOrganization
    />
  )
}

export function FieldDefinitionTranslationAction({ context, disabled }: InjectionWidgetComponentProps<FieldDefinitionContext>) {
  const t = useT()
  const { entityId, definition } = context
  if (!entityId || !definition.key) return null

  const translatableFields = ['label', 'description']
  const baseValues: Record<string, string> = {}
  if (typeof definition.configJson?.label === 'string') baseValues.label = definition.configJson.label
  if (typeof definition.configJson?.description === 'string') baseValues.description = definition.configJson.description
  for (const option of normalizeCustomFieldOptions(definition.configJson?.options)) {
    if (option.value) {
      const field = `options.${option.value}.label`
      translatableFields.push(field)
      if (option.label) baseValues[field] = option.label
    }
  }

  return (
    <TranslationAction
      compact
      entityType="entities:custom_field_def"
      recordId={`${entityId}:${definition.key}`}
      baseValues={baseValues}
      translatableFields={translatableFields}
      label={t('entities.customFields.editor.translateField', 'Translate field')}
      title={t('translations.manager.translateField', 'Translate field: {{key}}', { key: definition.key })}
      disabled={disabled}
    />
  )
}
