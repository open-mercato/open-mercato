"use client"

import * as React from 'react'
import { ChevronDown, ChevronRight, FileSearch, RefreshCw } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { hasFeature } from '@open-mercato/shared/security/features'
import { Button } from '../../primitives/button'
import { IconButton } from '../../primitives/icon-button'
import { EmptyState } from '../../primitives/empty-state'
import { StatusBadge, type StatusMap } from '../../primitives/status-badge'
import { apiCall } from '../utils/apiCall'
import { flash } from '../FlashMessages'
import { useGuardedMutation } from '../injection/useGuardedMutation'
import { LoadingMessage } from './LoadingMessage'
import { ErrorMessage } from './ErrorMessage'

export type DocumentStructureStatus = 'pending' | 'processing' | 'completed' | 'partial' | 'failed' | 'skipped'

export type DocumentStructureExtraction = {
  id: string
  status: DocumentStructureStatus
  pageCount?: number | null
  sectionCount?: number | null
  skipReason?: string | null
}

export type DocumentStructureNode = {
  id: string
  parentId: string | null
  kind: string
  numberLabel: string | null
  heading: string | null
  pageStart: number | null
  pageEnd: number | null
}

type StructureResponse = {
  attachmentId: string
  extraction: DocumentStructureExtraction | null
  outline: DocumentStructureNode[]
}

type SectionsResponse = {
  extractionId: string | null
  items: DocumentStructureNode[]
  nextCursor: number | null
}

type RequestResponse = { status?: string; error?: string }

type LoadedChildren = { items: DocumentStructureNode[]; nextCursor: number | null }

export type DocumentStructurePanelProps = {
  attachmentId: string
  canManage?: boolean
}

const OUTLINE_MAX_DEPTH = 2
const CHILDREN_PAGE_SIZE = 100
const POLL_INTERVAL_MS = 3000
const MAX_POLLS = 60
const OUTLINE_KINDS = ['part', 'chapter', 'section', 'article', 'clause', 'annex', 'page_unreadable'].join(',')
const ACTIVE_STATUSES: ReadonlySet<DocumentStructureStatus> = new Set(['pending', 'processing'])

const statusVariants: StatusMap<DocumentStructureStatus> = {
  pending: 'neutral',
  processing: 'info',
  completed: 'success',
  partial: 'warning',
  failed: 'error',
  skipped: 'neutral',
}

const statusLabels: Record<DocumentStructureStatus, [string, string]> = {
  pending: ['attachments.structure.status.pending', 'Queued'],
  processing: ['attachments.structure.status.processing', 'Processing'],
  completed: ['attachments.structure.status.completed', 'Completed'],
  partial: ['attachments.structure.status.partial', 'Partial'],
  failed: ['attachments.structure.status.failed', 'Failed'],
  skipped: ['attachments.structure.status.skipped', 'Skipped'],
}

const skipReasonLabels: Record<string, [string, string]> = {
  unsupported_type: ['attachments.structure.skipReason.unsupported_type', 'This file type does not support document structure extraction.'],
  no_text_layer_ocr_disabled: ['attachments.structure.skipReason.no_text_layer_ocr_disabled', 'The document has no text layer and OCR is disabled.'],
  too_large: ['attachments.structure.skipReason.too_large', 'The file is too large for document structure extraction.'],
  encrypted_pdf: ['attachments.structure.skipReason.encrypted_pdf', 'The PDF is encrypted and cannot be read.'],
}

function structureUrl(attachmentId: string): string {
  return `/api/attachments/structure/${encodeURIComponent(attachmentId)}`
}

function useCanManageStructure(canManage: boolean | undefined): boolean {
  const [granted, setGranted] = React.useState(false)
  React.useEffect(() => {
    if (canManage !== undefined) return
    let cancelled = false
    void apiCall<{ granted?: string[] }>('/api/auth/feature-check', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ features: ['attachments.manage'] }),
    })
      .then((call) => {
        if (!cancelled) setGranted(hasFeature(call.result?.granted, 'attachments.manage'))
      })
      .catch(() => {
        if (!cancelled) setGranted(false)
      })
    return () => {
      cancelled = true
    }
  }, [canManage])
  return canManage ?? granted
}

function OutlineNodeItem({
  node,
  childrenOf,
  isExpanded,
  isLoading,
  onToggle,
  onLoadMore,
}: {
  node: DocumentStructureNode
  childrenOf: (nodeId: string) => { items: DocumentStructureNode[]; known: boolean; nextCursor: number | null }
  isExpanded: (nodeId: string) => boolean
  isLoading: (nodeId: string) => boolean
  onToggle: (nodeId: string) => void
  onLoadMore: (nodeId: string) => void
}) {
  const t = useT()
  const children = childrenOf(node.id)
  const expandable = !children.known || children.items.length > 0
  const expanded = expandable && isExpanded(node.id)
  const label = [node.numberLabel, node.heading].filter(Boolean).join(' ') || t('attachments.structure.outline.untitled', 'Untitled section')
  const pages =
    node.pageStart === null
      ? null
      : node.pageEnd !== null && node.pageEnd !== node.pageStart
        ? t('attachments.structure.outline.pageRange', 'pp. {start}–{end}', { start: node.pageStart, end: node.pageEnd })
        : t('attachments.structure.outline.page', 'p. {page}', { page: node.pageStart })
  return (
    <li data-section-id={node.id}>
      <div className="flex min-w-0 items-center gap-1">
        {expandable ? (
          <IconButton
            type="button"
            variant="ghost"
            size="xs"
            aria-expanded={expanded}
            aria-label={
              expanded
                ? t('attachments.structure.outline.collapse', 'Collapse {label}', { label })
                : t('attachments.structure.outline.expand', 'Expand {label}', { label })
            }
            onClick={() => onToggle(node.id)}
          >
            {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          </IconButton>
        ) : (
          <span className="size-6 shrink-0" aria-hidden="true" />
        )}
        <span className="min-w-0 flex-1 truncate text-sm" title={label}>
          {label}
        </span>
        {pages ? <span className="shrink-0 text-xs text-muted-foreground">{pages}</span> : null}
      </div>
      {expanded ? (
        <ul className="ms-6 space-y-1">
          {children.items.map((child) => (
            <OutlineNodeItem
              key={child.id}
              node={child}
              childrenOf={childrenOf}
              isExpanded={isExpanded}
              isLoading={isLoading}
              onToggle={onToggle}
              onLoadMore={onLoadMore}
            />
          ))}
          {isLoading(node.id) ? (
            <li className="text-xs text-muted-foreground">{t('attachments.structure.outline.loading', 'Loading sections…')}</li>
          ) : null}
          {children.known && children.items.length === 0 && !isLoading(node.id) ? (
            <li className="text-xs text-muted-foreground">{t('attachments.structure.outline.noChildren', 'No subsections.')}</li>
          ) : null}
          {children.nextCursor !== null && !isLoading(node.id) ? (
            <li>
              <Button type="button" variant="ghost" size="2xs" onClick={() => onLoadMore(node.id)}>
                {t('attachments.structure.actions.loadMore', 'Load more')}
              </Button>
            </li>
          ) : null}
        </ul>
      ) : null}
    </li>
  )
}

export function DocumentStructurePanel({ attachmentId, canManage }: DocumentStructurePanelProps) {
  const t = useT()
  const allowManage = useCanManageStructure(canManage)
  const [structure, setStructure] = React.useState<StructureResponse | null>(null)
  const [loadError, setLoadError] = React.useState<string | null>(null)
  const [reloadToken, setReloadToken] = React.useState(0)
  const [pollCount, setPollCount] = React.useState(0)
  const [awaitingFromId, setAwaitingFromId] = React.useState<string | null | undefined>(undefined)
  const [requesting, setRequesting] = React.useState(false)
  const [loadedChildren, setLoadedChildren] = React.useState<Record<string, LoadedChildren>>({})
  const [loadingNodes, setLoadingNodes] = React.useState<ReadonlySet<string>>(new Set())
  const [expandedNodes, setExpandedNodes] = React.useState<ReadonlySet<string>>(new Set())
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    attachmentId: string
    retryLastMutation: () => Promise<boolean>
  }>({ contextId: `attachment-structure:${attachmentId}` })

  const extractionId = structure?.extraction?.id ?? null

  React.useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const call = await apiCall<StructureResponse>(
          `${structureUrl(attachmentId)}?includeOutline=true&maxDepth=${OUTLINE_MAX_DEPTH}`,
        )
        if (cancelled) return
        if (!call.ok || !call.result) {
          setLoadError(t('attachments.structure.loadError', 'Failed to load the document structure.'))
          return
        }
        setLoadError(null)
        setStructure(call.result)
      } catch {
        if (!cancelled) setLoadError(t('attachments.structure.loadError', 'Failed to load the document structure.'))
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [attachmentId, reloadToken, t])

  React.useEffect(() => {
    setLoadedChildren({})
    setLoadingNodes(new Set())
    setExpandedNodes(new Set())
  }, [attachmentId, extractionId])

  const status = structure?.extraction?.status ?? null
  const awaiting = awaitingFromId !== undefined
  React.useEffect(() => {
    if (!structure || awaitingFromId === undefined) return
    const current = structure.extraction
    if (current && (current.id !== awaitingFromId || ACTIVE_STATUSES.has(current.status))) {
      setAwaitingFromId(undefined)
    }
  }, [awaitingFromId, structure])

  const shouldPoll = (awaiting || (status !== null && ACTIVE_STATUSES.has(status))) && pollCount < MAX_POLLS
  React.useEffect(() => {
    if (!shouldPoll) return
    const timer = setTimeout(() => {
      setPollCount((count) => count + 1)
      setReloadToken((token) => token + 1)
    }, POLL_INTERVAL_MS)
    return () => clearTimeout(timer)
  }, [shouldPoll, reloadToken])

  const outlineIndex = React.useMemo(() => {
    const outline = structure?.outline ?? []
    const ids = new Set(outline.map((node) => node.id))
    const byParent = new Map<string, DocumentStructureNode[]>()
    const roots: DocumentStructureNode[] = []
    for (const node of outline) {
      if (node.parentId && ids.has(node.parentId)) {
        const siblings = byParent.get(node.parentId) ?? []
        siblings.push(node)
        byParent.set(node.parentId, siblings)
      } else {
        roots.push(node)
      }
    }
    return { roots, byParent, rootIds: new Set(roots.map((node) => node.id)) }
  }, [structure])

  const childrenOf = React.useCallback(
    (nodeId: string) => {
      if (outlineIndex.rootIds.has(nodeId)) {
        return { items: outlineIndex.byParent.get(nodeId) ?? [], known: true, nextCursor: null }
      }
      const loaded = loadedChildren[nodeId]
      if (!loaded) return { items: [], known: false, nextCursor: null }
      return { items: loaded.items, known: true, nextCursor: loaded.nextCursor }
    },
    [loadedChildren, outlineIndex],
  )

  const fetchChildren = React.useCallback(
    async (nodeId: string, afterOrdinal: number | null) => {
      setLoadingNodes((current) => new Set(current).add(nodeId))
      const params = new URLSearchParams({
        parentId: nodeId,
        includeText: 'false',
        limit: String(CHILDREN_PAGE_SIZE),
        kinds: OUTLINE_KINDS,
      })
      if (afterOrdinal !== null) params.set('afterOrdinal', String(afterOrdinal))
      try {
        const call = await apiCall<SectionsResponse>(`${structureUrl(attachmentId)}/sections?${params.toString()}`)
        if (!call.ok || !call.result) throw new Error('[internal] document sections request failed')
        const page = call.result
        setLoadedChildren((current) => ({
          ...current,
          [nodeId]: {
            items: [...(afterOrdinal !== null ? current[nodeId]?.items ?? [] : []), ...page.items],
            nextCursor: page.nextCursor,
          },
        }))
      } catch {
        flash(t('attachments.structure.outline.loadError', 'Failed to load subsections.'), 'error')
      } finally {
        setLoadingNodes((current) => {
          const next = new Set(current)
          next.delete(nodeId)
          return next
        })
      }
    },
    [attachmentId, t],
  )

  const isExpanded = React.useCallback(
    (nodeId: string) => (outlineIndex.rootIds.has(nodeId) ? !expandedNodes.has(nodeId) : expandedNodes.has(nodeId)),
    [expandedNodes, outlineIndex],
  )
  const isLoading = React.useCallback((nodeId: string) => loadingNodes.has(nodeId), [loadingNodes])

  const handleToggle = React.useCallback(
    (nodeId: string) => {
      setExpandedNodes((current) => {
        const next = new Set(current)
        if (next.has(nodeId)) next.delete(nodeId)
        else next.add(nodeId)
        return next
      })
      if (!outlineIndex.rootIds.has(nodeId) && !loadedChildren[nodeId] && !loadingNodes.has(nodeId)) {
        void fetchChildren(nodeId, null)
      }
    },
    [fetchChildren, loadedChildren, loadingNodes, outlineIndex],
  )

  const handleLoadMore = React.useCallback(
    (nodeId: string) => {
      const cursor = loadedChildren[nodeId]?.nextCursor
      if (cursor === null || cursor === undefined) return
      void fetchChildren(nodeId, cursor)
    },
    [fetchChildren, loadedChildren],
  )

  const handleRefresh = React.useCallback(() => {
    setPollCount(0)
    setReloadToken((token) => token + 1)
  }, [])

  const handleExtract = React.useCallback(async () => {
    const force = Boolean(structure?.extraction)
    const previousId = structure?.extraction?.id ?? null
    setRequesting(true)
    try {
      const call = await runMutation({
        operation: async () => {
          const response = await apiCall<RequestResponse>(structureUrl(attachmentId), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ force }),
          })
          if (!response.ok) {
            const serverMessage = typeof response.result?.error === 'string' ? response.result.error : null
            throw new Error(serverMessage ?? t('attachments.structure.flash.requestError', 'Failed to request document structure extraction.'))
          }
          return response
        },
        context: { formId: `attachment-structure:${attachmentId}`, attachmentId, retryLastMutation },
        mutationPayload: { force },
      })
      if (call.status === 202) {
        setAwaitingFromId(previousId)
        flash(t('attachments.structure.flash.requested', 'Document structure extraction queued.'), 'success')
      } else {
        flash(t('attachments.structure.flash.current', 'The document structure is already up to date.'), 'success')
      }
      setPollCount(0)
      setReloadToken((token) => token + 1)
    } catch (error) {
      const message = error instanceof Error && error.message && !error.message.startsWith('[internal]')
        ? error.message
        : t('attachments.structure.flash.requestError', 'Failed to request document structure extraction.')
      flash(message, 'error')
    } finally {
      setRequesting(false)
    }
  }, [attachmentId, retryLastMutation, runMutation, structure, t])

  if (loadError && !structure) {
    return (
      <ErrorMessage
        label={loadError}
        action={
          <Button type="button" variant="outline" size="sm" onClick={handleRefresh}>
            {t('attachments.structure.actions.refresh', 'Refresh')}
          </Button>
        }
      />
    )
  }
  if (!structure) {
    return <LoadingMessage label={t('attachments.structure.loading', 'Loading document structure…')} />
  }

  const extraction = structure.extraction
  const displayStatus: DocumentStructureStatus | null = awaiting ? 'pending' : status
  const busy = requesting || (displayStatus !== null && ACTIVE_STATUSES.has(displayStatus))
  const extractButton = allowManage ? (
    <Button type="button" variant="outline" size="sm" onClick={() => void handleExtract()} disabled={busy}>
      {extraction
        ? t('attachments.structure.actions.reextract', 'Re-extract')
        : t('attachments.structure.actions.extract', 'Extract structure')}
    </Button>
  ) : null

  return (
    <div className="space-y-3" data-testid="document-structure-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">{t('attachments.structure.outline.title', 'Document outline')}</span>
          {displayStatus ? (
            <StatusBadge variant={statusVariants[displayStatus]} dot>
              {t(...statusLabels[displayStatus])}
            </StatusBadge>
          ) : null}
          {extraction?.pageCount ? (
            <span className="text-xs text-muted-foreground">
              {t('attachments.structure.summary', '{pages} pages — {sections} sections', {
                pages: extraction.pageCount,
                sections: extraction.sectionCount ?? 0,
              })}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <IconButton
            type="button"
            variant="ghost"
            aria-label={t('attachments.structure.actions.refresh', 'Refresh')}
            onClick={handleRefresh}
          >
            <RefreshCw className="size-4" />
          </IconButton>
          {extraction ? extractButton : null}
        </div>
      </div>
      {loadError ? <ErrorMessage label={loadError} /> : null}
      {extraction?.skipReason && skipReasonLabels[extraction.skipReason] ? (
        <p className="text-sm text-muted-foreground">{t(...skipReasonLabels[extraction.skipReason])}</p>
      ) : null}
      {extraction?.status === 'failed' ? (
        <p className="text-sm text-muted-foreground">
          {t('attachments.structure.failedHint', 'The extraction failed. Try extracting the structure again.')}
        </p>
      ) : null}
      {!extraction ? (
        <EmptyState
          variant="subtle"
          size="sm"
          icon={<FileSearch className="size-5" aria-hidden="true" />}
          title={
            awaiting
              ? t('attachments.structure.empty.queuedTitle', 'Extraction queued')
              : t('attachments.structure.empty.title', 'Structure not extracted yet')
          }
          description={t('attachments.structure.empty.description', 'Extract the document structure to browse its chapters and sections.')}
          actions={extractButton}
        />
      ) : outlineIndex.roots.length > 0 ? (
        <ul className="max-h-96 space-y-1 overflow-y-auto">
          {outlineIndex.roots.map((node) => (
            <OutlineNodeItem
              key={node.id}
              node={node}
              childrenOf={childrenOf}
              isExpanded={isExpanded}
              isLoading={isLoading}
              onToggle={handleToggle}
              onLoadMore={handleLoadMore}
            />
          ))}
        </ul>
      ) : ACTIVE_STATUSES.has(extraction.status) || extraction.status === 'skipped' || extraction.status === 'failed' ? null : (
        <EmptyState
          variant="subtle"
          size="sm"
          icon={<FileSearch className="size-5" aria-hidden="true" />}
          title={t('attachments.structure.outline.empty', 'No headings were found in this document.')}
        />
      )}
    </div>
  )
}

export default DocumentStructurePanel
