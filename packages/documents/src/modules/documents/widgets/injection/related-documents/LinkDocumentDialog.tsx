"use client"

import * as React from 'react'
import { Link2, Search } from 'lucide-react'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { Button } from '@open-mercato/ui/primitives/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { useDialogKeyHandler } from '@open-mercato/ui/hooks/useDialogKeyHandler'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { readNumber, readRecord } from '../../../backend/documents/documentUi'
import { normalizeDocuments, type DocumentRow } from '../../../backend/documents/documentsListTypes'
import type { RelatedDocumentContext } from './context'
import { OPTIONAL_HEADERS } from './useRelatedDocuments'

const SEARCH_PAGE_SIZE = 20
const MAX_SEARCH_PAGES = 5

function buildSearchContext(open: boolean, target: RelatedDocumentContext, query: string): string {
  return JSON.stringify([open, target.entityType, target.entityId, query.trim()])
}

async function loadEditableDocuments(
  search: string,
  signal: AbortSignal,
  unknownOwner: string,
): Promise<{ ok: boolean; rows: DocumentRow[] }> {
  const editable: DocumentRow[] = []
  for (let page = 1; page <= MAX_SEARCH_PAGES; page += 1) {
    const params = new URLSearchParams({ search, page: String(page), pageSize: String(SEARCH_PAGE_SIZE) })
    const call = await apiCall<unknown>(
      `/api/documents?${params.toString()}`,
      { headers: OPTIONAL_HEADERS, signal },
      { fallback: { items: [] } },
    )
    if (!call.ok) return { ok: false, rows: [] }
    const pageRows = normalizeDocuments(call.result, [], unknownOwner)
    editable.push(...pageRows.filter((row) => row.capabilities.canEdit))
    if (editable.length > 0 || pageRows.length === 0) break
    const totalPages = readNumber(readRecord(call.result) ?? {}, 'totalPages', 'total_pages') ?? page
    if (page >= totalPages) break
  }
  return { ok: true, rows: editable }
}

export function LinkDocumentDialog({ open, target, onOpenChange, onLinked }: {
  open: boolean
  target: RelatedDocumentContext
  onOpenChange: (open: boolean) => void
  onLinked: () => void
}) {
  const t = useT()
  const inputId = React.useId()
  const request = React.useRef(0)
  const activeRequest = React.useRef<AbortController | null>(null)
  const activeSearchContext = React.useRef('')
  const resultSearchContext = React.useRef<string | null>(null)
  const [query, setQuery] = React.useState('')
  const [rows, setRows] = React.useState<DocumentRow[]>([])
  const [loading, setLoading] = React.useState(false)
  const [errorSearchContext, setErrorSearchContext] = React.useState<string | null>(null)
  const [retryToken, setRetryToken] = React.useState(0)
  const [activeRowId, setActiveRowId] = React.useState<string | null>(null)
  const currentSearchContext = buildSearchContext(open, target, query)
  activeSearchContext.current = currentSearchContext
  const mutationContextId = `documents-related-widget:${target.entityType}:${target.entityId}`
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string; resourceKind: string; resourceId: string; retryLastMutation: () => Promise<boolean>
  }>({ contextId: mutationContextId, blockedMessage: t('ui.forms.flash.saveBlocked') })

  const invalidateSearch = React.useCallback(() => {
    request.current += 1
    activeRequest.current?.abort()
    activeRequest.current = null
    resultSearchContext.current = null
    setRows([])
    setActiveRowId(null)
    setLoading(false)
    setErrorSearchContext(null)
  }, [])

  const changeQuery = React.useCallback((nextQuery: string) => {
    activeSearchContext.current = buildSearchContext(open, target, nextQuery)
    invalidateSearch()
    setQuery(nextQuery)
  }, [invalidateSearch, open, target.entityId, target.entityType, target.href, target.label])

  const handleOpenChange = React.useCallback((nextOpen: boolean) => {
    if (!nextOpen) {
      activeSearchContext.current = buildSearchContext(false, target, '')
      invalidateSearch()
      setQuery('')
    }
    onOpenChange(nextOpen)
  }, [invalidateSearch, onOpenChange, target.entityId, target.entityType, target.href, target.label])

  React.useEffect(() => {
    invalidateSearch()
    if (!open) { setQuery(''); return }
    const search = query.trim()
    if (!search) return
    const timer = window.setTimeout(() => {
      const requestId = ++request.current
      const requestContext = buildSearchContext(true, target, search)
      const controller = new AbortController()
      activeRequest.current?.abort()
      activeRequest.current = controller
      resultSearchContext.current = null
      setRows([])
      setLoading(true)
      setErrorSearchContext(null)
      void loadEditableDocuments(search, controller.signal, t('documents.list.unknownOwner'))
        .then((result) => {
          if (request.current !== requestId || activeSearchContext.current !== requestContext) return
          resultSearchContext.current = requestContext
          if (!result.ok) {
            setRows([])
            setActiveRowId(null)
            setErrorSearchContext(requestContext)
            return
          }
          setRows(result.rows)
          setActiveRowId(result.rows[0]?.id ?? null)
        })
        .catch(() => {
          if (!controller.signal.aborted && request.current === requestId && activeSearchContext.current === requestContext) {
            resultSearchContext.current = requestContext
            setRows([])
            setActiveRowId(null)
            setErrorSearchContext(requestContext)
          }
        })
        .finally(() => {
          if (request.current === requestId) {
            if (activeRequest.current === controller) activeRequest.current = null
            setLoading(false)
          }
        })
    }, 250)
    return () => window.clearTimeout(timer)
  }, [invalidateSearch, open, query, retryToken, t, target.entityId, target.entityType, target.href, target.label])

  React.useEffect(() => () => { activeRequest.current?.abort() }, [])

  const linkDocument = React.useCallback(async (row: DocumentRow) => {
    if (resultSearchContext.current === null || resultSearchContext.current !== activeSearchContext.current) return
    try {
      await runMutation({
        operation: () => apiCallOrThrow(
          `/api/documents/${encodeURIComponent(row.id)}/links`,
          {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ entityType: target.entityType, entityId: target.entityId, label: target.label, href: target.href, source: 'related-panel' }),
          },
          { errorMessage: t('documents.relatedDocuments.error.link') },
        ),
        context: { formId: mutationContextId, resourceKind: 'documents.document_entity_link', resourceId: row.id, retryLastMutation },
        mutationPayload: { documentId: row.id, entityType: target.entityType },
      })
      flash(t('documents.relatedDocuments.success.link'), 'success')
      handleOpenChange(false)
      onLinked()
    } catch (error) { flash(error instanceof Error ? error.message : t('documents.relatedDocuments.error.link'), 'error') }
  }, [handleOpenChange, mutationContextId, onLinked, retryLastMutation, runMutation, t, target.entityId, target.entityType, target.href, target.label])

  const hasCurrentResults = resultSearchContext.current !== null && resultSearchContext.current === currentSearchContext
  const hasCurrentError = errorSearchContext !== null && errorSearchContext === currentSearchContext
  const visibleRows = hasCurrentResults ? rows : []
  const retrySearch = React.useCallback(() => {
    if (!open || !query.trim()) return
    invalidateSearch()
    setRetryToken((token) => token + 1)
  }, [invalidateSearch, open, query])
  const confirmActiveRow = React.useCallback(() => {
    const row = visibleRows.find((candidate) => candidate.id === activeRowId) ?? visibleRows[0]
    if (row) void linkDocument(row)
  }, [activeRowId, linkDocument, visibleRows])
  const dialogKeyDown = useDialogKeyHandler({
    onConfirm: confirmActiveRow,
    onCancel: () => handleOpenChange(false),
    disabled: loading || visibleRows.length === 0,
  })
  const handleDialogKeyDown = React.useCallback((event: React.KeyboardEvent) => {
    dialogKeyDown(event)
    if (event.defaultPrevented || visibleRows.length === 0) return
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const currentIndex = visibleRows.findIndex((row) => row.id === activeRowId)
    const offset = event.key === 'ArrowDown' ? 1 : -1
    const nextIndex = currentIndex < 0
      ? 0
      : (currentIndex + offset + visibleRows.length) % visibleRows.length
    setActiveRowId(visibleRows[nextIndex]?.id ?? null)
  }, [activeRowId, dialogKeyDown, visibleRows])

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent size="lg" onKeyDown={handleDialogKeyDown}>
        <DialogHeader><DialogTitle>{t('documents.relatedDocuments.linkDialog.title')}</DialogTitle><DialogDescription>{t('documents.relatedDocuments.linkDialog.description')}</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2"><Label htmlFor={inputId}>{t('documents.relatedDocuments.linkDialog.searchLabel')}</Label><Input id={inputId} value={query} onChange={(event) => changeQuery(event.target.value)} leftIcon={<Search />} placeholder={t('documents.relatedDocuments.linkDialog.searchPlaceholder')} /></div>
          {loading ? <LoadingMessage label={t('documents.relatedDocuments.loading')} /> : null}
          {!loading && hasCurrentError ? (
            <ErrorMessage
              label={t('documents.relatedDocuments.linkDialog.error')}
              action={<Button type="button" size="sm" variant="outline" onClick={retrySearch}>{t('documents.actions.retry')}</Button>}
            />
          ) : null}
          {!loading && !hasCurrentError && query.trim() && hasCurrentResults && visibleRows.length === 0 ? <p className="rounded-md border border-border bg-muted/20 p-3 text-sm text-muted-foreground">{t('documents.relatedDocuments.linkDialog.empty')}</p> : null}
          {!loading && visibleRows.length > 0 ? <div className="max-h-72 space-y-2 overflow-y-auto">{visibleRows.map((row) => (
            <Button key={row.id} type="button" variant={activeRowId === row.id ? 'secondary' : 'outline'} aria-current={activeRowId === row.id ? 'true' : undefined} className="h-auto w-full justify-between p-3 text-left" onFocus={() => setActiveRowId(row.id)} onClick={() => { void linkDocument(row) }}>
              <span className="min-w-0"><span className="block truncate font-medium">{row.title}</span><span className="block truncate text-xs text-muted-foreground">{row.ownerLabel}</span></span><Link2 />
            </Button>
          ))}</div> : null}
        </div>
        <DialogFooter><Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>{t('documents.actions.cancel')}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
