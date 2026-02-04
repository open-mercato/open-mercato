"use client"

import * as React from 'react'
import { ChevronLeft, Clock, Loader2, X } from 'lucide-react'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import type { VersionHistoryEntry } from './types'
import { VersionHistoryDetail } from './VersionHistoryDetail'
import { formatDate } from '@open-mercato/core/modules/audit_logs/lib/display-helpers'

export type VersionHistoryPanelProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  entries: VersionHistoryEntry[]
  isLoading: boolean
  error: string | null
  hasMore: boolean
  onLoadMore: () => void
  t: TranslateFn
}

export function VersionHistoryPanel({
  open,
  onOpenChange,
  entries,
  isLoading,
  error,
  hasMore,
  onLoadMore,
  t,
}: VersionHistoryPanelProps) {
  const [selectedEntry, setSelectedEntry] = React.useState<VersionHistoryEntry | null>(null)

  React.useEffect(() => {
    if (!open) setSelectedEntry(null)
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
                    {entries.map((entry) => (
                      <button
                        key={entry.id}
                        type="button"
                        onClick={() => setSelectedEntry(entry)}
                        className="flex w-full flex-col gap-1 px-4 py-3 text-left transition-colors hover:bg-muted/40"
                      >
                        <div className="text-sm font-medium">
                          {entry.actionLabel || entry.commandId}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                          <span>{entry.actorUserName || entry.actorUserId || t('audit_logs.common.none')}</span>
                          <span>•</span>
                          <span>{formatDate(entry.createdAt)}</span>
                        </div>
                      </button>
                    ))}
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
