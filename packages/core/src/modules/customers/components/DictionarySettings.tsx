"use client"

import * as React from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { useOrganizationScopeVersion } from '@/lib/frontend/useOrganizationScope'
import { useT } from '@/lib/i18n/context'
import type { DictionaryRouteParam } from '../../api/dictionaries/context'
import { ICON_SUGGESTIONS } from '@open-mercato/core/modules/dictionaries/components/dictionaryAppearance'
import {
  DictionaryForm,
  type DictionaryFormValues,
} from '@open-mercato/core/modules/dictionaries/components/DictionaryForm'
import {
  DictionaryTable,
  type DictionaryTableEntry,
} from '@open-mercato/core/modules/dictionaries/components/DictionaryTable'

type CustomerDictionaryKind = DictionaryRouteParam

type SectionDefinition = {
  kind: CustomerDictionaryKind
  title: string
  description: string
}

type DialogState =
  | { mode: 'create' }
  | { mode: 'edit'; entry: DictionaryTableEntry }

const DEFAULT_FORM_VALUES: DictionaryFormValues = {
  value: '',
  label: '',
  color: null,
  icon: null,
}

export default function DictionarySettings() {
  const t = useT()

  const sections = React.useMemo<SectionDefinition[]>(() => [
    {
      kind: 'statuses',
      title: t('customers.config.dictionaries.sections.statuses.title', 'Statuses'),
      description: t('customers.config.dictionaries.sections.statuses.description', 'Define the statuses available for customer records.'),
    },
    {
      kind: 'deal-statuses',
      title: t('customers.config.dictionaries.sections.dealStatuses.title', 'Deal statuses'),
      description: t('customers.config.dictionaries.sections.dealStatuses.description', 'Manage the statuses available for deals.'),
    },
    {
      kind: 'pipeline-stages',
      title: t('customers.config.dictionaries.sections.pipelineStages.title', 'Pipeline stages'),
      description: t('customers.config.dictionaries.sections.pipelineStages.description', 'Define the stages used in your deal pipeline.'),
    },
    {
      kind: 'job-titles',
      title: t('customers.config.dictionaries.sections.jobTitles.title', 'Job titles'),
      description: t('customers.config.dictionaries.sections.jobTitles.description', 'Configure job titles with their appearance.'),
    },
    {
      kind: 'sources',
      title: t('customers.config.dictionaries.sections.sources.title', 'Sources'),
      description: t('customers.config.dictionaries.sections.sources.description', 'Capture how customers were acquired.'),
    },
    {
      kind: 'lifecycle-stages',
      title: t('customers.config.dictionaries.sections.lifecycle.title', 'Lifecycle stages'),
      description: t('customers.config.dictionaries.sections.lifecycle.description', 'Configure lifecycle stages to track customer progress.'),
    },
    {
      kind: 'address-types',
      title: t('customers.config.dictionaries.sections.addressTypes.title', 'Address types'),
      description: t('customers.config.dictionaries.sections.addressTypes.description', 'Define the available address types.'),
    },
  ], [t])

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">
          {t('customers.config.dictionaries.title', 'Customers dictionaries')}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t('customers.config.dictionaries.description', 'Manage the dictionaries used by the customers module.')}
        </p>
      </header>

      <div className="space-y-6">
        {sections.map((section) => (
          <CustomerDictionarySection key={section.kind} {...section} />
        ))}
      </div>
    </div>
  )
}

type CustomerDictionarySectionProps = SectionDefinition

function CustomerDictionarySection({ kind, title, description }: CustomerDictionarySectionProps) {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const [entries, setEntries] = React.useState<DictionaryTableEntry[]>([])
  const [loading, setLoading] = React.useState<boolean>(true)
  const [dialog, setDialog] = React.useState<DialogState | null>(null)
  const [submitting, setSubmitting] = React.useState(false)

  const inheritedActionBlocked = t('customers.config.dictionaries.inherited.blocked', 'Inherited entries can only be edited from the parent organization.')
  const inheritedTooltip = t('customers.config.dictionaries.inherited.tooltip', 'Managed in parent organization')
  const inheritedLabel = t('customers.config.dictionaries.inherited.label', 'Inherited')
  const errorLoad = t('customers.config.dictionaries.error.load', 'Failed to load dictionary entries.')
  const errorSave = t('customers.config.dictionaries.error.save', 'Failed to save dictionary entry.')
  const errorDelete = t('customers.config.dictionaries.error.delete', 'Failed to delete dictionary entry.')
  const successSave = t('customers.config.dictionaries.success.save', 'Dictionary entry saved.')
  const successDelete = t('customers.config.dictionaries.success.delete', 'Dictionary entry deleted.')
  const deleteConfirmTemplate = t('customers.config.dictionaries.deleteConfirm', 'Delete "{{value}}"?')
  const searchPlaceholder = t('customers.config.dictionaries.searchPlaceholder', 'Search entries…')

  const loadEntries = React.useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiFetch(`/api/customers/dictionaries/${kind}`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !Array.isArray(data?.items)) {
        throw new Error(errorLoad)
      }
      const mapped: DictionaryTableEntry[] = data.items.map((item: any) => ({
        id: String(item.id),
        value: String(item.value ?? ''),
        label: typeof item.label === 'string' ? item.label : '',
        color: typeof item.color === 'string' ? item.color : null,
        icon: typeof item.icon === 'string' ? item.icon : null,
        organizationId: typeof item.organizationId === 'string' ? item.organizationId : null,
        tenantId: typeof item.tenantId === 'string' ? item.tenantId : null,
        isInherited: item.isInherited === true,
        createdAt: typeof item.createdAt === 'string' ? item.createdAt : null,
        updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : null,
      }))
      setEntries(mapped)
    } catch (err) {
      console.error('customers.dictionaries.list failed', err)
      flash(errorLoad, 'error')
    } finally {
      setLoading(false)
    }
  }, [errorLoad, kind, scopeVersion])

  React.useEffect(() => {
    loadEntries().catch(() => {})
  }, [loadEntries])

  const closeDialog = React.useCallback(() => {
    setDialog(null)
  }, [])

  const handleCreate = React.useCallback(() => {
    setDialog({ mode: 'create' })
  }, [])

  const handleEdit = React.useCallback((entry: DictionaryTableEntry) => {
    if (entry.isInherited) {
      flash(inheritedActionBlocked, 'info')
      return
    }
    setDialog({ mode: 'edit', entry })
  }, [inheritedActionBlocked])

  const handleDelete = React.useCallback(async (entry: DictionaryTableEntry) => {
    if (entry.isInherited) {
      flash(inheritedActionBlocked, 'info')
      return
    }
    const message = deleteConfirmTemplate.replace('{{value}}', entry.label || entry.value)
    if (!window.confirm(message)) return
    try {
      const res = await apiFetch(`/api/customers/dictionaries/${kind}/${encodeURIComponent(entry.id)}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}))
        const messageValue = typeof payload?.error === 'string' ? payload.error : errorDelete
        flash(messageValue, 'error')
        return
      }
      flash(successDelete, 'success')
      await loadEntries()
    } catch (err) {
      console.error('customers.dictionaries.delete failed', err)
      flash(errorDelete, 'error')
    }
  }, [deleteConfirmTemplate, errorDelete, inheritedActionBlocked, kind, loadEntries, successDelete])

  const submitForm = React.useCallback(async (values: DictionaryFormValues) => {
    const payload = {
      value: values.value,
      label: values.label,
      color: values.color,
      icon: values.icon,
    }
    setSubmitting(true)
    try {
      if (!dialog || dialog.mode === 'create') {
        const res = await apiFetch(`/api/customers/dictionaries/${kind}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          const message = typeof data?.error === 'string' ? data.error : errorSave
          throw new Error(message)
        }
        flash(successSave, 'success')
      } else if (dialog.mode === 'edit') {
        const target = dialog.entry
        if (target.isInherited) {
          flash(inheritedActionBlocked, 'info')
          return
        }
        const body: Record<string, unknown> = {}
        if (values.value !== target.value) body.value = values.value
        if (values.label !== target.label) body.label = values.label
        const nextColor = values.color ?? null
        if (nextColor !== (target.color ?? null)) body.color = nextColor
        const nextIcon = values.icon ?? null
        if (nextIcon !== (target.icon ?? null)) body.icon = nextIcon
        if (Object.keys(body).length === 0) {
          closeDialog()
          return
        }
        const res = await apiFetch(`/api/customers/dictionaries/${kind}/${encodeURIComponent(target.id)}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          const message = typeof data?.error === 'string' ? data.error : errorSave
          throw new Error(message)
        }
        flash(successSave, 'success')
      }
      closeDialog()
      await loadEntries()
    } catch (err) {
      console.error('customers.dictionaries.submit failed', err)
      throw err instanceof Error ? err : new Error(errorSave)
    } finally {
      setSubmitting(false)
    }
  }, [closeDialog, dialog, errorSave, inheritedActionBlocked, kind, loadEntries, successSave])

  const currentValues = React.useMemo<DictionaryFormValues>(() => {
    if (dialog && dialog.mode === 'edit') {
      return {
        value: dialog.entry.value,
        label: dialog.entry.label,
        color: dialog.entry.color,
        icon: dialog.entry.icon,
      }
    }
    return DEFAULT_FORM_VALUES
  }, [dialog])

  const tableTranslations = React.useMemo(() => ({
    title,
    valueColumn: t('customers.config.dictionaries.columns.value', 'Value'),
    labelColumn: t('customers.config.dictionaries.columns.label', 'Label'),
    appearanceColumn: t('customers.config.dictionaries.columns.appearance', 'Appearance'),
    addLabel: t('customers.config.dictionaries.actions.add', 'Add entry'),
    editLabel: t('customers.config.dictionaries.actions.edit', 'Edit'),
    deleteLabel: t('customers.config.dictionaries.actions.delete', 'Delete'),
    refreshLabel: t('customers.config.dictionaries.actions.refresh', 'Refresh'),
    inheritedLabel,
    inheritedTooltip,
    emptyLabel: t('customers.config.dictionaries.empty', 'No entries yet.'),
    searchPlaceholder,
  }), [inheritedLabel, inheritedTooltip, searchPlaceholder, t, title])

  const formTranslations = React.useMemo(() => ({
    title: dialog?.mode === 'edit'
      ? t('customers.config.dictionaries.dialog.editTitle', 'Edit entry')
      : t('customers.config.dictionaries.dialog.addTitle', 'Add entry'),
    valueLabel: t('customers.config.dictionaries.dialog.valueLabel', 'Value'),
    labelLabel: t('customers.config.dictionaries.dialog.labelLabel', 'Label'),
    saveLabel: t('customers.config.dictionaries.dialog.save', 'Save'),
    cancelLabel: t('customers.config.dictionaries.dialog.cancel', 'Cancel'),
    appearance: {
      colorLabel: t('customers.config.dictionaries.dialog.colorLabel', 'Color'),
      colorHelp: t('customers.config.dictionaries.dialog.colorHelp', 'Pick a highlight color for this entry.'),
      colorClearLabel: t('customers.config.dictionaries.dialog.colorClear', 'Remove color'),
      iconLabel: t('customers.config.dictionaries.dialog.iconLabel', 'Icon'),
      iconPlaceholder: t('customers.config.dictionaries.dialog.iconPlaceholder', 'Type an emoji or pick one of the suggestions.'),
      iconPickerTriggerLabel: t('customers.config.dictionaries.dialog.iconBrowse', 'Browse icons and emojis'),
      iconSearchPlaceholder: t('customers.config.dictionaries.dialog.iconSearchPlaceholder', 'Search icons or emojis…'),
      iconSearchEmptyLabel: t('customers.config.dictionaries.dialog.iconSearchEmpty', 'No icons match your search.'),
      iconSuggestionsLabel: t('customers.config.dictionaries.dialog.iconSuggestions', 'Suggestions'),
      iconClearLabel: t('customers.config.dictionaries.dialog.iconClear', 'Remove icon'),
      previewEmptyLabel: t('customers.config.dictionaries.appearance.empty', 'None'),
    },
  }), [dialog, t])

  return (
    <section className="rounded border bg-card text-card-foreground shadow-sm">
      <div className="border-b px-6 py-4 space-y-1">
        <h2 className="text-lg font-medium">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="px-2 py-4 sm:px-4">
        <DictionaryTable
          entries={entries}
          loading={loading}
          canManage
          onCreate={handleCreate}
          onEdit={handleEdit}
          onDelete={handleDelete}
          onRefresh={loadEntries}
          translations={tableTranslations}
        />
      </div>
      <Dialog open={dialog !== null} onOpenChange={(open) => { if (!open) closeDialog() }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{formTranslations.title}</DialogTitle>
          </DialogHeader>
          <DictionaryForm
            mode={dialog?.mode === 'edit' ? 'edit' : 'create'}
            initialValues={currentValues}
            onSubmit={submitForm}
            onCancel={closeDialog}
            submitting={submitting}
            translations={formTranslations}
            iconSuggestions={ICON_SUGGESTIONS}
          />
        </DialogContent>
      </Dialog>
    </section>
  )
}
