"use client"

import * as React from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTable, RowActions } from '@open-mercato/ui'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { apiCall, apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { DOCUMENTS_ENTITY_IDS } from '../../../lib/constants'
import {
  getEntityRegistryEntry,
  type DocumentEntityType,
} from '../../../lib/entityRegistry'
import {
  TemplateEditorDialog,
  type DocumentTemplateContextSlot,
  type DocumentTemplateRow,
} from '../components/TemplateEditorDialog'

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

type TemplateDeleteResponse = {
  ok?: boolean
  id?: string | null
  updatedAt?: string | null
  updated_at?: string | null
}

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
}

function formatDate(value: string | null | undefined, fallback: string): string {
  if (!value) return fallback
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return fallback
  return date.toLocaleString()
}

export default function DocumentTemplatesPage() {
  const t = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const [rows, setRows] = React.useState<DocumentTemplateRow[]>([])
  const [search, setSearch] = React.useState('')
  const [isLoading, setIsLoading] = React.useState(true)
  const [reloadToken, setReloadToken] = React.useState(0)
  const [editorTemplate, setEditorTemplate] = React.useState<DocumentTemplateRow | null>(null)
  const [editorOpen, setEditorOpen] = React.useState(false)

  const mutationContextId = 'documents-templates-list:mutation'
  const { runMutation, retryLastMutation } = useGuardedMutation<MutationContext>({
    contextId: mutationContextId,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  const loadTemplates = React.useCallback(async () => {
    setIsLoading(true)
    try {
      const params = new URLSearchParams()
      if (search.trim()) params.set('search', search.trim())
      const path = params.size > 0 ? `/api/documents/templates?${params.toString()}` : '/api/documents/templates'
      const call = await apiCall<TemplatesResponse>(path, undefined, { fallback: { items: [], total: 0 } })
      if (!call.ok) {
        flash(t('documents.templates.error.load', 'Failed to load templates.'), 'error')
        setRows([])
        return
      }
      setRows(normalizeTemplates(call.result ?? { items: [] }))
    } catch (err) {
      flash(err instanceof Error ? err.message : t('documents.templates.error.load', 'Failed to load templates.'), 'error')
      setRows([])
    } finally {
      setIsLoading(false)
    }
  }, [search, t])

  React.useEffect(() => {
    void loadTemplates()
  }, [loadTemplates, reloadToken])

  const handleRefresh = React.useCallback(() => {
    setReloadToken((token) => token + 1)
  }, [])

  const handleDeleteTemplate = React.useCallback(async (row: DocumentTemplateRow) => {
    const confirmed = await confirm({
      title: t('documents.templates.confirmDelete', 'Delete template "{name}"?', { name: row.name }),
      variant: 'destructive',
    })
    if (!confirmed) return
    try {
      await runMutation({
        operation: async () =>
          withScopedApiRequestHeaders(
            buildOptimisticLockHeader(row.updatedAt),
            () => apiCallOrThrow<TemplateDeleteResponse>(
              '/api/documents/templates',
              {
                method: 'DELETE',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ id: row.id }),
              },
              { errorMessage: t('documents.templates.error.delete', 'Failed to delete template.') },
            ),
          ),
        context: {
          formId: mutationContextId,
          resourceKind: DOCUMENTS_ENTITY_IDS.documentTemplate,
          resourceId: row.id,
          retryLastMutation,
        },
        mutationPayload: { id: row.id },
      })
      flash(t('documents.templates.success.delete', 'Template deleted.'), 'success')
      handleRefresh()
    } catch (err) {
      flash(err instanceof Error ? err.message : t('documents.templates.error.delete', 'Failed to delete template.'), 'error')
    }
  }, [confirm, handleRefresh, mutationContextId, retryLastMutation, runMutation, t])

  const describeSlots = React.useCallback((slots: DocumentTemplateContextSlot[] | null): string => {
    if (!slots || slots.length === 0) return t('documents.templates.slots.none', 'No slots')
    const labels = slots
      .map((slot) => {
        const entry = getEntityRegistryEntry(slot.entityType)
        return entry ? t(entry.labelKey, ENTITY_TYPE_FALLBACKS[entry.type]) : ENTITY_TYPE_FALLBACKS[slot.entityType]
      })
    return labels.join(', ')
  }, [t])

  const columns = React.useMemo<ColumnDef<DocumentTemplateRow>[]>(() => [
    {
      accessorKey: 'name',
      header: t('documents.templates.columns.name', 'Name'),
      meta: { alwaysVisible: true, maxWidth: '240px' },
      cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
    },
    {
      accessorKey: 'description',
      header: t('documents.templates.columns.description', 'Description'),
      meta: { maxWidth: '320px' },
      cell: ({ row }) => (
        row.original.description ? (
          <span className="text-sm">{row.original.description}</span>
        ) : (
          <span className="text-sm text-muted-foreground">
            {t('documents.templates.list.noDescription', 'No description')}
          </span>
        )
      ),
    },
    {
      id: 'slots',
      header: t('documents.templates.columns.slots', 'Slots'),
      meta: { maxWidth: '260px' },
      cell: ({ row }) => <span className="text-sm">{describeSlots(row.original.contextSlots)}</span>,
    },
    {
      accessorKey: 'isActive',
      header: t('documents.templates.columns.active', 'Active'),
      cell: ({ row }) => (
        <StatusBadge variant={row.original.isActive ? 'success' : 'neutral'} dot>
          {row.original.isActive
            ? t('documents.templates.status.active', 'Active')
            : t('documents.templates.status.inactive', 'Inactive')}
        </StatusBadge>
      ),
    },
    {
      accessorKey: 'updatedAt',
      header: t('documents.columns.updatedAt'),
      meta: { maxWidth: '180px' },
      cell: ({ row }) => <span className="text-sm">{formatDate(row.original.updatedAt, t('documents.list.noValue'))}</span>,
    },
  ], [describeSlots, t])

  return (
    <Page>
      <PageBody>
        <DataTable<DocumentTemplateRow>
          title={t('documents.templates.list.title', 'Document templates')}
          actions={(
            <Button
              type="button"
              onClick={() => {
                setEditorTemplate(null)
                setEditorOpen(true)
              }}
            >
              {t('documents.templates.actions.new', 'New template')}
            </Button>
          )}
          refreshButton={{
            label: t('documents.actions.refresh'),
            onRefresh: handleRefresh,
            isRefreshing: isLoading,
          }}
          columns={columns}
          data={rows}
          isLoading={isLoading}
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder={t('documents.templates.list.searchPlaceholder', 'Search templates')}
          emptyState={t('documents.templates.list.empty', 'No templates found.')}
          entityId={DOCUMENTS_ENTITY_IDS.documentTemplate}
          extensionTableId="documents.templates.list"
          onRowClick={(row) => {
            setEditorTemplate(row)
            setEditorOpen(true)
          }}
          rowClickActionIds={['edit']}
          stickyActionsColumn
          rowActions={(row) => (
            <RowActions
              items={[
                {
                  id: 'edit',
                  label: t('documents.actions.edit'),
                  onSelect: () => {
                    setEditorTemplate(row)
                    setEditorOpen(true)
                  },
                },
                {
                  id: 'delete',
                  label: t('documents.actions.delete'),
                  destructive: true,
                  onSelect: () => void handleDeleteTemplate(row),
                },
              ]}
            />
          )}
        />

        <TemplateEditorDialog
          open={editorOpen}
          template={editorTemplate}
          onOpenChange={(open) => {
            setEditorOpen(open)
            if (!open) setEditorTemplate(null)
          }}
          onSaved={handleRefresh}
        />
        {ConfirmDialogElement}
      </PageBody>
    </Page>
  )
}
