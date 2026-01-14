'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@open-mercato/ui/primitives/tabs'

// Types
type FulltextStats = {
  numberOfDocuments: number
  isIndexing: boolean
  fieldDistribution: Record<string, number>
}

type ReindexLock = {
  type: 'fulltext' | 'vector'
  action: string
  startedAt: string
  elapsedMinutes: number
}

type FulltextEnvVarStatus = {
  set: boolean
  hint: string
}

type FulltextOptionalEnvVarStatus = {
  set: boolean
  value?: string | boolean
  default?: string | boolean
  hint: string
}

type FulltextConfigResponse = {
  driver: 'meilisearch' | null
  configured: boolean
  envVars: {
    MEILISEARCH_HOST: FulltextEnvVarStatus
    MEILISEARCH_API_KEY: FulltextEnvVarStatus
  }
  optionalEnvVars: {
    MEILISEARCH_INDEX_PREFIX: FulltextOptionalEnvVarStatus
    SEARCH_EXCLUDE_ENCRYPTED_FIELDS: FulltextOptionalEnvVarStatus
  }
}

type ReindexResponse = {
  ok: boolean
  action: string
  entityId?: string | null
  result?: {
    entitiesProcessed: number
    recordsIndexed: number
    errors?: Array<{ entityId: string; error: string }>
  }
  stats?: FulltextStats | null
  error?: string
}

type ReindexAction = 'clear' | 'recreate' | 'reindex'

type ActivityLog = {
  id: string
  source: string
  handler: string
  level: 'info' | 'error' | 'warn'
  entityType: string | null
  recordId: string | null
  message: string
  details: unknown
  occurredAt: string
}

export type FulltextSearchSectionProps = {
  fulltextConfig: FulltextConfigResponse | null
  fulltextConfigLoading: boolean
  fulltextStats: FulltextStats | null
  fulltextReindexLock: ReindexLock | null
  loading: boolean
  onStatsUpdate: (stats: FulltextStats | null) => void
  onRefresh: () => Promise<void>
}

const normalizeErrorMessage = (error: unknown, fallback: string): string => {
  if (typeof error === 'string' && error.trim().length) return error.trim()
  if (error instanceof Error && error.message.trim().length) return error.message.trim()
  return fallback
}

export function FulltextSearchSection({
  fulltextConfig,
  fulltextConfigLoading,
  fulltextStats,
  fulltextReindexLock,
  loading,
  onStatsUpdate,
  onRefresh,
}: FulltextSearchSectionProps) {
  const t = useT()
  const [reindexing, setReindexing] = React.useState<ReindexAction | null>(null)
  const [showReindexDialog, setShowReindexDialog] = React.useState<ReindexAction | null>(null)
  const [activityLogs, setActivityLogs] = React.useState<ActivityLog[]>([])
  const [activityLoading, setActivityLoading] = React.useState(true)

  // Fetch activity logs
  const fetchActivityLogs = React.useCallback(async () => {
    setActivityLoading(true)
    try {
      const response = await fetch('/api/query_index/status')
      if (response.ok) {
        const body = await response.json() as { logs?: ActivityLog[]; errors?: ActivityLog[] }
        // Combine logs and errors
        const allLogs: ActivityLog[] = []
        if (body.logs) {
          allLogs.push(...body.logs)
        }
        if (body.errors) {
          allLogs.push(...body.errors.map(err => ({ ...err, level: 'error' as const })))
        }
        // Filter for fulltext-related logs (exclude vector/embedding related)
        const fulltextLogs = allLogs.filter(log => {
          const lowerSource = log.source?.toLowerCase() ?? ''
          const lowerMessage = log.message?.toLowerCase() ?? ''
          const lowerHandler = log.handler?.toLowerCase() ?? ''
          const isVector = lowerSource.includes('vector') || lowerMessage.includes('vector') ||
            lowerMessage.includes('embedding') || lowerHandler.includes('vector')
          return !isVector
        })
        // Sort by occurredAt descending
        fulltextLogs.sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())
        setActivityLogs(fulltextLogs.slice(0, 50))
      }
    } catch {
      // Silently fail
    } finally {
      setActivityLoading(false)
    }
  }, [])

  React.useEffect(() => {
    fetchActivityLogs()
  }, [fetchActivityLogs])

  // Poll for activity when reindexing
  React.useEffect(() => {
    if (fulltextReindexLock || reindexing) {
      const interval = setInterval(fetchActivityLogs, 5000)
      return () => clearInterval(interval)
    }
  }, [fulltextReindexLock, reindexing, fetchActivityLogs])

  const handleReindexClick = (action: ReindexAction) => {
    setShowReindexDialog(action)
  }

  const handleReindexCancel = () => {
    setShowReindexDialog(null)
  }

  const handleReindexConfirm = React.useCallback(async () => {
    const action = showReindexDialog
    if (!action) return

    setShowReindexDialog(null)
    setReindexing(action)

    try {
      const response = await fetch('/api/search/reindex', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, useQueue: action === 'reindex' }),
      })

      const body = await response.json() as ReindexResponse

      if (!response.ok || body.error) {
        throw new Error(body.error || t('search.settings.reindexErrorLabel', 'Failed to reindex'))
      }

      if (body.stats) {
        onStatsUpdate(body.stats)
      }

      const successLabel = t('search.settings.reindexSuccessLabel', 'Operation completed successfully')
      const successMessage = action === 'reindex' && body.result
        ? `${successLabel}: ${body.result.recordsIndexed} documents indexed`
        : successLabel

      flash(successMessage, 'success')
      await onRefresh()
      await fetchActivityLogs()
    } catch (err) {
      const message = normalizeErrorMessage(err, t('search.settings.reindexErrorLabel', 'Failed to reindex'))
      flash(message, 'error')
    } finally {
      setReindexing(null)
    }
  }, [showReindexDialog, t, onStatsUpdate, onRefresh, fetchActivityLogs])

  const getDialogContent = (action: ReindexAction) => {
    switch (action) {
      case 'clear':
        return {
          title: t('search.settings.clearIndexDialogTitle', 'Clear Index'),
          description: t('search.settings.clearIndexDialogDescription', 'This will remove all documents from the Meilisearch index but keep the index settings.'),
          warning: t('search.settings.clearIndexDialogWarning', 'Search will not work until documents are re-indexed.'),
          confirmLabel: t('search.settings.clearIndexLabel', 'Clear Index'),
        }
      case 'recreate':
        return {
          title: t('search.settings.recreateIndexDialogTitle', 'Recreate Index'),
          description: t('search.settings.recreateIndexDialogDescription', 'This will delete the index completely and recreate it with fresh settings.'),
          warning: t('search.settings.recreateIndexDialogWarning', 'All indexed documents will be permanently removed.'),
          confirmLabel: t('search.settings.recreateIndexLabel', 'Recreate Index'),
        }
      case 'reindex':
        return {
          title: t('search.settings.fullReindexDialogTitle', 'Full Reindex'),
          description: t('search.settings.fullReindexDialogDescription', 'This will recreate the index and re-index all data from the database.'),
          warning: t('search.settings.fullReindexDialogWarning', 'This operation may take a while depending on the amount of data.'),
          confirmLabel: t('search.settings.fullReindexLabel', 'Full Reindex'),
        }
    }
  }

  const getStrategyIcon = () => (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
    </svg>
  )

  return (
    <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <h2 className="text-lg font-semibold mb-2">
        {t('search.settings.fulltext.sectionTitle', 'Full-Text Search')}
      </h2>
      <p className="text-sm text-muted-foreground mb-4">
        {t('search.settings.fulltext.sectionDescription', 'Fast, typo-tolerant search using Meilisearch.')}
      </p>

      <Tabs defaultValue="configuration">
        <TabsList className="mb-4">
          <TabsTrigger value="configuration">
            {t('search.settings.tabs.configuration', 'Configuration')}
          </TabsTrigger>
          <TabsTrigger value="index">
            {t('search.settings.tabs.indexManagement', 'Index Management')}
          </TabsTrigger>
          <TabsTrigger value="activity">
            {t('search.settings.tabs.activity', 'Activity')}
          </TabsTrigger>
        </TabsList>

        {/* Configuration Tab */}
        <TabsContent value="configuration">
          {fulltextConfigLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Spinner size="sm" />
              <span>{t('search.settings.loadingLabel', 'Loading settings...')}</span>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Driver Status */}
              <div className="flex items-center gap-3 p-3 rounded-md border border-border bg-muted/30">
                <div className={`flex h-10 w-10 items-center justify-center rounded-full ${
                  fulltextConfig?.configured
                    ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400'
                    : 'bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400'
                }`}>
                  {getStrategyIcon()}
                </div>
                <div>
                  <p className="font-medium">
                    {t('search.settings.fulltext.driver', 'Current Driver')}: {fulltextConfig?.driver ? 'Meilisearch' : t('search.settings.fulltext.noDriver', 'None')}
                  </p>
                  <p className={`text-sm ${
                    fulltextConfig?.configured
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-amber-600 dark:text-amber-400'
                  }`}>
                    {fulltextConfig?.configured
                      ? t('search.settings.fulltext.ready', 'Ready to use')
                      : t('search.settings.fulltext.notReady', 'Not configured - set environment variables below')}
                  </p>
                </div>
              </div>

              {/* Required Environment Variables */}
              <div>
                <h3 className="text-sm font-semibold mb-2">
                  {t('search.settings.fulltext.envVars', 'Required Environment Variables')}
                </h3>
                <div className="space-y-2">
                  {fulltextConfig?.envVars && Object.entries(fulltextConfig.envVars).map(([key, status]) => (
                    <div key={key} className="flex items-start gap-3 p-3 rounded-md border border-border">
                      <div className={`flex h-5 w-5 items-center justify-center rounded-full flex-shrink-0 mt-0.5 ${
                        status.set
                          ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400'
                          : 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400'
                      }`}>
                        {status.set ? (
                          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        ) : (
                          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        )}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <code className="text-sm font-mono bg-muted px-1.5 py-0.5 rounded">{key}</code>
                          <span className={`text-xs ${status.set ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                            {status.set ? t('search.settings.fulltext.envSet', 'Set') : t('search.settings.fulltext.envMissing', 'Missing')}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">{status.hint}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Optional Settings */}
              <div>
                <h3 className="text-sm font-semibold mb-2">
                  {t('search.settings.fulltext.optional', 'Optional Settings')}
                </h3>
                <div className="space-y-2">
                  {fulltextConfig?.optionalEnvVars && Object.entries(fulltextConfig.optionalEnvVars).map(([key, status]) => (
                    <div key={key} className="flex items-start gap-3 p-2 rounded-md bg-muted/30">
                      <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">{key}</code>
                      <div className="flex-1 text-xs text-muted-foreground">
                        <span>{status.hint}</span>
                        {status.set ? (
                          <span className="ml-2 text-emerald-600 dark:text-emerald-400">
                            ({t('search.settings.fulltext.currentValue', 'Current')}: {String(status.value)})
                          </span>
                        ) : (
                          <span className="ml-2">
                            ({t('search.settings.fulltext.defaultValue', 'Default')}: {String(status.default)})
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Setup Instructions */}
              <div className="p-3 rounded-md bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
                <div className="flex items-start gap-2">
                  <svg className="h-5 w-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div className="text-sm text-blue-800 dark:text-blue-200">
                    <p className="font-medium mb-1">{t('search.settings.fulltext.howTo', 'How to set up')}</p>
                    <p className="text-xs">{t('search.settings.fulltext.howToDescription', 'Add these variables to your .env file or deployment environment. You can use a hosted Meilisearch instance or run it locally with Docker.')}</p>
                    <a
                      href="https://www.meilisearch.com/docs/learn/getting_started/quick_start"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-600 dark:text-blue-400 hover:underline mt-1 inline-block"
                    >
                      {t('search.settings.fulltext.learnMore', 'Learn more: Meilisearch Quick Start')} →
                    </a>
                  </div>
                </div>
              </div>
            </div>
          )}
        </TabsContent>

        {/* Index Management Tab */}
        <TabsContent value="index">
          {(loading || fulltextConfigLoading) ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Spinner size="sm" />
              <span>{t('search.settings.loadingLabel', 'Loading settings...')}</span>
            </div>
          ) : !fulltextConfig?.configured ? (
            <div className="p-4 rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
              <div className="flex items-start gap-3">
                <svg className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <div>
                  <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                    {t('search.settings.fulltextNotConfigured', 'Full-text search driver not configured')}
                  </p>
                  <p className="text-xs text-amber-700 dark:text-amber-300 mt-1">
                    {t('search.settings.fulltextNotConfiguredHint', 'Configure the required environment variables in the Configuration tab to enable indexing.')}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Stats */}
              {fulltextStats ? (
                <div className="rounded-md border border-border p-4 max-w-xs">
                  <p className="text-sm text-muted-foreground">{t('search.settings.documentsLabel', 'Documents')}</p>
                  <p className="text-2xl font-bold">{fulltextStats.numberOfDocuments.toLocaleString()}</p>
                </div>
              ) : (
                <div className="p-3 rounded-md bg-muted/50">
                  <p className="text-sm text-muted-foreground">
                    {t('search.settings.noIndexMessage', "No index found for this tenant. Click 'Full Reindex' to create one.")}
                  </p>
                </div>
              )}

              {/* Active reindex lock banner */}
              {fulltextReindexLock && (
                <div className="p-4 rounded-md bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
                  <div className="flex items-start gap-3">
                    <Spinner size="sm" className="flex-shrink-0 mt-0.5 text-blue-600 dark:text-blue-400" />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-blue-800 dark:text-blue-200">
                        {t('search.settings.reindexInProgress', 'Reindex operation in progress')}
                      </p>
                      <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">
                        {t('search.settings.reindexInProgressDetails', 'Action: {{action}} | Started {{minutes}} minutes ago', {
                          action: fulltextReindexLock.action,
                          minutes: fulltextReindexLock.elapsedMinutes,
                        })}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex flex-wrap gap-3 pt-2">
                {fulltextStats && (
                  <>
                    <div className="flex flex-col">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => handleReindexClick('clear')}
                        disabled={reindexing !== null || fulltextReindexLock !== null}
                      >
                        {reindexing === 'clear' ? (
                          <>
                            <Spinner size="sm" className="mr-2" />
                            {t('search.settings.processingLabel', 'Processing...')}
                          </>
                        ) : (
                          t('search.settings.clearIndexLabel', 'Clear Index')
                        )}
                      </Button>
                      <span className="text-xs text-muted-foreground mt-1">
                        {t('search.settings.clearIndexDescription', 'Remove all documents but keep index settings')}
                      </span>
                    </div>
                    <div className="flex flex-col">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => handleReindexClick('recreate')}
                        disabled={reindexing !== null || fulltextReindexLock !== null}
                      >
                        {reindexing === 'recreate' ? (
                          <>
                            <Spinner size="sm" className="mr-2" />
                            {t('search.settings.processingLabel', 'Processing...')}
                          </>
                        ) : (
                          t('search.settings.recreateIndexLabel', 'Recreate Index')
                        )}
                      </Button>
                      <span className="text-xs text-muted-foreground mt-1">
                        {t('search.settings.recreateIndexDescription', 'Delete and recreate the index with fresh settings')}
                      </span>
                    </div>
                  </>
                )}
                <div className="flex flex-col">
                  <Button
                    type="button"
                    variant="default"
                    size="sm"
                    onClick={() => handleReindexClick('reindex')}
                    disabled={reindexing !== null || fulltextReindexLock !== null}
                  >
                    {reindexing === 'reindex' || fulltextReindexLock !== null ? (
                      <>
                        <Spinner size="sm" className="mr-2" />
                        {t('search.settings.processingLabel', 'Processing...')}
                      </>
                    ) : (
                      t('search.settings.fullReindexLabel', 'Full Reindex')
                    )}
                  </Button>
                  <span className="text-xs text-muted-foreground mt-1">
                    {t('search.settings.fullReindexDescription', 'Recreate index and re-index all data from database')}
                  </span>
                </div>
              </div>
            </div>
          )}
        </TabsContent>

        {/* Activity Tab */}
        <TabsContent value="activity">
          {activityLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Spinner size="sm" />
              <span>{t('search.settings.loadingLabel', 'Loading...')}</span>
            </div>
          ) : activityLogs.length === 0 ? (
            <div className="p-4 rounded-md bg-muted/50 text-center">
              <p className="text-sm text-muted-foreground">
                {t('search.settings.activity.noLogs', 'No recent indexing activity')}
              </p>
            </div>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {activityLogs.map((log) => (
                <div
                  key={log.id}
                  className={`p-2 rounded-md text-sm ${
                    log.level === 'error'
                      ? 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800'
                      : 'bg-muted/50'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    {log.level === 'error' && (
                      <svg className="h-4 w-4 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs ${log.level === 'error' ? 'text-red-800 dark:text-red-200' : 'text-foreground'}`}>
                        {log.message}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {(() => {
                          const d = new Date(log.occurredAt)
                          const pad = (n: number) => n.toString().padStart(2, '0')
                          return `${pad(d.getDate())}-${pad(d.getMonth() + 1)}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
                        })()}
                        {log.entityType && ` · ${log.entityType}`}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="mt-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={fetchActivityLogs}
              disabled={activityLoading}
            >
              {activityLoading ? (
                <>
                  <Spinner size="sm" className="mr-2" />
                  {t('search.settings.loadingLabel', 'Loading...')}
                </>
              ) : (
                t('search.settings.refreshLabel', 'Refresh')
              )}
            </Button>
          </div>
        </TabsContent>
      </Tabs>

      {/* Reindex Confirmation Dialog */}
      {showReindexDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 max-w-md rounded-lg border border-border bg-card p-6 shadow-lg">
            <div className="flex items-start gap-3 mb-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/40">
                <svg className="h-5 w-5 text-amber-600 dark:text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-semibold">{getDialogContent(showReindexDialog).title}</h3>
                <p className="text-sm text-muted-foreground mt-1">{getDialogContent(showReindexDialog).description}</p>
              </div>
            </div>

            <div className="mb-4 p-3 rounded-md bg-amber-50 dark:bg-amber-900/20">
              <div className="flex items-start gap-2">
                <svg className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <p className="text-sm text-amber-800 dark:text-amber-200">{getDialogContent(showReindexDialog).warning}</p>
              </div>
            </div>

            <div className="flex justify-end gap-3">
              <Button type="button" variant="outline" onClick={handleReindexCancel}>
                {t('search.settings.cancelLabel', 'Cancel')}
              </Button>
              <Button
                type="button"
                variant={showReindexDialog === 'reindex' ? 'default' : 'destructive'}
                onClick={handleReindexConfirm}
              >
                {getDialogContent(showReindexDialog).confirmLabel}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default FulltextSearchSection
