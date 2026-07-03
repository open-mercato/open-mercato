"use client"

import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { apiCall, readApiResultOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { raiseCrudError } from '@open-mercato/ui/backend/utils/serverErrors'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { ICON_SUGGESTIONS } from '@open-mercato/core/modules/dictionaries/components/dictionaryAppearance'
import {
  DictionaryForm,
  type DictionaryFormValues,
} from '@open-mercato/core/modules/dictionaries/components/DictionaryForm'
import {
  DictionaryTable,
  type DictionaryTableEntry,
} from '@open-mercato/core/modules/dictionaries/components/DictionaryTable'

type WarrantyDictionaryKind =
  | 'warranty-claim-fault-code'
  | 'warranty-claim-reason'
  | 'warranty-claim-rejection-reason'

type SectionDefinition = {
  kind: WarrantyDictionaryKind
  dictionaryKey: string
  titleKey: string
  descriptionKey: string
}

type DialogState =
  | { mode: 'create'; kind: WarrantyDictionaryKind }
  | { mode: 'edit'; kind: WarrantyDictionaryKind; entry: DictionaryTableEntry }

type DictionaryListItem = {
  id?: string
  key?: string
}

const DEFAULT_FORM_VALUES: DictionaryFormValues = {
  value: '',
  label: '',
  color: null,
  icon: null,
}

const SAVE_CONTEXT_ID = 'warranty-claims-settings'

const SECTIONS: SectionDefinition[] = [
  {
    kind: 'warranty-claim-fault-code',
    dictionaryKey: 'warranty_claims.warranty_claim_fault_code',
    titleKey: 'warranty_claims.settings.dictionary.faultCodes',
    descriptionKey: 'warranty_claims.settings.dictionary.faultCodes.description',
  },
  {
    kind: 'warranty-claim-reason',
    dictionaryKey: 'warranty_claims.warranty_claim_reason',
    titleKey: 'warranty_claims.settings.dictionary.claimReasons',
    descriptionKey: 'warranty_claims.settings.dictionary.claimReasons.description',
  },
  {
    kind: 'warranty-claim-rejection-reason',
    dictionaryKey: 'warranty_claims.warranty_claim_rejection_reason',
    titleKey: 'warranty_claims.settings.dictionary.rejectionReasons',
    descriptionKey: 'warranty_claims.settings.dictionary.rejectionReasons.description',
  },
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length ? value.trim() : null
}

function normalizeEntry(item: unknown): DictionaryTableEntry | null {
  if (!isRecord(item)) return null
  const id = toStringOrNull(item.id)
  const value = toStringOrNull(item.value)
  if (!id || !value) return null
  return {
    id,
    value,
    label: toStringOrNull(item.label) ?? value,
    color: toStringOrNull(item.color),
    icon: toStringOrNull(item.icon),
    organizationId: toStringOrNull(item.organizationId),
    tenantId: toStringOrNull(item.tenantId),
    isInherited: item.isInherited === true,
    createdAt: toStringOrNull(item.createdAt),
    updatedAt: toStringOrNull(item.updatedAt),
  }
}

function buildConflictError(call: { status: number; result: unknown }, fallbackMessage: string): Error & Record<string, unknown> {
  const payload = isRecord(call.result) ? call.result : {}
  const message = typeof payload.error === 'string' ? payload.error : fallbackMessage
  return Object.assign(new Error(message), { status: call.status }, payload)
}

export default function WarrantyClaimSettingsPage() {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const [entriesByKind, setEntriesByKind] = React.useState<Record<WarrantyDictionaryKind, DictionaryTableEntry[]>>({
    'warranty-claim-fault-code': [],
    'warranty-claim-reason': [],
    'warranty-claim-rejection-reason': [],
  })
  const [dictionaryIds, setDictionaryIds] = React.useState<Record<WarrantyDictionaryKind, string | null>>({
    'warranty-claim-fault-code': null,
    'warranty-claim-reason': null,
    'warranty-claim-rejection-reason': null,
  })
  const [loadingKind, setLoadingKind] = React.useState<Record<WarrantyDictionaryKind, boolean>>({
    'warranty-claim-fault-code': false,
    'warranty-claim-reason': false,
    'warranty-claim-rejection-reason': false,
  })
  const [dialog, setDialog] = React.useState<DialogState | null>(null)
  const [submitting, setSubmitting] = React.useState(false)

  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: SAVE_CONTEXT_ID,
    blockedMessage: t('warranty_claims.common.saveBlocked'),
  })
  const mutationContext = React.useMemo(() => ({
    formId: SAVE_CONTEXT_ID,
    resourceKind: 'warranty_claims.dictionaries',
    retryLastMutation,
  }), [retryLastMutation])

  const loadEntries = React.useCallback(async (section: SectionDefinition) => {
    setLoadingKind((prev) => ({ ...prev, [section.kind]: true }))
    try {
      const dictionaries = await readApiResultOrThrow<{ items?: DictionaryListItem[] }>(
        '/api/dictionaries',
        undefined,
        {
          fallback: { items: [] },
          errorMessage: t('warranty_claims.settings.error.load'),
        },
      )
      const dictionary = (dictionaries.items ?? []).find((item) => item.key === section.dictionaryKey)
      const dictionaryId = dictionary?.id ?? null
      setDictionaryIds((prev) => ({ ...prev, [section.kind]: dictionaryId }))
      if (!dictionaryId) {
        setEntriesByKind((prev) => ({ ...prev, [section.kind]: [] }))
        return
      }
      const entries = await readApiResultOrThrow<{ items?: unknown[] }>(
        `/api/dictionaries/${encodeURIComponent(dictionaryId)}/entries`,
        undefined,
        {
          fallback: { items: [] },
          errorMessage: t('warranty_claims.settings.error.load'),
        },
      )
      setEntriesByKind((prev) => ({
        ...prev,
        [section.kind]: (entries.items ?? [])
          .map(normalizeEntry)
          .filter((entry): entry is DictionaryTableEntry => entry !== null),
      }))
    } catch (err) {
      const message = err instanceof Error ? err.message : t('warranty_claims.settings.error.load')
      flash(message, 'error')
    } finally {
      setLoadingKind((prev) => ({ ...prev, [section.kind]: false }))
    }
  }, [t])

  React.useEffect(() => {
    for (const section of SECTIONS) {
      void loadEntries(section)
    }
  }, [loadEntries, scopeVersion])

  const tableTranslations = React.useMemo(() => ({
    valueColumn: t('warranty_claims.settings.table.value'),
    labelColumn: t('warranty_claims.settings.table.label'),
    appearanceColumn: t('warranty_claims.settings.table.appearance'),
    addLabel: t('warranty_claims.settings.actions.add'),
    editLabel: t('warranty_claims.settings.actions.edit'),
    deleteLabel: t('warranty_claims.settings.actions.delete'),
    refreshLabel: t('warranty_claims.settings.actions.refresh'),
    inheritedLabel: t('warranty_claims.settings.table.inherited'),
    inheritedTooltip: t('warranty_claims.settings.table.inheritedTooltip'),
    emptyLabel: t('warranty_claims.settings.table.empty'),
    searchPlaceholder: t('warranty_claims.settings.table.search'),
  }), [t])

  const formTranslations = React.useMemo(() => ({
    createTitle: t('warranty_claims.settings.dialog.createTitle'),
    editTitle: t('warranty_claims.settings.dialog.editTitle'),
    valueLabel: t('warranty_claims.settings.dialog.valueLabel'),
    labelLabel: t('warranty_claims.settings.dialog.labelLabel'),
    saveLabel: t('warranty_claims.settings.dialog.save'),
    cancelLabel: t('warranty_claims.settings.dialog.cancel'),
    appearance: {
      colorLabel: t('warranty_claims.settings.dialog.colorLabel'),
      colorHelp: t('warranty_claims.settings.dialog.colorHelp'),
      colorClearLabel: t('warranty_claims.settings.dialog.colorClear'),
      iconLabel: t('warranty_claims.settings.dialog.iconLabel'),
      iconPlaceholder: t('warranty_claims.settings.dialog.iconPlaceholder'),
      iconPickerTriggerLabel: t('warranty_claims.settings.dialog.iconBrowse'),
      iconSearchPlaceholder: t('warranty_claims.settings.dialog.iconSearchPlaceholder'),
      iconSearchEmptyLabel: t('warranty_claims.settings.dialog.iconSearchEmpty'),
      iconSuggestionsLabel: t('warranty_claims.settings.dialog.iconSuggestions'),
      iconClearLabel: t('warranty_claims.settings.dialog.iconClear'),
      previewEmptyLabel: t('warranty_claims.settings.dialog.previewEmpty'),
    },
  }), [t])

  const closeDialog = React.useCallback(() => {
    setDialog(null)
  }, [])

  const startCreate = React.useCallback((kind: WarrantyDictionaryKind) => {
    setDialog({ mode: 'create', kind })
  }, [])

  const startEdit = React.useCallback((kind: WarrantyDictionaryKind, entry: DictionaryTableEntry) => {
    setDialog({ mode: 'edit', kind, entry })
  }, [])

  const sectionByKind = React.useCallback((kind: WarrantyDictionaryKind) => {
    return SECTIONS.find((section) => section.kind === kind) ?? null
  }, [])

  const deleteEntry = React.useCallback(async (kind: WarrantyDictionaryKind, entry: DictionaryTableEntry) => {
    const section = sectionByKind(kind)
    const dictionaryId = dictionaryIds[kind]
    if (!section || !dictionaryId) return
    const confirmed = await confirm({
      title: t('warranty_claims.settings.confirm.delete', undefined, { value: entry.label || entry.value }),
      variant: 'destructive',
    })
    if (!confirmed) return
    try {
      await runMutation({
        operation: async () => {
          const call = await withScopedApiRequestHeaders(
            buildOptimisticLockHeader(entry.updatedAt),
            () => apiCall(`/api/dictionaries/${encodeURIComponent(dictionaryId)}/entries/${encodeURIComponent(entry.id)}`, {
              method: 'DELETE',
            }),
          )
          if (!call.ok) {
            const errorObject = buildConflictError(call, t('warranty_claims.settings.error.save'))
            if (surfaceRecordConflict(errorObject, t, { onRefresh: () => { void loadEntries(section) } })) return call
            await raiseCrudError(call.response, t('warranty_claims.settings.error.delete'))
          }
          return call
        },
        context: mutationContext,
        mutationPayload: { action: 'delete', kind, id: entry.id },
      })
      flash(t('warranty_claims.settings.success.delete'), 'success')
      await loadEntries(section)
    } catch (err) {
      if (surfaceRecordConflict(err, t, { onRefresh: () => { void loadEntries(section) } })) return
      const message = err instanceof Error ? err.message : t('warranty_claims.settings.error.delete')
      flash(message, 'error')
    }
  }, [confirm, dictionaryIds, loadEntries, mutationContext, runMutation, sectionByKind, t])

  const submitForm = React.useCallback(async (values: DictionaryFormValues) => {
    if (!dialog) return
    const section = sectionByKind(dialog.kind)
    const dictionaryId = dictionaryIds[dialog.kind]
    if (!section || !dictionaryId) return
    setSubmitting(true)
    try {
      if (dialog.mode === 'create') {
        await runMutation({
          operation: async () => {
            const call = await apiCall(`/api/dictionaries/${encodeURIComponent(dictionaryId)}/entries`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(values),
            })
            if (!call.ok) await raiseCrudError(call.response, t('warranty_claims.settings.error.save'))
            return call
          },
          context: mutationContext,
          mutationPayload: { action: 'create', kind: dialog.kind, ...values },
        })
      } else {
        const entry = dialog.entry
        const payload: Record<string, unknown> = {}
        if (values.value !== entry.value) payload.value = values.value
        if (values.label !== entry.label) payload.label = values.label
        if ((values.color ?? null) !== (entry.color ?? null)) payload.color = values.color ?? null
        if ((values.icon ?? null) !== (entry.icon ?? null)) payload.icon = values.icon ?? null
        await runMutation({
          operation: async () => {
            const call = await withScopedApiRequestHeaders(
              buildOptimisticLockHeader(entry.updatedAt),
              () => apiCall(`/api/dictionaries/${encodeURIComponent(dictionaryId)}/entries/${encodeURIComponent(entry.id)}`, {
                method: 'PATCH',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(payload),
              }),
            )
            if (!call.ok) {
              const errorObject = buildConflictError(call, t('warranty_claims.settings.error.save'))
              if (surfaceRecordConflict(errorObject, t, { onRefresh: () => { void loadEntries(section) } })) return call
              await raiseCrudError(call.response, t('warranty_claims.settings.error.save'))
            }
            return call
          },
          context: mutationContext,
          mutationPayload: { action: 'update', kind: dialog.kind, id: entry.id, ...payload },
        })
      }
      flash(t('warranty_claims.settings.success.save'), 'success')
      closeDialog()
      await loadEntries(section)
    } catch (err) {
      if (surfaceRecordConflict(err, t, { onRefresh: () => { void loadEntries(section) } })) return
      const message = err instanceof Error ? err.message : t('warranty_claims.settings.error.save')
      flash(message, 'error')
      throw err instanceof Error ? err : new Error(message)
    } finally {
      setSubmitting(false)
    }
  }, [closeDialog, dialog, dictionaryIds, loadEntries, mutationContext, runMutation, sectionByKind, t])

  const currentValues = React.useMemo<DictionaryFormValues>(() => {
    if (dialog?.mode === 'edit') {
      return {
        value: dialog.entry.value,
        label: dialog.entry.label,
        color: dialog.entry.color,
        icon: dialog.entry.icon,
      }
    }
    return DEFAULT_FORM_VALUES
  }, [dialog])

  return (
    <Page>
      <PageBody>
        <div className="space-y-6">
          {SECTIONS.map((section) => (
            <section key={section.kind} className="rounded-lg border border-border bg-card text-card-foreground shadow-sm">
              <div className="space-y-1 border-b border-border px-6 py-4">
                <h2 className="text-lg font-medium">{t(section.titleKey)}</h2>
                <p className="text-sm text-muted-foreground">{t(section.descriptionKey)}</p>
              </div>
              <div className="px-2 py-4 sm:px-4">
                <DictionaryTable
                  entries={entriesByKind[section.kind] ?? []}
                  loading={loadingKind[section.kind] ?? false}
                  canManage
                  onCreate={() => startCreate(section.kind)}
                  onEdit={(entry) => startEdit(section.kind, entry)}
                  onDelete={(entry) => { void deleteEntry(section.kind, entry) }}
                  onRefresh={() => { void loadEntries(section) }}
                  translations={{ ...tableTranslations, title: t(section.titleKey) }}
                />
              </div>
            </section>
          ))}
        </div>
      </PageBody>

      <Dialog open={dialog !== null} onOpenChange={(open) => { if (!open) closeDialog() }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {dialog?.mode === 'edit' ? formTranslations.editTitle : formTranslations.createTitle}
            </DialogTitle>
          </DialogHeader>
          <DictionaryForm
            mode={dialog?.mode === 'edit' ? 'edit' : 'create'}
            initialValues={currentValues}
            onSubmit={submitForm}
            onCancel={closeDialog}
            submitting={submitting}
            translations={{
              title: dialog?.mode === 'edit' ? formTranslations.editTitle : formTranslations.createTitle,
              valueLabel: formTranslations.valueLabel,
              labelLabel: formTranslations.labelLabel,
              saveLabel: formTranslations.saveLabel,
              cancelLabel: formTranslations.cancelLabel,
              appearance: formTranslations.appearance,
            }}
            iconSuggestions={ICON_SUGGESTIONS}
          />
        </DialogContent>
      </Dialog>
      {ConfirmDialogElement}
    </Page>
  )
}
