"use client"

import * as React from 'react'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  DEFAULT_DICTIONARY_ENTRY_SORT_MODE,
  dictionaryEntrySortModes,
  type DictionaryEntrySortMode,
} from '@open-mercato/core/modules/dictionaries/lib/entrySort'
import type { CustomerDictionaryKind } from '../lib/dictionaries'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('customers')

const SAVE_CONTEXT_ID = 'customers-dictionary-sort-modes'

type SortModeMap = Partial<Record<CustomerDictionaryKind, DictionaryEntrySortMode>>

type DictionarySortSection = {
  kind: CustomerDictionaryKind
  title: string
  description: string
}

function isDictionaryEntrySortMode(value: string): value is DictionaryEntrySortMode {
  return dictionaryEntrySortModes.includes(value as DictionaryEntrySortMode)
}

export function DictionarySortSettings() {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const [sortModes, setSortModes] = React.useState<SortModeMap>({})
  const [loading, setLoading] = React.useState(true)
  const [savingKind, setSavingKind] = React.useState<CustomerDictionaryKind | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const sections = React.useMemo<DictionarySortSection[]>(() => [
    {
      kind: 'statuses',
      title: t('customers.config.dictionaries.sections.statuses.title', 'Statuses'),
      description: t('customers.config.dictionaries.sections.statuses.description', 'Define the statuses available for customer records.'),
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
      kind: 'person-company-roles',
      title: t('customers.config.dictionaries.sections.personCompanyRoles.title', 'Role types'),
      description: t('customers.config.dictionaries.sections.personCompanyRoles.description', 'Manage the ownership roles available in People tab assignments.'),
    },
    {
      kind: 'job-titles',
      title: t('customers.config.dictionaries.sections.jobTitles.title', 'Job titles'),
      description: t('customers.config.dictionaries.sections.jobTitles.description', 'Configure job titles with their appearance.'),
    },
    {
      kind: 'industries',
      title: t('customers.config.dictionaries.sections.industries.title', 'Industries'),
      description: t('customers.config.dictionaries.sections.industries.description', 'Manage the industries used by companies.'),
    },
    {
      kind: 'activity-types',
      title: t('customers.config.dictionaries.sections.activityTypes.title', 'Activity types'),
      description: t('customers.config.dictionaries.sections.activityTypes.description', 'Define the activity types used for customer interactions.'),
    },
    {
      kind: 'interaction-statuses',
      title: t('customers.config.dictionaries.sections.interactionStatuses.title', 'Interaction statuses'),
      description: t('customers.config.dictionaries.sections.interactionStatuses.description', 'Manage the statuses available for tasks and logged interactions.'),
    },
    {
      kind: 'address-types',
      title: t('customers.config.dictionaries.sections.addressTypes.title', 'Address types'),
      description: t('customers.config.dictionaries.sections.addressTypes.description', 'Define the available address types.'),
    },
  ], [t])

  const sortOptions = React.useMemo(
    () => dictionaryEntrySortModes.map((mode) => ({
      value: mode,
      label:
        mode === 'label_asc'
          ? t('dictionaries.config.sortModes.labelAsc', 'A to Z')
          : mode === 'label_desc'
            ? t('dictionaries.config.sortModes.labelDesc', 'Z to A')
            : mode === 'value_asc'
              ? t('dictionaries.config.sortModes.valueAsc', 'Value A to Z')
              : mode === 'value_desc'
                ? t('dictionaries.config.sortModes.valueDesc', 'Value Z to A')
                : mode === 'created_at_asc'
                  ? t('dictionaries.config.sortModes.createdAtAsc', 'Oldest first')
                  : t('dictionaries.config.sortModes.createdAtDesc', 'Newest first'),
    })),
    [t],
  )

  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: SAVE_CONTEXT_ID,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const data = await readApiResultOrThrow<{ dictionarySortModes?: Record<string, string> }>(
          '/api/customers/settings/dictionary-sort-modes',
          undefined,
          { errorMessage: t('customers.config.dictionarySorting.errorLoad', 'Failed to load dictionary sorting settings.') },
        )
        const next: SortModeMap = {}
        for (const section of sections) {
          const value = data?.dictionarySortModes?.[section.kind]
          next[section.kind] = value && isDictionaryEntrySortMode(value)
            ? value
            : DEFAULT_DICTIONARY_ENTRY_SORT_MODE
        }
        if (!cancelled) setSortModes(next)
      } catch (err) {
        logger.error('customers.dictionarySorting.load failed', { err })
        if (!cancelled) {
          const message = err instanceof Error && err.message
            ? err.message
            : t('customers.config.dictionarySorting.errorLoad', 'Failed to load dictionary sorting settings.')
          setError(message)
          flash(message, 'error')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load().catch(() => {})
    return () => {
      cancelled = true
    }
  }, [scopeVersion, sections, t])

  const handleChange = React.useCallback(async (kind: CustomerDictionaryKind, mode: DictionaryEntrySortMode) => {
    const previous = sortModes
    const next = { ...sortModes, [kind]: mode }
    setSortModes(next)
    setSavingKind(kind)
    setError(null)
    try {
      await runMutation({
        // optimistic-lock-exempt: tenant-scoped settings blob (dictionary sort
        // modes), not a versioned per-record entity — there is no `updatedAt`
        // round-trip to lock against, and concurrent writes converge on the
        // last-selected preference. Mirrors other singleton settings PATCHes.
        operation: async () => {
          await apiCallOrThrow(
            '/api/customers/settings/dictionary-sort-modes',
            {
              method: 'PATCH',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ dictionarySortModes: next }),
            },
            { errorMessage: t('customers.config.dictionarySorting.errorSave', 'Failed to save dictionary sorting settings.') },
          )
        },
        context: {
          formId: SAVE_CONTEXT_ID,
          resourceKind: 'customers.settings',
          retryLastMutation,
        },
      })
      flash(t('customers.config.dictionarySorting.success', 'Dictionary sorting settings saved.'), 'success')
    } catch (err) {
      setSortModes(previous)
      const message = err instanceof Error && err.message
        ? err.message
        : t('customers.config.dictionarySorting.errorSave', 'Failed to save dictionary sorting settings.')
      setError(message)
      flash(message, 'error')
    } finally {
      setSavingKind(null)
    }
  }, [retryLastMutation, runMutation, sortModes, t])

  return (
    <section className="space-y-4 rounded-lg border bg-background p-4">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold">
          {t('customers.config.dictionarySorting.title', 'Dictionary sorting')}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t('customers.config.dictionarySorting.description', 'Choose how customer dictionary values are ordered in dropdowns and settings.')}
        </p>
      </header>
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="h-4 w-4" />
          {t('customers.config.dictionarySorting.loading', 'Loading dictionary sorting settings…')}
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {sections.map((section) => {
            const value = sortModes[section.kind] ?? DEFAULT_DICTIONARY_ENTRY_SORT_MODE
            const saving = savingKind === section.kind
            return (
              <div key={section.kind} className="rounded border p-3">
                <div className="mb-3 space-y-1">
                  <div className="text-sm font-medium">{section.title}</div>
                  <div className="text-xs text-muted-foreground">{section.description}</div>
                </div>
                <Select
                  value={value}
                  onValueChange={(next) => {
                    if (!isDictionaryEntrySortMode(next) || next === value) return
                    handleChange(section.kind, next).catch(() => {})
                  }}
                  disabled={savingKind !== null}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {sortOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {saving ? (
                  <div className="mt-2 inline-flex items-center gap-2 text-xs text-muted-foreground">
                    <Spinner className="h-3 w-3" />
                    {t('customers.config.dictionarySorting.updating', 'Saving…')}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      )}
      {error ? <p className="text-sm text-status-error-text">{error}</p> : null}
    </section>
  )
}

export default DictionarySortSettings
