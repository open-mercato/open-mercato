"use client"

import * as React from 'react'
import Link from 'next/link'
import { Pencil, Plus, Save, Trash2 } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { apiCall, readApiResultOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrud, deleteCrud, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { raiseCrudError } from '@open-mercato/ui/backend/utils/serverErrors'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { ComboboxInput, type ComboboxOption } from '@open-mercato/ui/backend/inputs/ComboboxInput'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { hasFeature } from '@open-mercato/shared/security/features'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@open-mercato/ui/primitives/table'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { ICON_SUGGESTIONS } from '@open-mercato/core/modules/dictionaries/components/dictionaryAppearance'
import {
  DictionaryForm,
  type DictionaryFormValues,
} from '@open-mercato/core/modules/dictionaries/components/DictionaryForm'
import {
  DictionaryTable,
  type DictionaryTableEntry,
} from '@open-mercato/core/modules/dictionaries/components/DictionaryTable'
import type { TimeTrackingSettings } from '../../../lib/time-tracking/settings'
import { DEFAULT_SUPPORT_REFERENCE_PREFIX } from '../../../lib/time-tracking/settingKeys'
import type { TimeTrackingSettingsTabContext } from '../../../lib/time-tracking-ui/settingsTabs'
import {
  buildRoutingRuleEditDraft,
  rebaseRoutingRuleDialog,
  routingRuleVersion,
  type RoutingRuleDialogState,
} from '../../../lib/support/routingRuleDraft'

const CATEGORY_DICTIONARY_KEY = 'staff.support_ticket_category'
const ROUTING_API = 'staff/timesheets/support-routing-rules'
const PREVIEW_URL = '/api/staff/timesheets/support-routing-rules/preview'
const FALLBACK_PROJECT_URL = '/api/staff/timesheets/support-routing-rules/fallback-project'
const PROJECTS_URL = '/api/staff/timesheets/time-projects'
const SETTINGS_URL = '/api/staff/timesheets/settings'
const UNNOTIFIED_INBOX_URL = '/backend/staff/time-tracking/support?supportUnnotified=true'
const SAVE_CONTEXT_ID = 'staff.support.settings'
const DICTIONARIES_VIEW_FEATURE = 'dictionaries.view'
const DICTIONARIES_MANAGE_FEATURE = 'dictionaries.manage'
const PROJECT_SEARCH_PAGE_SIZE = 20
const PREFIX_PATTERN = /^[A-Z][A-Z0-9]{1,9}$/

type RuleProblem = 'paused' | 'project_unusable' | 'category_missing'

type PreviewProject = {
  id: string
  name: string | null
  code: string | null
  status: string
  usable: boolean
  nobodyNotified?: boolean
}

type PreviewRule = {
  id: string
  categoryValue: string | null
  isActive: boolean
  isFallback: boolean
  project: PreviewProject
  problem: RuleProblem | null
  updatedAt?: string | null
}

type PreviewCategory = {
  value: string
  label: string
  route: { via: 'category' | 'fallback'; project: PreviewProject } | null
}

type RoutingPreview = {
  fallback: { ruleId: string; project: PreviewProject; updatedAt?: string | null } | null
  rules: PreviewRule[]
  categories: PreviewCategory[]
  unnotifiedTicketCount?: number
}

type ProjectOption = {
  id: string
  name: string
  code: string | null
}

type RuleDialogState = RoutingRuleDialogState

type CategoryDialogState =
  | { mode: 'create' }
  | { mode: 'edit'; entry: DictionaryTableEntry }

const EMPTY_PREVIEW: RoutingPreview = { fallback: null, rules: [], categories: [] }

const DEFAULT_CATEGORY_VALUES: DictionaryFormValues = {
  value: '',
  label: '',
  color: null,
  icon: null,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
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

function normalizeProject(item: unknown): ProjectOption | null {
  if (!isRecord(item)) return null
  const id = toStringOrNull(item.id)
  if (!id) return null
  return { id, name: toStringOrNull(item.name) ?? id, code: toStringOrNull(item.code) }
}

function projectLabel(project: { name: string | null; code: string | null; id: string }): string {
  const name = project.name ?? project.id
  return project.code ? `${name} (${project.code})` : name
}

async function searchProjects(query?: string): Promise<ComboboxOption[]> {
  const params = new URLSearchParams({
    page: '1',
    pageSize: String(PROJECT_SEARCH_PAGE_SIZE),
    sortField: 'name',
    sortDir: 'asc',
  })
  const term = query?.trim() ?? ''
  if (term) params.set('q', term)
  try {
    const call = await apiCall<{ items?: unknown[] }>(`${PROJECTS_URL}?${params.toString()}`)
    if (!call.ok) return []
    return (call.result?.items ?? [])
      .map(normalizeProject)
      .filter((project): project is ProjectOption => project !== null)
      .map((project) => ({ value: project.id, label: projectLabel(project) }))
  } catch {
    return []
  }
}

type SupportProjectPickerProps = {
  labelId: string
  value: string
  knownProjects: ProjectOption[]
  placeholder: string
  disabled?: boolean
  testId: string
  onChange: (projectId: string) => void
}

function SupportProjectPicker({ labelId, value, knownProjects, placeholder, disabled, testId, onChange }: SupportProjectPickerProps) {
  const seedOptions = React.useMemo<ComboboxOption[]>(
    () => knownProjects.map((project) => ({ value: project.id, label: projectLabel(project) })),
    [knownProjects],
  )
  return (
    <div role="group" aria-labelledby={labelId} data-testid={testId}>
      <ComboboxInput
        value={value}
        onChange={(next) => {
          if (next && next !== value) onChange(next)
        }}
        seedOptions={seedOptions}
        loadSuggestions={searchProjects}
        allowCustomValues={false}
        placeholder={placeholder}
        disabled={disabled}
      />
    </div>
  )
}

export default function SupportSettingsTab({ context }: InjectionWidgetComponentProps<TimeTrackingSettingsTabContext>) {
  const t = useT()
  const locale = useLocale()
  const unnotifiedTicketsLabel = React.useCallback(
    (count: number): string => {
      let category: string
      try {
        category = new Intl.PluralRules(locale).select(count)
      } catch {
        category = count === 1 ? 'one' : 'other'
      }
      if (category === 'one') return t('staff.support.settings.routing.unnotifiedTickets.one', '{count} ticket was not notified to anyone.', { count })
      if (category === 'few') return t('staff.support.settings.routing.unnotifiedTickets.few', '{count} tickets were not notified to anyone.', { count })
      if (category === 'many') return t('staff.support.settings.routing.unnotifiedTickets.many', '{count} tickets were not notified to anyone.', { count })
      return t('staff.support.settings.routing.unnotifiedTickets.other', '{count} tickets were not notified to anyone.', { count })
    },
    [locale, t],
  )
  const scopeVersion = useOrganizationScopeVersion()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const { payload: chromePayload, isReady: chromeReady } = useBackendChrome()
  const grantedFeatures = chromePayload?.grantedFeatures
  const canManageSettings = context.canManage
  const canViewCategories = hasFeature(grantedFeatures, DICTIONARIES_VIEW_FEATURE)
  const canManageCategories = canManageSettings && hasFeature(grantedFeatures, DICTIONARIES_MANAGE_FEATURE)
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: SAVE_CONTEXT_ID,
    blockedMessage: t('staff.support.settings.errors.saveBlocked', 'Save blocked by validation'),
  })
  const routingContext = React.useMemo(() => ({
    formId: SAVE_CONTEXT_ID,
    resourceKind: 'staff.support.routing_rule',
    retryLastMutation,
  }), [retryLastMutation])
  const categoryContext = React.useMemo(() => ({
    formId: SAVE_CONTEXT_ID,
    resourceKind: 'staff.support.categories',
    retryLastMutation,
  }), [retryLastMutation])
  const settingsContext = React.useMemo(() => ({
    formId: SAVE_CONTEXT_ID,
    resourceKind: 'staff.timesheets.settings',
    retryLastMutation,
  }), [retryLastMutation])

  const [categoryEntries, setCategoryEntries] = React.useState<DictionaryTableEntry[]>([])
  const [dictionaryId, setDictionaryId] = React.useState<string | null>(null)
  const [categoriesLoading, setCategoriesLoading] = React.useState(true)
  const [categoriesError, setCategoriesError] = React.useState<string | null>(null)
  const [categoryDialog, setCategoryDialog] = React.useState<CategoryDialogState | null>(null)
  const [categorySubmitting, setCategorySubmitting] = React.useState(false)

  const [preview, setPreview] = React.useState<RoutingPreview>(EMPTY_PREVIEW)
  const [routingLoading, setRoutingLoading] = React.useState(true)
  const [routingError, setRoutingError] = React.useState<string | null>(null)
  const [ruleDialog, setRuleDialog] = React.useState<RuleDialogState | null>(null)
  const [ruleSubmitting, setRuleSubmitting] = React.useState(false)
  const [creatingFallback, setCreatingFallback] = React.useState(false)

  const { settings, onSettingsSaved } = context
  const savedPrefix = settings.support?.referencePrefix ?? DEFAULT_SUPPORT_REFERENCE_PREFIX
  const [prefix, setPrefix] = React.useState(savedPrefix)
  const [prefixError, setPrefixError] = React.useState<string | null>(null)
  const [prefixSaving, setPrefixSaving] = React.useState(false)

  const loadCategories = React.useCallback(async () => {
    if (!chromeReady) return
    if (!canViewCategories) {
      setCategoryEntries([])
      setDictionaryId(null)
      setCategoriesError(null)
      setCategoriesLoading(false)
      return
    }
    setCategoriesLoading(true)
    setCategoriesError(null)
    try {
      const dictionaries = await readApiResultOrThrow<{ items?: Array<{ id?: string; key?: string }> }>(
        '/api/dictionaries',
        undefined,
        { fallback: { items: [] }, errorMessage: t('staff.support.settings.errors.load', 'Failed to load support settings.') },
      )
      const dictionary = (dictionaries.items ?? []).find((item) => item.key === CATEGORY_DICTIONARY_KEY)
      const id = dictionary?.id ?? null
      setDictionaryId(id)
      if (!id) {
        setCategoryEntries([])
        return
      }
      const entries = await readApiResultOrThrow<{ items?: unknown[] }>(
        `/api/dictionaries/${encodeURIComponent(id)}/entries`,
        undefined,
        { fallback: { items: [] }, errorMessage: t('staff.support.settings.errors.load', 'Failed to load support settings.') },
      )
      setCategoryEntries(
        (entries.items ?? []).map(normalizeEntry).filter((entry): entry is DictionaryTableEntry => entry !== null),
      )
    } catch (err) {
      setCategoriesError(err instanceof Error ? err.message : t('staff.support.settings.errors.load', 'Failed to load support settings.'))
    } finally {
      setCategoriesLoading(false)
    }
  }, [canViewCategories, chromeReady, t])

  const loadRouting = React.useCallback(async () => {
    setRoutingLoading(true)
    setRoutingError(null)
    try {
      const errorMessage = t('staff.support.settings.errors.load', 'Failed to load support settings.')
      const previewResult =
        (await readApiResultOrThrow<RoutingPreview>(PREVIEW_URL, undefined, { fallback: EMPTY_PREVIEW, errorMessage })) ??
        EMPTY_PREVIEW
      setPreview(previewResult)
      setRuleDialog((current) => rebaseRoutingRuleDialog(current, previewResult))
    } catch (err) {
      setRoutingError(err instanceof Error ? err.message : t('staff.support.settings.errors.load', 'Failed to load support settings.'))
    } finally {
      setRoutingLoading(false)
    }
  }, [t])

  React.useEffect(() => {
    setPrefix(savedPrefix)
  }, [savedPrefix])

  React.useEffect(() => {
    void loadCategories()
  }, [loadCategories, scopeVersion])

  React.useEffect(() => {
    void loadRouting()
  }, [loadRouting, scopeVersion])

  const reloadAll = React.useCallback(async () => {
    await Promise.all([loadCategories(), loadRouting()])
  }, [loadCategories, loadRouting])

  const surfaceMutationError = React.useCallback((err: unknown, fallbackKey: string, fallback: string, onRefresh?: () => void) => {
    if (surfaceRecordConflict(err, t, onRefresh ? { onRefresh } : undefined)) return
    flash(err instanceof Error ? err.message : t(fallbackKey, fallback), 'error')
  }, [t])

  const submitCategory = React.useCallback(async (values: DictionaryFormValues) => {
    if (!categoryDialog || !dictionaryId || categorySubmitting) return
    setCategorySubmitting(true)
    try {
      if (categoryDialog.mode === 'create') {
        await runMutation({
          operation: async () => {
            const call = await apiCall(`/api/dictionaries/${encodeURIComponent(dictionaryId)}/entries`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(values),
            })
            if (!call.ok) await raiseCrudError(call.response, t('staff.support.settings.errors.save', 'Failed to save.'))
            return call
          },
          context: categoryContext,
          mutationPayload: { action: 'create', ...values },
        })
      } else {
        const entry = categoryDialog.entry
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
            if (!call.ok) await raiseCrudError(call.response, t('staff.support.settings.errors.save', 'Failed to save.'))
            return call
          },
          context: categoryContext,
          mutationPayload: { action: 'update', id: entry.id, ...payload },
        })
      }
      flash(t('staff.support.settings.categories.saved', 'Category saved.'), 'success')
      setCategoryDialog(null)
      await reloadAll()
    } catch (err) {
      surfaceMutationError(err, 'staff.support.settings.errors.save', 'Failed to save.', () => { void loadCategories() })
    } finally {
      setCategorySubmitting(false)
    }
  }, [categoryContext, categoryDialog, categorySubmitting, dictionaryId, loadCategories, reloadAll, surfaceMutationError, runMutation, t])

  const deleteCategory = React.useCallback(async (entry: DictionaryTableEntry) => {
    if (!dictionaryId) return
    const confirmed = await confirm({
      title: t('staff.support.settings.categories.confirmDelete', 'Delete category "{value}"?', { value: entry.label || entry.value }),
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
          if (!call.ok) await raiseCrudError(call.response, t('staff.support.settings.errors.delete', 'Failed to delete.'))
          return call
        },
        context: categoryContext,
        mutationPayload: { action: 'delete', id: entry.id },
      })
      flash(t('staff.support.settings.categories.deleted', 'Category deleted.'), 'success')
      await reloadAll()
    } catch (err) {
      surfaceMutationError(err, 'staff.support.settings.errors.delete', 'Failed to delete.', () => { void loadCategories() })
    }
  }, [categoryContext, confirm, dictionaryId, loadCategories, reloadAll, surfaceMutationError, runMutation, t])

  const createFallbackProject = React.useCallback(async () => {
    setCreatingFallback(true)
    try {
      await runMutation({
        operation: async () => {
          const call = await apiCall(FALLBACK_PROJECT_URL, { method: 'POST' })
          if (!call.ok) await raiseCrudError(call.response, t('staff.support.settings.errors.save', 'Failed to save.'))
          return call
        },
        context: routingContext,
        mutationPayload: { action: 'create_fallback_project' },
      })
      flash(t('staff.support.settings.routing.fallbackCreated', 'Fallback project created.'), 'success')
      await loadRouting()
    } catch (err) {
      surfaceMutationError(err, 'staff.support.settings.errors.save', 'Failed to save.')
    } finally {
      setCreatingFallback(false)
    }
  }, [loadRouting, surfaceMutationError, routingContext, runMutation, t])

  const updateRule = React.useCallback(async (
    ruleId: string,
    expectedUpdatedAt: string | null,
    patch: { timeProjectId?: string; isActive?: boolean },
  ) => {
    try {
      await runMutation({
        operation: () => updateCrud(ROUTING_API, { id: ruleId, ...patch }, {
          headers: buildOptimisticLockHeader(expectedUpdatedAt),
          errorMessage: t('staff.support.settings.errors.save', 'Failed to save.'),
        }),
        context: routingContext,
        mutationPayload: { action: 'update', id: ruleId, ...patch },
      })
      flash(t('staff.support.settings.routing.saved', 'Routing saved.'), 'success')
      await loadRouting()
      return true
    } catch (err) {
      surfaceMutationError(err, 'staff.support.settings.errors.save', 'Failed to save.', () => { void loadRouting() })
      return false
    }
  }, [loadRouting, surfaceMutationError, routingContext, runMutation, t])

  const deleteRule = React.useCallback(async (rule: PreviewRule) => {
    const confirmed = await confirm({
      title: t('staff.support.settings.routing.confirmDelete', 'Delete this rule? The category will use the fallback project.'),
      variant: 'destructive',
    })
    if (!confirmed) return
    try {
      await runMutation({
        operation: () => deleteCrud(ROUTING_API, rule.id, {
          headers: buildOptimisticLockHeader(routingRuleVersion(rule)),
          errorMessage: t('staff.support.settings.errors.delete', 'Failed to delete.'),
        }),
        context: routingContext,
        mutationPayload: { action: 'delete', id: rule.id },
      })
      flash(t('staff.support.settings.routing.deleted', 'Rule deleted.'), 'success')
      await loadRouting()
    } catch (err) {
      surfaceMutationError(err, 'staff.support.settings.errors.delete', 'Failed to delete.', () => { void loadRouting() })
    }
  }, [confirm, loadRouting, surfaceMutationError, routingContext, runMutation, t])

  const submitRuleDialog = React.useCallback(async () => {
    if (!ruleDialog || !ruleDialog.timeProjectId || ruleSubmitting) return
    if (ruleDialog.mode === 'create' && !ruleDialog.categoryValue) return
    setRuleSubmitting(true)
    try {
      if (ruleDialog.mode === 'create') {
        await runMutation({
          operation: () => createCrud(ROUTING_API, {
            categoryValue: ruleDialog.categoryValue,
            timeProjectId: ruleDialog.timeProjectId,
          }, { errorMessage: t('staff.support.settings.errors.save', 'Failed to save.') }),
          context: routingContext,
          mutationPayload: { action: 'create', categoryValue: ruleDialog.categoryValue, timeProjectId: ruleDialog.timeProjectId },
        })
        flash(t('staff.support.settings.routing.saved', 'Routing saved.'), 'success')
        setRuleDialog(null)
        await loadRouting()
      } else {
        const ok = await updateRule(ruleDialog.ruleId, ruleDialog.expectedUpdatedAt, { timeProjectId: ruleDialog.timeProjectId })
        if (ok) setRuleDialog(null)
      }
    } catch (err) {
      surfaceMutationError(err, 'staff.support.settings.errors.save', 'Failed to save.', () => { void loadRouting() })
    } finally {
      setRuleSubmitting(false)
    }
  }, [loadRouting, surfaceMutationError, routingContext, ruleDialog, ruleSubmitting, runMutation, t, updateRule])

  const savePrefix = React.useCallback(async () => {
    const value = prefix.trim().toUpperCase()
    if (!PREFIX_PATTERN.test(value)) {
      setPrefixError(t('staff.support.settings.prefix.invalid', 'Use 2–10 uppercase letters or digits, starting with a letter.'))
      return
    }
    setPrefixError(null)
    setPrefixSaving(true)
    try {
      const next: TimeTrackingSettings = { ...settings, support: { ...(settings.support ?? {}), referencePrefix: value } }
      const call = await runMutation({
        operation: async () => {
          const call = await apiCall<TimeTrackingSettings>(SETTINGS_URL, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(next),
          })
          if (!call.ok) await raiseCrudError(call.response, t('staff.support.settings.errors.save', 'Failed to save.'))
          return call
        },
        context: settingsContext,
        mutationPayload: { support: { referencePrefix: value } },
      })
      if (call.result) onSettingsSaved(call.result)
      flash(t('staff.support.settings.prefix.saved', 'Reference prefix saved.'), 'success')
    } catch (err) {
      surfaceMutationError(err, 'staff.support.settings.errors.save', 'Failed to save.')
    } finally {
      setPrefixSaving(false)
    }
  }, [onSettingsSaved, prefix, surfaceMutationError, runMutation, settings, settingsContext, t])

  const categoryLabels = React.useMemo(() => {
    const map = new Map<string, string>()
    for (const category of preview.categories) map.set(category.value, category.label)
    for (const entry of categoryEntries) if (!map.has(entry.value)) map.set(entry.value, entry.label)
    return map
  }, [categoryEntries, preview.categories])

  const overrides = React.useMemo(() => preview.rules.filter((rule) => !rule.isFallback), [preview.rules])
  const categoriesWithoutRule = React.useMemo(() => {
    const ruled = new Set(overrides.map((rule) => rule.categoryValue))
    return preview.categories.filter((category) => !ruled.has(category.value))
  }, [overrides, preview.categories])

  const fallbackName = preview.fallback ? projectLabel(preview.fallback.project) : ''

  const knownProjects = React.useMemo<ProjectOption[]>(() => {
    const byId = new Map<string, ProjectOption>()
    const remember = (project: PreviewProject) => {
      if (!byId.has(project.id)) byId.set(project.id, { id: project.id, name: project.name ?? project.id, code: project.code })
    }
    if (preview.fallback) remember(preview.fallback.project)
    for (const rule of preview.rules) remember(rule.project)
    for (const category of preview.categories) if (category.route) remember(category.route.project)
    return [...byId.values()]
  }, [preview])

  const problemText = (problem: RuleProblem): string => {
    if (problem === 'paused') return t('staff.support.settings.routing.problem.paused', 'The rule is paused.')
    if (problem === 'category_missing') return t('staff.support.settings.routing.problem.categoryMissing', 'The category no longer exists.')
    return t('staff.support.settings.routing.problem.projectUnusable', 'The project is completed, deleted, or has no default status.')
  }

  const nobodyNotifiedText = t(
    'staff.support.settings.routing.nobodyNotified',
    "No one in this project will be notified about tickets routed here: it has no active assigner, no usable default assignee and no owner. New tickets go to the organization's project managers instead.",
  )
  const unnotifiedTicketCount = typeof preview.unnotifiedTicketCount === 'number' ? preview.unnotifiedTicketCount : 0

  const tableTranslations = React.useMemo(() => ({
    title: t('staff.support.settings.categories.title', 'Categories'),
    valueColumn: t('staff.support.settings.categories.value', 'Value'),
    labelColumn: t('staff.support.settings.categories.label', 'Label'),
    appearanceColumn: t('staff.support.settings.categories.appearance', 'Appearance'),
    addLabel: t('staff.support.settings.categories.add', 'Add category'),
    editLabel: t('staff.support.settings.actions.edit', 'Edit'),
    deleteLabel: t('staff.support.settings.actions.delete', 'Delete'),
    refreshLabel: t('staff.support.settings.actions.refresh', 'Refresh'),
    inheritedLabel: t('staff.support.settings.categories.inherited', 'Inherited'),
    inheritedTooltip: t('staff.support.settings.categories.inheritedTooltip', 'Defined by a parent organization.'),
    emptyLabel: t('staff.support.settings.categories.empty', 'No categories yet.'),
    searchPlaceholder: t('staff.support.settings.categories.search', 'Search categories'),
  }), [t])

  const categoryFormValues = React.useMemo<DictionaryFormValues>(() => {
    if (categoryDialog?.mode === 'edit') {
      return {
        value: categoryDialog.entry.value,
        label: categoryDialog.entry.label,
        color: categoryDialog.entry.color,
        icon: categoryDialog.entry.icon,
      }
    }
    return DEFAULT_CATEGORY_VALUES
  }, [categoryDialog])

  const categoryDialogTitle = categoryDialog?.mode === 'edit'
    ? t('staff.support.settings.categories.editTitle', 'Edit category')
    : t('staff.support.settings.categories.createTitle', 'Add category')

  return (
    <>
      <div className="space-y-6">
        <p className="text-sm text-muted-foreground">
          {t('staff.support.settings.description', 'Configure support ticket categories, where each category is routed, and the ticket reference prefix.')}
        </p>

        <section className="rounded-xl border border-border bg-card text-card-foreground">
          <div className="space-y-1 border-b border-border px-6 py-4">
            <h2 className="text-lg font-medium">{t('staff.support.settings.categories.title', 'Categories')}</h2>
            <p className="text-sm text-muted-foreground">
              {t('staff.support.settings.categories.description', 'Categories customers pick when they file a ticket in the portal.')}
            </p>
          </div>
          <div className="px-2 py-4 sm:px-4">
            {chromeReady && !canViewCategories ? (
              <Alert status="information">
                <AlertDescription>
                  {t('staff.support.settings.categories.noAccess', 'You do not have permission to view the support categories.')}
                </AlertDescription>
              </Alert>
            ) : categoriesError ? (
              <ErrorMessage
                label={categoriesError}
                action={(
                  <Button type="button" variant="outline" onClick={() => { void loadCategories() }}>
                    {t('staff.support.settings.actions.retry', 'Try again')}
                  </Button>
                )}
              />
            ) : !categoriesLoading && !dictionaryId ? (
              <Alert status="warning">
                <AlertDescription>
                  {t('staff.support.settings.categories.missingDictionary', 'The support categories dictionary has not been seeded for this organization yet.')}
                </AlertDescription>
              </Alert>
            ) : (
              <DictionaryTable
                entries={categoryEntries}
                loading={categoriesLoading}
                canManage={canManageCategories}
                onCreate={() => setCategoryDialog({ mode: 'create' })}
                onEdit={(entry) => setCategoryDialog({ mode: 'edit', entry: categoryEntries.find((row) => row.id === entry.id) ?? entry })}
                onDelete={(entry) => { void deleteCategory(categoryEntries.find((row) => row.id === entry.id) ?? entry) }}
                onRefresh={() => { void loadCategories() }}
                translations={tableTranslations}
              />
            )}
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card text-card-foreground">
          <div className="space-y-1 border-b border-border px-6 py-4">
            <h2 className="text-lg font-medium">{t('staff.support.settings.routing.title', 'Routing')}</h2>
            <p className="text-sm text-muted-foreground">
              {t('staff.support.settings.routing.description', 'Every category without a working rule goes to the fallback project. Add a rule to send a category to its own project.')}
            </p>
          </div>
          <div className="space-y-6 px-6 py-4">
            {routingLoading ? (
              <LoadingMessage label={t('staff.support.settings.routing.loading', 'Loading routing…')} />
            ) : routingError ? (
              <ErrorMessage
                label={routingError}
                action={(
                  <Button type="button" variant="outline" onClick={() => { void loadRouting() }}>
                    {t('staff.support.settings.actions.retry', 'Try again')}
                  </Button>
                )}
              />
            ) : (
              <>
                {unnotifiedTicketCount > 0 ? (
                  <Alert status="warning" data-testid="support-unnotified-tickets">
                    <AlertDescription>
                      {unnotifiedTicketsLabel(unnotifiedTicketCount)}{' '}
                      <Link className="font-medium underline" href={UNNOTIFIED_INBOX_URL}>
                        {t('staff.support.settings.routing.unnotifiedTicketsLink', 'Open them in the Support Inbox')}
                      </Link>
                    </AlertDescription>
                  </Alert>
                ) : null}
                {!preview.fallback ? (
                  <Alert
                    status="warning"
                    footer={(
                      <Button type="button" onClick={() => { void createFallbackProject() }} disabled={creatingFallback || !canManageSettings}>
                        <Plus className="mr-2 h-4 w-4" />
                        {t('staff.support.settings.routing.createFallback', 'Create fallback project')}
                      </Button>
                    )}
                  >
                    <AlertTitle>{t('staff.support.settings.routing.noFallbackTitle', 'No fallback project')}</AlertTitle>
                    <AlertDescription>
                      {t('staff.support.settings.routing.noFallbackDescription', 'Customers cannot file tickets for categories without their own rule until a fallback project exists.')}
                    </AlertDescription>
                  </Alert>
                ) : (
                  <div className="space-y-3">
                    {!preview.fallback.project.usable ? (
                      <Alert status="error">
                        <AlertTitle>{t('staff.support.settings.routing.fallbackUnusableTitle', 'The fallback project cannot receive tickets')}</AlertTitle>
                        <AlertDescription>
                          {t('staff.support.settings.routing.fallbackUnusableDescription', 'It is completed, deleted, or has no default status. Point the fallback rule at another project.')}
                        </AlertDescription>
                      </Alert>
                    ) : null}
                    {preview.fallback.project.nobodyNotified === true ? (
                      <Alert status="warning" data-testid="support-fallback-nobody-notified">
                        <AlertDescription>{nobodyNotifiedText}</AlertDescription>
                      </Alert>
                    ) : null}
                    <div className="max-w-md space-y-2">
                      <Label id="support-fallback-project-label">
                        {t('staff.support.settings.routing.fallbackProject', 'Fallback project')}
                      </Label>
                      <SupportProjectPicker
                        labelId="support-fallback-project-label"
                        testId="support-fallback-project"
                        value={preview.fallback.project.id}
                        knownProjects={knownProjects}
                        placeholder={t('staff.support.settings.routing.searchProject', 'Search projects')}
                        disabled={!canManageSettings}
                        onChange={(projectId) => {
                          if (preview.fallback) {
                            void updateRule(preview.fallback.ruleId, routingRuleVersion(preview.fallback), { timeProjectId: projectId })
                          }
                        }}
                      />
                    </div>
                  </div>
                )}

                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-base font-medium">{t('staff.support.settings.routing.overrides', 'Category rules')}</h3>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={categoriesWithoutRule.length === 0 || !canManageSettings}
                      onClick={() => setRuleDialog({
                        mode: 'create',
                        categoryValue: categoriesWithoutRule[0]?.value ?? '',
                        timeProjectId: '',
                      })}
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      {t('staff.support.settings.routing.addRule', 'Add rule')}
                    </Button>
                  </div>
                  {overrides.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      {t('staff.support.settings.routing.noOverrides', 'No category rules. Every category goes to the fallback project.')}
                    </p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t('staff.support.settings.routing.category', 'Category')}</TableHead>
                          <TableHead>{t('staff.support.settings.routing.project', 'Project')}</TableHead>
                          <TableHead>{t('staff.support.settings.routing.active', 'Active')}</TableHead>
                          <TableHead>{t('staff.support.settings.routing.state', 'State')}</TableHead>
                          <TableHead className="w-24" />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {overrides.map((rule) => (
                          <TableRow key={rule.id}>
                            <TableCell>{categoryLabels.get(rule.categoryValue ?? '') ?? rule.categoryValue}</TableCell>
                            <TableCell>
                              <div className="space-y-1">
                                <span>{projectLabel(rule.project)}</span>
                                {rule.project.nobodyNotified === true ? (
                                  <Alert status="warning" size="xs" data-testid="support-rule-nobody-notified">
                                    <AlertDescription>{nobodyNotifiedText}</AlertDescription>
                                  </Alert>
                                ) : null}
                              </div>
                            </TableCell>
                            <TableCell>
                              <Switch
                                checked={rule.isActive}
                                disabled={!canManageSettings}
                                aria-label={t('staff.support.settings.routing.active', 'Active')}
                                onCheckedChange={(checked) => { void updateRule(rule.id, routingRuleVersion(rule), { isActive: checked }) }}
                              />
                            </TableCell>
                            <TableCell>
                              {rule.problem ? (
                                <div className="space-y-1">
                                  <StatusBadge variant="warning" dot>
                                    {t('staff.support.settings.routing.fallingBack', 'Falling back to {project}', { project: fallbackName })}
                                  </StatusBadge>
                                  <p className="text-xs text-muted-foreground">{problemText(rule.problem)}</p>
                                </div>
                              ) : (
                                <StatusBadge variant="success" dot>
                                  {t('staff.support.settings.routing.routing', 'Routing')}
                                </StatusBadge>
                              )}
                            </TableCell>
                            <TableCell>
                              <div className="flex justify-end gap-1">
                                <IconButton
                                  type="button"
                                  variant="ghost"
                                  aria-label={t('staff.support.settings.actions.edit', 'Edit')}
                                  disabled={!canManageSettings}
                                  onClick={() => setRuleDialog(buildRoutingRuleEditDraft(rule))}
                                >
                                  <Pencil className="h-4 w-4" />
                                </IconButton>
                                <IconButton
                                  type="button"
                                  variant="ghost"
                                  aria-label={t('staff.support.settings.actions.delete', 'Delete')}
                                  disabled={!canManageSettings}
                                  onClick={() => { void deleteRule(rule) }}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </IconButton>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </div>

                <div className="space-y-3">
                  <h3 className="text-base font-medium">{t('staff.support.settings.preview.title', 'Where tickets go now')}</h3>
                  {preview.categories.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      {t('staff.support.settings.preview.empty', 'No categories to route.')}
                    </p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t('staff.support.settings.routing.category', 'Category')}</TableHead>
                          <TableHead>{t('staff.support.settings.routing.project', 'Project')}</TableHead>
                          <TableHead>{t('staff.support.settings.preview.via', 'Routed by')}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {preview.categories.map((category) => (
                          <TableRow key={category.value}>
                            <TableCell>{category.label}</TableCell>
                            <TableCell>
                              {category.route ? projectLabel(category.route.project) : (
                                <StatusBadge variant="error" dot>
                                  {t('staff.support.settings.preview.unavailable', 'Not available on portal')}
                                </StatusBadge>
                              )}
                            </TableCell>
                            <TableCell>
                              {category.route
                                ? category.route.via === 'category'
                                  ? t('staff.support.settings.preview.viaCategory', 'Category rule')
                                  : t('staff.support.settings.preview.viaFallback', 'Fallback rule')
                                : '—'}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </div>
              </>
            )}
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card text-card-foreground">
          <div className="space-y-1 border-b border-border px-6 py-4">
            <h2 className="text-lg font-medium">{t('staff.support.settings.prefix.title', 'Reference prefix')}</h2>
            <p className="text-sm text-muted-foreground">
              {t('staff.support.settings.prefix.description', 'Customers see ticket references such as SUP-1042. The prefix applies to the whole tenant.')}
            </p>
          </div>
          <div className="px-6 py-4">
            <div className="flex max-w-md items-end gap-2">
              <div className="flex-1 space-y-2">
                <Label htmlFor="support-reference-prefix">{t('staff.support.settings.referencePrefix', 'Reference prefix')}</Label>
                <Input
                  id="support-reference-prefix"
                  value={prefix}
                  maxLength={10}
                  disabled={!canManageSettings}
                  onChange={(event) => setPrefix(event.target.value.toUpperCase())}
                  aria-invalid={prefixError ? true : undefined}
                />
                {prefixError ? <p className="text-sm text-status-error-text">{prefixError}</p> : null}
              </div>
              <Button type="button" onClick={() => { void savePrefix() }} disabled={prefixSaving || !canManageSettings}>
                <Save className="mr-2 h-4 w-4" />
                {t('staff.support.settings.actions.save', 'Save')}
              </Button>
            </div>
          </div>
        </section>
      </div>

      <Dialog open={categoryDialog !== null} onOpenChange={(open) => { if (!open) setCategoryDialog(null) }}>
        <DialogContent
          className="max-w-lg"
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault()
              if (categorySubmitting) return
              event.currentTarget.querySelector('form')?.requestSubmit()
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{categoryDialogTitle}</DialogTitle>
          </DialogHeader>
          <DictionaryForm
            mode={categoryDialog?.mode === 'edit' ? 'edit' : 'create'}
            initialValues={categoryFormValues}
            onSubmit={submitCategory}
            onCancel={() => setCategoryDialog(null)}
            submitting={categorySubmitting}
            translations={{
              title: categoryDialogTitle,
              valueLabel: t('staff.support.settings.categories.value', 'Value'),
              labelLabel: t('staff.support.settings.categories.label', 'Label'),
              saveLabel: t('staff.support.settings.actions.save', 'Save'),
              cancelLabel: t('staff.support.settings.actions.cancel', 'Cancel'),
              appearance: {
                colorLabel: t('staff.support.settings.categories.colorLabel', 'Color'),
                colorHelp: t('staff.support.settings.categories.colorHelp', 'Shown as the category badge color.'),
                colorClearLabel: t('staff.support.settings.categories.colorClear', 'Clear color'),
                iconLabel: t('staff.support.settings.categories.iconLabel', 'Icon'),
                iconPlaceholder: t('staff.support.settings.categories.iconPlaceholder', 'Icon name'),
                iconPickerTriggerLabel: t('staff.support.settings.categories.iconBrowse', 'Browse icons'),
                iconSearchPlaceholder: t('staff.support.settings.categories.iconSearchPlaceholder', 'Search icons'),
                iconSearchEmptyLabel: t('staff.support.settings.categories.iconSearchEmpty', 'No icons found.'),
                iconSuggestionsLabel: t('staff.support.settings.categories.iconSuggestions', 'Suggestions'),
                iconClearLabel: t('staff.support.settings.categories.iconClear', 'Clear icon'),
                previewEmptyLabel: t('staff.support.settings.categories.previewEmpty', 'No appearance'),
              },
            }}
            iconSuggestions={ICON_SUGGESTIONS}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={ruleDialog !== null} onOpenChange={(open) => { if (!open) setRuleDialog(null) }}>
        <DialogContent
          className="max-w-lg"
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault()
              if (ruleSubmitting) return
              void submitRuleDialog()
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {ruleDialog?.mode === 'edit'
                ? t('staff.support.settings.routing.editRuleTitle', 'Edit rule')
                : t('staff.support.settings.routing.addRuleTitle', 'Add rule')}
            </DialogTitle>
          </DialogHeader>
          {ruleDialog ? (
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault()
                void submitRuleDialog()
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="support-rule-category">{t('staff.support.settings.routing.category', 'Category')}</Label>
                {ruleDialog.mode === 'create' ? (
                  <Select
                    value={ruleDialog.categoryValue}
                    onValueChange={(value) => setRuleDialog({ ...ruleDialog, categoryValue: value })}
                  >
                    <SelectTrigger id="support-rule-category">
                      <SelectValue placeholder={t('staff.support.settings.routing.selectCategory', 'Select a category')} />
                    </SelectTrigger>
                    <SelectContent>
                      {categoriesWithoutRule.map((category) => (
                        <SelectItem key={category.value} value={category.value}>{category.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <p id="support-rule-category" className="text-sm">
                    {categoryLabels.get(ruleDialog.categoryValue) ?? ruleDialog.categoryValue}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label id="support-rule-project-label">{t('staff.support.settings.routing.project', 'Project')}</Label>
                <SupportProjectPicker
                  labelId="support-rule-project-label"
                  testId="support-rule-project"
                  value={ruleDialog.timeProjectId}
                  knownProjects={knownProjects}
                  placeholder={t('staff.support.settings.routing.selectProject', 'Select a project')}
                  onChange={(projectId) => setRuleDialog({ ...ruleDialog, timeProjectId: projectId })}
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setRuleDialog(null)}>
                  {t('staff.support.settings.actions.cancel', 'Cancel')}
                </Button>
                <Button
                  type="submit"
                  disabled={ruleSubmitting || !ruleDialog.timeProjectId || (ruleDialog.mode === 'create' && !ruleDialog.categoryValue)}
                >
                  {t('staff.support.settings.actions.save', 'Save')}
                </Button>
              </div>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>
      {ConfirmDialogElement}
    </>
  )
}
