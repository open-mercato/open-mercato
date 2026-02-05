"use client"

import * as React from 'react'
import { ChevronLeft, Clock, Loader2, RotateCcw, Undo2, X } from 'lucide-react'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import type { VersionHistoryEntry } from './types'
import { VersionHistoryDetail } from './VersionHistoryDetail'
import { formatDate } from '@open-mercato/core/modules/audit_logs/lib/display-helpers'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { markRedoConsumed, markUndoSuccess } from '@open-mercato/ui/backend/operations/store'
import { getVersionHistoryStatusLabel } from './labels'

export type VersionHistoryPanelProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  entries: VersionHistoryEntry[]
  isLoading: boolean
  error: string | null
  hasMore: boolean
  onLoadMore: () => void
  t: TranslateFn
  /** Explicit override — when provided, skips auto-check and uses this value directly. */
  canUndoRedo?: boolean
  /** When true (default), auto-checks audit_logs.undo_self / redo_self features for the current user. Ignored when canUndoRedo is provided. */
  autoCheckAcl?: boolean
}

const UNDO_REDO_FEATURES = ['audit_logs.undo_self', 'audit_logs.redo_self']

type FeatureCheckResponse = { ok: boolean; granted: string[] }

export function VersionHistoryPanel({
  open,
  onOpenChange,
  entries,
  isLoading,
  error,
  hasMore,
  onLoadMore,
  t,
  canUndoRedo,
  autoCheckAcl = true,
}: VersionHistoryPanelProps) {
  const [aclGranted, setAclGranted] = React.useState<boolean | null>(null)

  React.useEffect(() => {
    if (canUndoRedo !== undefined || !autoCheckAcl || !open) return
    let cancelled = false
    void (async () => {
      try {
        const res = await apiCall<FeatureCheckResponse>('/api/auth/feature-check', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ features: UNDO_REDO_FEATURES }),
        })
        if (!cancelled && res.ok) {
          const granted = res.result?.granted ?? []
          setAclGranted(granted.length > 0)
        }
      } catch {
        if (!cancelled) setAclGranted(false)
      }
    })()
    return () => { cancelled = true }
  }, [open, canUndoRedo, autoCheckAcl])

  const effectiveCanUndoRedo = canUndoRedo ?? (autoCheckAcl ? (aclGranted ?? false) : true)

  const [selectedEntry, setSelectedEntry] = React.useState<VersionHistoryEntry | null>(null)
  const [undoingToken, setUndoingToken] = React.useState<string | null>(null)
  const [redoingId, setRedoingId] = React.useState<string | null>(null)
  const latestUndoableId = React.useMemo(() => {
    const latest = entries.find((entry) => entry.undoToken && entry.executionState === 'done')
    return latest?.id ?? null
  }, [entries])
  const latestUndoneId = React.useMemo(() => {
    const undone = entries.filter((entry) => entry.executionState === 'undone')
    if (!undone.length) return null
    const sorted = [...undone].sort((a, b) => {
      const aTs = Date.parse(a.updatedAt)
      const bTs = Date.parse(b.updatedAt)
      return (Number.isFinite(bTs) ? bTs : 0) - (Number.isFinite(aTs) ? aTs : 0)
    })
    return sorted[0]?.id ?? null
  }, [entries])

  React.useEffect(() => {
    if (!open) setSelectedEntry(null)
  }, [open])

  React.useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && open) {
        onOpenChange(false)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, onOpenChange])

  const handleUndo = React.useCallback(async (token: string | null) => {
    if (!token) return
    setUndoingToken(token)
    try {
      await apiCallOrThrow('/api/audit_logs/audit-logs/actions/undo', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ undoToken: token }),
      }, { errorMessage: t('audit_logs.error.undo') })
      markUndoSuccess(token)
      if (typeof window !== 'undefined') {
        window.location.reload()
      }
    } catch (err) {
      console.error(t('audit_logs.actions.undo'), err)
    } finally {
      setUndoingToken(null)
    }
  }, [t])

  const handleRedo = React.useCallback(async (logId: string | null) => {
    if (!logId) return
    setRedoingId(logId)
    try {
      await apiCallOrThrow('/api/audit_logs/audit-logs/actions/redo', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ logId }),
      }, { errorMessage: t('audit_logs.error.redo') })
      markRedoConsumed(logId)
      if (typeof window !== 'undefined') {
        window.location.reload()
      }
    } catch (err) {
      console.error(t('audit_logs.actions.redo'), err)
    } finally {
      setRedoingId(null)
    }
  }, [t])

  if (!open) return null

  const isEmpty = entries.length === 0 && !isLoading && !error
  const isInitialLoading = entries.length === 0 && isLoading
  const isInitialError = entries.length === 0 && !!error

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/20"
        onClick={() => onOpenChange(false)}
        aria-hidden="true"
      />
      <div
        className="fixed right-0 top-0 z-50 h-full w-full max-w-md border-l bg-background shadow-lg"
        role="dialog"
        aria-modal="true"
        aria-label={t('audit_logs.version_history.title')}
      >
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <div className="flex items-center gap-2">
              {selectedEntry ? (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setSelectedEntry(null)}
                  aria-label={t('audit_logs.version_history.detail.back')}
                >
                  <ChevronLeft className="h-5 w-5" />
                </Button>
              ) : (
                <Clock className="h-5 w-5" />
              )}
              <h2 className="font-semibold">
                {selectedEntry
                  ? t('audit_logs.version_history.detail.title')
                  : t('audit_logs.version_history.title')}
              </h2>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onOpenChange(false)}
              aria-label={t('audit_logs.version_history.close')}
            >
              <X className="h-5 w-5" />
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-4">
            {selectedEntry ? (
              <VersionHistoryDetail entry={selectedEntry} t={t} />
            ) : (
              <div className="space-y-3">
                {isInitialLoading ? (
                  <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                    <Loader2 className="mb-2 h-8 w-8 animate-spin" />
                    <p>{t('audit_logs.version_history.loading')}</p>
                  </div>
                ) : null}

                {isInitialError ? (
                  <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
                    <p>{t('audit_logs.version_history.error')}</p>
                    <Button variant="ghost" size="sm" onClick={onLoadMore}>
                      {t('audit_logs.common.refresh')}
                    </Button>
                  </div>
                ) : null}

                {isEmpty ? (
                  <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                    <Clock className="mb-2 h-8 w-8 opacity-50" />
                    <p>{t('audit_logs.version_history.empty')}</p>
                  </div>
                ) : null}

                {entries.length > 0 ? (
                  <div className="divide-y rounded-lg border">
                    {entries.map((entry) => {
                      const statusLabel = getVersionHistoryStatusLabel(entry.executionState, t)
                      const canUndo = effectiveCanUndoRedo
                        && Boolean(entry.undoToken)
                        && entry.executionState === 'done'
                        && entry.id === latestUndoableId
                      const showRedo = effectiveCanUndoRedo && entry.executionState === 'undone'
                      const canRedo = showRedo && entry.id === latestUndoneId
                      return (
                        <div
                          key={entry.id}
                          className="flex items-start justify-between gap-3 px-4 py-3 transition-colors hover:bg-muted/40"
                        >
                          <button
                            type="button"
                            onClick={() => setSelectedEntry(entry)}
                            className="flex flex-1 flex-col gap-1 text-left"
                          >
                            <div className="text-sm font-medium">
                              {entry.actionLabel || entry.commandId}
                            </div>
                            <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                              <span>{entry.actorUserName || entry.actorUserId || t('audit_logs.common.none')}</span>
                              <span>•</span>
                              <span>{formatDate(entry.createdAt)}</span>
                              <span>•</span>
                              <span>{statusLabel}</span>
                            </div>
                          </button>
                          <div className="flex items-center gap-1 pt-1">
                            {canUndo ? (
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label={t('audit_logs.actions.undo')}
                                onClick={(event) => {
                                  event.stopPropagation()
                                  void handleUndo(entry.undoToken)
                                }}
                                disabled={undoingToken === entry.undoToken || Boolean(redoingId)}
                              >
                                <Undo2 className="size-4" aria-hidden="true" />
                              </Button>
                            ) : null}
                            {showRedo ? (
                              <Button
                                variant="ghost"
                                size="icon"
                                aria-label={t('audit_logs.actions.redo')}
                                onClick={(event) => {
                                  event.stopPropagation()
                                  void handleRedo(entry.id)
                                }}
                                disabled={!canRedo || redoingId === entry.id || Boolean(undoingToken)}
                              >
                                <RotateCcw className="size-4" aria-hidden="true" />
                              </Button>
                            ) : null}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : null}

                {error && entries.length > 0 ? (
                  <div className="text-xs text-red-500">{error}</div>
                ) : null}

                {hasMore ? (
                  <div className="pt-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={onLoadMore}
                      disabled={isLoading}
                    >
                      {isLoading ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : null}
                      {t('audit_logs.version_history.load_more')}
                    </Button>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
