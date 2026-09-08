"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import type { DocumentEntityType } from '../../../lib/entityRegistry'
import { DOCUMENTS_ENTITY_IDS } from '../../../lib/constants'
import {
  normalizeActiveTemplates,
  normalizePreview,
  selectionForPreset,
  type TemplatePreviewResult,
  type TemplateRow,
  type TemplateSlotSelection,
} from './templateUi'

const TEMPLATE_LIST_PAGE_SIZE = 50
const TEMPLATE_SEARCH_DELAY_MS = 200

async function loadTemplateSummaries(search: string, signal: AbortSignal): Promise<TemplateRow[]> {
  const params = new URLSearchParams({
    page: '1',
    pageSize: String(TEMPLATE_LIST_PAGE_SIZE),
    isActive: 'true',
    includeBody: 'false',
  })
  if (search) params.set('search', search)
  const call = await apiCall<unknown>(
    `/api/documents/templates?${params.toString()}`,
    { signal },
    { fallback: { items: [] } },
  )
  if (!call.ok) throw new Error('[internal] failed to load document templates')
  return normalizeActiveTemplates(call.result).slice(0, TEMPLATE_LIST_PAGE_SIZE)
}

export type PresetTemplateContext = {
  entityType: DocumentEntityType
  entityId: string
  label: string
  values?: Record<string, string | number | null | undefined>
}
type UseTemplateInstantiationInput = {
  open: boolean
  folderId?: string | null
  presetContext?: PresetTemplateContext
  onOpenChange: (open: boolean) => void
}

export function useTemplateInstantiation({ open, folderId, presetContext, onOpenChange }: UseTemplateInstantiationInput) {
  const t = useT()
  const locale = useLocale()
  const router = useRouter()
  const [templates, setTemplates] = React.useState<TemplateRow[]>([])
  const [templatesQuery, setTemplatesQuery] = React.useState<string | null>(null)
  const [templateSearch, setTemplateSearch] = React.useState('')
  const [selectedTemplateId, setSelectedTemplateId] = React.useState<string | null>(null)
  const [title, setTitle] = React.useState('')
  const [selections, setSelections] = React.useState<Record<string, TemplateSlotSelection | undefined>>({})
  const [effectiveDate, setEffectiveDate] = React.useState('')
  const [isLoading, setIsLoading] = React.useState(false)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [preview, setPreview] = React.useState<TemplatePreviewResult | null>(null)
  const [isPreviewLoading, setIsPreviewLoading] = React.useState(false)
  const [previewError, setPreviewError] = React.useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const submitInFlightRef = React.useRef(false)
  const [templateLoadAttempt, setTemplateLoadAttempt] = React.useState(0)
  const [previewLoadAttempt, setPreviewLoadAttempt] = React.useState(0)
  const normalizedTemplateSearch = templateSearch.trim()
  // Bind every rendered/selectable row to the exact query that produced it.
  // A query change hides the prior result synchronously during render, before
  // the debounced request starts or an abort can settle.
  const currentTemplates = templatesQuery === normalizedTemplateSearch ? templates : []
  const selectedTemplate = currentTemplates.find((template) => template.id === selectedTemplateId) ?? null
  const mutationContextId = 'documents-new-from-template:mutation'
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId: string
    retryLastMutation: () => Promise<boolean>
  }>({ contextId: mutationContextId, blockedMessage: t('ui.forms.flash.saveBlocked') })
  const changeTemplateSearch = React.useCallback((value: string) => {
    setIsLoading(true)
    setLoadError(null)
    setTemplateSearch(value)
  }, [])

  React.useEffect(() => {
    if (!open) return
    setTemplates([])
    setTemplatesQuery(null)
    setTemplateSearch('')
    setSelectedTemplateId(null)
    setSelections({})
    setPreview(null)
    setPreviewError(null)
    setEffectiveDate(new Date().toISOString())
    setLoadError(null)
  }, [open])

  React.useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    const search = normalizedTemplateSearch
    setIsLoading(true)
    setLoadError(null)
    const timer = window.setTimeout(() => {
      void loadTemplateSummaries(search, controller.signal)
      .then((nextTemplates) => {
        if (controller.signal.aborted) return
        setTemplates(nextTemplates)
        setTemplatesQuery(search)
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setTemplates([])
          setLoadError(t('documents.templates.instantiate.error.load'))
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false)
      })
    }, search ? TEMPLATE_SEARCH_DELAY_MS : 0)
    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [normalizedTemplateSearch, open, t, templateLoadAttempt])

  React.useEffect(() => {
    if (!selectedTemplate) { setTitle(''); setSelections({}); setPreview(null); return }
    setTitle(`${selectedTemplate.name} ${new Date().toLocaleDateString(locale)}`)
    const presetSelection = presetContext ? selectionForPreset({
      ...presetContext,
      fallbackLabel: t('documents.relatedDocuments.recordFallback'),
    }) : null
    const presetSlot = presetSelection
      ? selectedTemplate.contextSlots.find((slot) => slot.entityType === presetSelection.entityType)
      : null
    setSelections(presetSlot && presetSelection ? { [presetSlot.slot]: presetSelection } : {})
  }, [locale, presetContext, selectedTemplate, t])

  const slotsPayload = React.useMemo(() => selectedTemplate?.contextSlots.flatMap((slot) => {
    const selection = selections[slot.slot]
    return selection ? [{ slot: slot.slot, ...selection }] : []
  }) ?? [], [selectedTemplate, selections])
  const missingRequired = selectedTemplate?.contextSlots.some((slot) => slot.required && !selections[slot.slot]) ?? true

  React.useEffect(() => {
    // A preview digest is valid only for the exact title, slots, locale, date,
    // and template revision that produced it. Invalidate it synchronously when
    // any of those inputs change so submit cannot race the debounced re-preview
    // with a stale digest.
    setPreview(null)
    setPreviewError(null)
    if (!selectedTemplate || !title.trim() || missingRequired || !effectiveDate) {
      setIsPreviewLoading(false)
      return
    }
    let active = true
    setIsPreviewLoading(true)
    const timer = window.setTimeout(() => {
      void apiCall<unknown>(
        `/api/documents/templates/${encodeURIComponent(selectedTemplate.id)}/preview`,
        {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: title.trim(), slots: slotsPayload, locale, effectiveDate, templateUpdatedAt: selectedTemplate.updatedAt }),
        },
      ).then((call) => {
        if (!active) return
        const next = call.ok ? normalizePreview(call.result) : null
        setPreview(next)
        if (!next) setPreviewError(t('documents.templates.preview.error'))
      }).catch(() => { if (active) setPreviewError(t('documents.templates.preview.error')) })
        .finally(() => { if (active) setIsPreviewLoading(false) })
    }, 250)
    return () => { active = false; window.clearTimeout(timer) }
  }, [effectiveDate, locale, missingRequired, previewLoadAttempt, selectedTemplate, slotsPayload, t, title])

  const retryTemplates = React.useCallback(() => {
    setIsLoading(true)
    setLoadError(null)
    setTemplateLoadAttempt((current) => current + 1)
  }, [])

  const retryPreview = React.useCallback(() => {
    setIsPreviewLoading(true)
    setPreviewError(null)
    setPreviewLoadAttempt((current) => current + 1)
  }, [])

  const rankedTemplates = React.useMemo(() => {
    const query = templateSearch.trim().toLocaleLowerCase()
    return currentTemplates.filter((template) => !query || `${template.name} ${template.description ?? ''}`.toLocaleLowerCase().includes(query))
      .toSorted((first, second) => {
        const firstCompatible = presetContext ? first.contextSlots.some((slot) => slot.entityType === presetContext.entityType) : false
        const secondCompatible = presetContext ? second.contextSlots.some((slot) => slot.entityType === presetContext.entityType) : false
        return Number(secondCompatible) - Number(firstCompatible) || first.name.localeCompare(second.name)
      })
  }, [currentTemplates, presetContext, templateSearch])

  const submit = React.useCallback(async () => {
    if (
      submitInFlightRef.current
      || !selectedTemplate
      || !preview
      || missingRequired
      || preview.unresolvedTokens.length > 0
    ) return
    submitInFlightRef.current = true
    setIsSubmitting(true)
    try {
      const call = await runMutation({
        operation: () => apiCallOrThrow<{ id: string }>(
          '/api/documents/instantiate',
          {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              templateId: selectedTemplate.id,
              templateUpdatedAt: selectedTemplate.updatedAt,
              title: title.trim(), folderId: folderId ?? null, locale, effectiveDate,
              previewDigest: preview.previewDigest, slots: slotsPayload,
            }),
          },
          { errorMessage: t('documents.templates.instantiate.error.create') },
        ),
        context: { formId: mutationContextId, resourceKind: DOCUMENTS_ENTITY_IDS.document, resourceId: folderId ?? 'new', retryLastMutation },
        mutationPayload: { templateId: selectedTemplate.id, title: title.trim() },
      })
      if (!call.result?.id) throw new Error(t('documents.list.error.missingCreatedId'))
      flash(t('documents.templates.instantiate.success'), 'success')
      onOpenChange(false)
      router.push(`/backend/documents/${call.result.id}`)
    } catch (error) {
      flash(error instanceof Error ? error.message : t('documents.templates.instantiate.error.create'), 'error')
    } finally {
      submitInFlightRef.current = false
      setIsSubmitting(false)
    }
  }, [effectiveDate, folderId, locale, missingRequired, mutationContextId, onOpenChange, preview, retryLastMutation, router, runMutation, selectedTemplate, slotsPayload, t, title])

  return {
    templates: rankedTemplates, templateSearch, setTemplateSearch: changeTemplateSearch, selectedTemplate, selectedTemplateId,
    setSelectedTemplateId, title, setTitle, selections, setSelections, isLoading, loadError,
    preview, isPreviewLoading, previewError, isSubmitting, missingRequired, submit,
    retryTemplates, retryPreview,
  }
}
