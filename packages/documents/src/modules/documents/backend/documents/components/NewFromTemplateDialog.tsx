"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { LookupSelect, type LookupSelectItem } from '@open-mercato/ui/backend/inputs'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { DOCUMENTS_ENTITY_IDS } from '../../../lib/constants'
import {
  getEntityRegistryEntry,
  readItemsArray,
  type DocumentEntityType,
  type EntityRegistryEntry,
} from '../../../lib/entityRegistry'
import {
  fillTemplateTokens,
  type TemplateFillSlot,
} from '../../../lib/templateFill'
import type {
  DocumentTemplateContextSlot,
  DocumentTemplateRow,
} from './TemplateEditorDialog'

type NewFromTemplateDialogProps = {
  open: boolean
  folderId?: string | null
  onOpenChange: (open: boolean) => void
}

type TemplatesResponse = {
  items?: unknown[]
  data?: unknown[]
  templates?: unknown[]
  total?: number
}

type MutationContext = {
  formId: string
  resourceKind: string
  resourceId: string
  retryLastMutation: () => Promise<boolean>
}

type CreateDocumentResponse = {
  id?: string | null
  updatedAt?: string | null
  updated_at?: string | null
  document?: unknown
  item?: unknown
  data?: unknown
}

type SlotSelection = {
  id: string
  rawItem: Record<string, unknown>
}

const PAGE_SIZE = 20

const ENTITY_TYPE_FALLBACKS: Record<DocumentEntityType, string> = {
  'customer-person': 'Customer person',
  'customer-company': 'Customer company',
  deal: 'Deal',
  product: 'Product',
  quote: 'Quote',
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null
}

function readString(record: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'string' && value.trim().length > 0) return value
  }
  return null
}

function readBoolean(record: Record<string, unknown>, ...keys: string[]): boolean | null {
  for (const key of keys) {
    const value = record[key]
    if (typeof value === 'boolean') return value
  }
  return null
}

function readArrayPayload(payload: unknown, ...keys: string[]): unknown[] {
  if (Array.isArray(payload)) return payload
  const record = readRecord(payload)
  if (!record) return []
  for (const key of keys) {
    const value = record[key]
    if (Array.isArray(value)) return value
  }
  return []
}

function readEntityType(value: unknown): DocumentEntityType | null {
  if (
    value === 'customer-person' ||
    value === 'customer-company' ||
    value === 'deal' ||
    value === 'product' ||
    value === 'quote'
  ) {
    return value
  }
  return null
}

function normalizeContextSlot(value: unknown): DocumentTemplateContextSlot | null {
  const record = readRecord(value)
  if (!record) return null
  const slot = readString(record, 'slot')
  const entityType = readEntityType(record.entityType ?? record.entity_type)
  if (!slot || !entityType) return null
  return {
    slot,
    entityType,
    required: readBoolean(record, 'required') ?? undefined,
  }
}

function normalizeTemplate(value: unknown): DocumentTemplateRow | null {
  const record = readRecord(value)
  if (!record) return null
  const id = readString(record, 'id')
  const name = readString(record, 'name')
  const bodyHtml = readString(record, 'bodyHtml', 'body_html') ?? ''
  const updatedAt = readString(record, 'updatedAt', 'updated_at')
  const createdAt = readString(record, 'createdAt', 'created_at')
  if (!id || !name || !updatedAt || !createdAt) return null
  const contextSlotsValue = record.contextSlots ?? record.context_slots
  const contextSlots = Array.isArray(contextSlotsValue)
    ? contextSlotsValue.map(normalizeContextSlot).filter((slot): slot is DocumentTemplateContextSlot => slot !== null)
    : null
  return {
    id,
    name,
    description: readString(record, 'description'),
    bodyHtml,
    contextSlots,
    isActive: readBoolean(record, 'isActive', 'is_active') ?? true,
    updatedAt,
    createdAt,
  }
}

function normalizeTemplates(payload: TemplatesResponse | unknown[] | null): DocumentTemplateRow[] {
  return readArrayPayload(payload, 'items', 'data', 'templates')
    .map(normalizeTemplate)
    .filter((row): row is DocumentTemplateRow => row !== null)
    .filter((row) => row.isActive)
}

function readCreatedId(payload: CreateDocumentResponse | unknown): string | null {
  const root = readRecord(payload)
  if (!root) return null
  const nestedDocument = readRecord(root.document)
  const nestedItem = readRecord(root.item)
  const nestedData = readRecord(root.data)
  return (
    readString(root, 'id') ??
    (nestedDocument ? readString(nestedDocument, 'id') : null) ??
    (nestedItem ? readString(nestedItem, 'id') : null) ??
    (nestedData ? readString(nestedData, 'id') : null)
  )
}

function slotSelectionKey(slot: DocumentTemplateContextSlot, index: number): string {
  return `${slot.slot}:${index}`
}

function resolveBrowserLocale(): string | undefined {
  if (typeof navigator === 'undefined') return undefined
  return navigator.language || undefined
}

function buildDefaultTitle(template: DocumentTemplateRow, locale: string | undefined): string {
  return `${template.name} ${new Date().toLocaleDateString(locale)}`
}

function buildSearchUrl(entry: EntityRegistryEntry, query: string): string {
  const params = new URLSearchParams({
    search: query,
    page: '1',
    pageSize: String(PAGE_SIZE),
  })
  return `${entry.searchPath}?${params.toString()}`
}

export function NewFromTemplateDialog({ open, folderId, onOpenChange }: NewFromTemplateDialogProps) {
  const t = useT()
  const router = useRouter()
  const titleInputId = React.useId()
  const rawItemsBySlotRef = React.useRef<Map<string, Map<string, Record<string, unknown>>>>(new Map())
  const [templates, setTemplates] = React.useState<DocumentTemplateRow[]>([])
  const [selectedTemplateId, setSelectedTemplateId] = React.useState<string | null>(null)
  const [title, setTitle] = React.useState('')
  const [slotSelections, setSlotSelections] = React.useState<Record<string, SlotSelection | null>>({})
  const [isLoading, setIsLoading] = React.useState(false)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = React.useState(false)

  const selectedTemplate = React.useMemo(
    () => templates.find((template) => template.id === selectedTemplateId) ?? null,
    [selectedTemplateId, templates],
  )
  const contextSlots = selectedTemplate?.contextSlots ?? []
  const mutationContextId = 'documents-new-from-template:mutation'
  const { runMutation, retryLastMutation } = useGuardedMutation<MutationContext>({
    contextId: mutationContextId,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  const loadTemplates = React.useCallback(async () => {
    setIsLoading(true)
    setLoadError(null)
    try {
      const call = await apiCall<TemplatesResponse>(
        '/api/documents/templates',
        undefined,
        { fallback: { items: [], total: 0 } },
      )
      if (!call.ok) {
        setLoadError(t('documents.templates.instantiate.error.load', 'Failed to load templates.'))
        setTemplates([])
        return
      }
      setTemplates(normalizeTemplates(call.result ?? { items: [] }))
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : t('documents.templates.instantiate.error.load', 'Failed to load templates.'))
      setTemplates([])
    } finally {
      setIsLoading(false)
    }
  }, [t])

  React.useEffect(() => {
    if (!open) return
    setSelectedTemplateId(null)
    setTitle('')
    setSlotSelections({})
    rawItemsBySlotRef.current = new Map()
    void loadTemplates()
  }, [loadTemplates, open])

  React.useEffect(() => {
    if (!selectedTemplate) {
      setTitle('')
      setSlotSelections({})
      return
    }
    setTitle(buildDefaultTitle(selectedTemplate, resolveBrowserLocale()))
    setSlotSelections({})
    rawItemsBySlotRef.current = new Map()
  }, [selectedTemplate])

  const fetchSlotItems = React.useCallback(async (
    slotKey: string,
    entry: EntityRegistryEntry,
    query: string,
  ): Promise<LookupSelectItem[]> => {
    const call = await apiCall<unknown>(
      buildSearchUrl(entry, query),
      undefined,
      { fallback: { items: [] } },
    )
    if (!call.ok) return []
    const rawMap = new Map<string, Record<string, unknown>>()
    const options = readItemsArray(call.result)
      .map((item): LookupSelectItem | null => {
        const mapped = entry.mapItem(item)
        if (!mapped) return null
        rawMap.set(mapped.id, item)
        return {
          id: mapped.id,
          title: mapped.label,
          subtitle: mapped.subtitle ?? null,
        }
      })
      .filter((item): item is LookupSelectItem => item !== null)
    rawItemsBySlotRef.current.set(slotKey, rawMap)
    return options
  }, [])

  const missingRequiredSlot = React.useMemo(() => (
    contextSlots.some((slot, index) => {
      if (slot.required !== true) return false
      const key = slotSelectionKey(slot, index)
      return !slotSelections[key]
    })
  ), [contextSlots, slotSelections])

  const canSubmit = Boolean(
    selectedTemplate &&
    title.trim().length > 0 &&
    !missingRequiredSlot &&
    !isSubmitting,
  )

  const handleSubmit = React.useCallback(async () => {
    if (!selectedTemplate || !canSubmit) return
    setIsSubmitting(true)
    const locale = resolveBrowserLocale()
    const fillSlots: TemplateFillSlot[] = contextSlots.map((slot, index) => {
      const selection = slotSelections[slotSelectionKey(slot, index)]
      return {
        slot: slot.slot,
        entityType: slot.entityType,
        rawItem: selection?.rawItem ?? null,
      }
    })
    const contentHtml = fillTemplateTokens(selectedTemplate.bodyHtml, fillSlots, { locale })

    try {
      const createCall = await runMutation({
        operation: async () =>
          apiCallOrThrow<CreateDocumentResponse>(
            '/api/documents',
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                title: title.trim(),
                folderId: folderId ?? null,
              }),
            },
            { errorMessage: t('documents.templates.instantiate.error.create', 'Failed to create document from template.') },
          ),
        context: {
          formId: mutationContextId,
          resourceKind: DOCUMENTS_ENTITY_IDS.document,
          resourceId: folderId ?? 'new',
          retryLastMutation,
        },
        mutationPayload: {
          title: title.trim(),
          folderId: folderId ?? null,
          templateId: selectedTemplate.id,
        },
      })
      const documentId = readCreatedId(createCall.result)
      if (!documentId) throw new Error(t('documents.list.error.missingCreatedId'))

      await runMutation({
        operation: async () =>
          apiCallOrThrow(
            `/api/documents/${encodeURIComponent(documentId)}/content`,
            {
              method: 'PUT',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ contentHtml }),
            },
            { errorMessage: t('documents.templates.instantiate.error.content', 'Failed to fill document content.') },
          ),
        context: {
          formId: mutationContextId,
          resourceKind: DOCUMENTS_ENTITY_IDS.documentContent,
          resourceId: documentId,
          retryLastMutation,
        },
        mutationPayload: {
          templateId: selectedTemplate.id,
          contentHtml,
        },
      })

      flash(t('documents.templates.instantiate.success', 'Document created from template.'), 'success')
      onOpenChange(false)
      router.push(`/backend/documents/${documentId}`)
    } catch (err) {
      flash(err instanceof Error ? err.message : t('documents.templates.instantiate.error.create', 'Failed to create document from template.'), 'error')
    } finally {
      setIsSubmitting(false)
    }
  }, [
    canSubmit,
    contextSlots,
    folderId,
    mutationContextId,
    onOpenChange,
    retryLastMutation,
    router,
    runMutation,
    selectedTemplate,
    slotSelections,
    t,
    title,
  ])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="lg"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            onOpenChange(false)
            return
          }
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault()
            void handleSubmit()
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('documents.templates.instantiate.title', 'New from template')}</DialogTitle>
          <DialogDescription>
            {t('documents.templates.instantiate.description', 'Choose a template, fill its context, and create a document.')}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <LoadingMessage label={t('documents.templates.instantiate.loading', 'Loading templates...')} />
        ) : loadError ? (
          <ErrorMessage label={loadError} />
        ) : templates.length === 0 ? (
          <p className="rounded-md border border-border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
            {t('documents.templates.instantiate.empty', 'No active templates are available.')}
          </p>
        ) : !selectedTemplate ? (
          <div className="space-y-3">
            <Label>{t('documents.templates.instantiate.template', 'Template')}</Label>
            <Select value={selectedTemplateId ?? undefined} onValueChange={setSelectedTemplateId}>
              <SelectTrigger>
                <SelectValue placeholder={t('documents.templates.instantiate.templatePlaceholder', 'Select a template')} />
              </SelectTrigger>
              <SelectContent>
                {templates.map((template) => (
                  <SelectItem key={template.id} value={template.id}>
                    {template.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <div className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor={titleInputId}>{t('documents.templates.instantiate.documentTitle', 'Document title')}</Label>
              <Input
                id={titleInputId}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder={t('documents.templates.instantiate.documentTitlePlaceholder', 'Document title')}
              />
            </div>

            {contextSlots.length === 0 ? (
              <p className="rounded-md border border-border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
                {t('documents.templates.instantiate.noSlots', 'This template does not need context.')}
              </p>
            ) : (
              <div className="space-y-4">
                <p className="text-sm font-medium">{t('documents.templates.instantiate.contextTitle', 'Context')}</p>
                {contextSlots.map((slot, index) => {
                  const entry = getEntityRegistryEntry(slot.entityType)
                  const slotKey = slotSelectionKey(slot, index)
                  const selection = slotSelections[slotKey]
                  if (!entry) return null
                  return (
                    <div key={slotKey} className="space-y-2">
                      <Label>
                        {t(entry.labelKey, ENTITY_TYPE_FALLBACKS[entry.type])}
                        {slot.required === true ? ` ${t('documents.templates.instantiate.requiredSuffix', '(required)')}` : ''}
                      </Label>
                      <LookupSelect
                        value={selection?.id ?? null}
                        onChange={(nextId) => {
                          const rawItem = nextId ? rawItemsBySlotRef.current.get(slotKey)?.get(nextId) ?? null : null
                          setSlotSelections((current) => ({
                            ...current,
                            [slotKey]: nextId && rawItem ? { id: nextId, rawItem } : null,
                          }))
                        }}
                        fetchItems={(query) => fetchSlotItems(slotKey, entry, query)}
                        minQuery={0}
                        searchPlaceholder={t('documents.templates.instantiate.searchPlaceholder', 'Search records')}
                        placeholder={t('documents.templates.instantiate.searchPlaceholder', 'Search records')}
                        clearLabel={t('documents.templates.instantiate.clearSelection', 'Clear selection')}
                        emptyLabel={t('documents.templates.instantiate.noMatches', 'No matching records')}
                        loadingLabel={t('documents.templates.instantiate.searching', 'Searching...')}
                        startTypingLabel={t('documents.templates.instantiate.startTyping', 'Start typing to search.')}
                        minQueryHintLabel={t('documents.templates.instantiate.startTyping', 'Start typing to search.')}
                      />
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {selectedTemplate ? (
            <Button type="button" variant="outline" onClick={() => setSelectedTemplateId(null)} disabled={isSubmitting}>
              {t('documents.templates.instantiate.changeTemplate', 'Change template')}
            </Button>
          ) : null}
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            {t('documents.actions.cancel')}
          </Button>
          <Button type="button" onClick={() => void handleSubmit()} disabled={!canSubmit}>
            {t('documents.templates.instantiate.actions.create', 'Create document')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
