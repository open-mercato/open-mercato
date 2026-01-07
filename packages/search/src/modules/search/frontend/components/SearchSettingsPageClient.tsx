'use client'

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Button } from '@open-mercato/ui/primitives/button'
import { Spinner } from '@open-mercato/ui/primitives/spinner'

type StrategyStatus = {
  id: string
  name: string
  priority: number
  available: boolean
}

type MeilisearchStats = {
  numberOfDocuments: number
  isIndexing: boolean
  fieldDistribution: Record<string, number>
}

type SearchSettings = {
  strategies: StrategyStatus[]
  meilisearchConfigured: boolean
  meilisearchStats: MeilisearchStats | null
  vectorConfigured: boolean
  tokensEnabled: boolean
  defaultStrategies: string[]
}

type SettingsResponse = {
  settings?: SearchSettings
  error?: string
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
  stats?: MeilisearchStats | null
  error?: string
}

type ReindexAction = 'clear' | 'recreate' | 'reindex'

const normalizeErrorMessage = (error: unknown, fallback: string): string => {
  if (typeof error === 'string' && error.trim().length) return error.trim()
  if (error instanceof Error && error.message.trim().length) return error.message.trim()
  return fallback
}

export function SearchSettingsPageClient() {
  const t = useT()
  const [settings, setSettings] = React.useState<SearchSettings | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [reindexing, setReindexing] = React.useState<ReindexAction | null>(null)
  const [showReindexDialog, setShowReindexDialog] = React.useState<ReindexAction | null>(null)

  const fetchSettings = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const body = await readApiResultOrThrow<SettingsResponse>(
        '/api/search/settings',
        undefined,
        { errorMessage: t('search.settings.errorLabel', 'Failed to load settings'), allowNullResult: true },
      )
      if (body?.settings) {
        setSettings(body.settings)
      } else {
        setSettings({
          strategies: [],
          meilisearchConfigured: false,
          meilisearchStats: null,
          vectorConfigured: false,
          tokensEnabled: true,
          defaultStrategies: [],
        })
      }
    } catch (err) {
      const message = normalizeErrorMessage(err, t('search.settings.errorLabel', 'Failed to load settings'))
      setError(message)
      flash(message, 'error')
    } finally {
      setLoading(false)
    }
  }, [t])

  React.useEffect(() => {
    fetchSettings()
  }, [fetchSettings])

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
        body: JSON.stringify({ action }),
      })

      const body = await response.json() as ReindexResponse

      if (!response.ok || body.error) {
        throw new Error(body.error || t('search.settings.reindexErrorLabel', 'Failed to reindex'))
      }

      // Update stats from response
      if (body.stats) {
        setSettings(prev => prev ? { ...prev, meilisearchStats: body.stats ?? null } : prev)
      }

      const successLabel = t('search.settings.reindexSuccessLabel', 'Operation completed successfully')
      const successMessage = action === 'reindex' && body.result
        ? `${successLabel}: ${body.result.recordsIndexed} documents indexed`
        : successLabel

      flash(successMessage, 'success')
      await fetchSettings()
    } catch (err) {
      const message = normalizeErrorMessage(err, t('search.settings.reindexErrorLabel', 'Failed to reindex'))
      flash(message, 'error')
    } finally {
      setReindexing(null)
    }
  }, [fetchSettings, showReindexDialog, t])

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

  const getStrategyIcon = (strategyId: string) => {
    switch (strategyId) {
      case 'meilisearch':
        return (
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
        )
      case 'vector':
        return (
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
          </svg>
        )
      case 'tokens':
        return (
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
          </svg>
        )
      default:
        return (
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
        )
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">{t('search.settings.pageTitle', 'Hybrid Search Settings')}</h1>
        <p className="text-muted-foreground">{t('search.settings.pageDescription', 'Configure search strategies and view their availability.')}</p>
      </div>

      {/* Configuration Status Card */}
      <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
        <h2 className="text-lg font-semibold mb-2">{t('search.settings.configurationTitle', 'Configuration Status')}</h2>
        <p className="text-sm text-muted-foreground mb-4">{t('search.settings.configurationDescription', 'Overview of search provider configurations.')}</p>

        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Spinner size="sm" />
            <span>{t('search.settings.loadingLabel', 'Loading settings...')}</span>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-3">
            {/* Meilisearch */}
            <div className="rounded-md border border-border p-4">
              <div className="flex items-center gap-3 mb-2">
                <div className={`flex h-8 w-8 items-center justify-center rounded-full ${
                  settings?.meilisearchConfigured
                    ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400'
                    : 'bg-muted text-muted-foreground'
                }`}>
                  {getStrategyIcon('meilisearch')}
                </div>
                <div>
                  <p className="font-medium">{t('search.settings.meilisearchLabel', 'Meilisearch')}</p>
                  <p className={`text-xs ${
                    settings?.meilisearchConfigured
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-muted-foreground'
                  }`}>
                    {settings?.meilisearchConfigured ? t('search.settings.configuredLabel', 'Configured') : t('search.settings.notConfiguredLabel', 'Not Configured')}
                  </p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">{t('search.settings.meilisearchHint', 'Set MEILISEARCH_HOST environment variable to enable.')}</p>
            </div>

            {/* Vector Search */}
            <div className="rounded-md border border-border p-4">
              <div className="flex items-center gap-3 mb-2">
                <div className={`flex h-8 w-8 items-center justify-center rounded-full ${
                  settings?.vectorConfigured
                    ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400'
                    : 'bg-muted text-muted-foreground'
                }`}>
                  {getStrategyIcon('vector')}
                </div>
                <div>
                  <p className="font-medium">{t('search.settings.vectorSearchLabel', 'Vector Search')}</p>
                  <p className={`text-xs ${
                    settings?.vectorConfigured
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-muted-foreground'
                  }`}>
                    {settings?.vectorConfigured ? t('search.settings.configuredLabel', 'Configured') : t('search.settings.notConfiguredLabel', 'Not Configured')}
                  </p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">{t('search.settings.vectorHint', 'Configure an embedding provider (OpenAI, Google, etc.) to enable.')}</p>
            </div>

            {/* Token Search */}
            <div className="rounded-md border border-border p-4">
              <div className="flex items-center gap-3 mb-2">
                <div className={`flex h-8 w-8 items-center justify-center rounded-full ${
                  settings?.tokensEnabled
                    ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900/40 dark:text-emerald-400'
                    : 'bg-muted text-muted-foreground'
                }`}>
                  {getStrategyIcon('tokens')}
                </div>
                <div>
                  <p className="font-medium">{t('search.settings.tokenSearchLabel', 'Token Search')}</p>
                  <p className={`text-xs ${
                    settings?.tokensEnabled
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-muted-foreground'
                  }`}>
                    {settings?.tokensEnabled ? t('search.settings.enabledLabel', 'Enabled') : t('search.settings.disabledLabel', 'Disabled')}
                  </p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">{t('search.settings.tokenHint', 'Built-in token search using PostgreSQL.')}</p>
            </div>
          </div>
        )}
      </div>

      {/* Meilisearch Index Management Card */}
      {settings?.meilisearchConfigured && (
        <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
          <h2 className="text-lg font-semibold mb-2">{t('search.settings.meilisearchIndexTitle', 'Meilisearch Index')}</h2>
          <p className="text-sm text-muted-foreground mb-4">{t('search.settings.meilisearchIndexDescription', 'Manage the Meilisearch index for this tenant.')}</p>

          {loading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Spinner size="sm" />
              <span>{t('search.settings.loadingLabel', 'Loading settings...')}</span>
            </div>
          ) : settings?.meilisearchStats ? (
            <div className="space-y-4">
              {/* Stats */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-md border border-border p-4">
                  <p className="text-sm text-muted-foreground">{t('search.settings.documentsLabel', 'Documents')}</p>
                  <p className="text-2xl font-bold">{settings.meilisearchStats.numberOfDocuments.toLocaleString()}</p>
                </div>
                <div className="rounded-md border border-border p-4">
                  <p className="text-sm text-muted-foreground">{t('search.settings.indexingLabel', 'Indexing')}</p>
                  <p className={`text-lg font-medium ${
                    settings.meilisearchStats.isIndexing
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'text-emerald-600 dark:text-emerald-400'
                  }`}>
                    {settings.meilisearchStats.isIndexing ? t('search.settings.indexingInProgressLabel', 'In Progress') : t('search.settings.indexingIdleLabel', 'Idle')}
                  </p>
                </div>
              </div>

              {/* Actions */}
              <div className="flex flex-wrap gap-3 pt-2">
                <div className="flex flex-col">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleReindexClick('clear')}
                    disabled={reindexing !== null}
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
                  <span className="text-xs text-muted-foreground mt-1">{t('search.settings.clearIndexDescription', 'Remove all documents but keep index settings')}</span>
                </div>
                <div className="flex flex-col">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleReindexClick('recreate')}
                    disabled={reindexing !== null}
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
                  <span className="text-xs text-muted-foreground mt-1">{t('search.settings.recreateIndexDescription', 'Delete and recreate the index with fresh settings')}</span>
                </div>
                <div className="flex flex-col">
                  <Button
                    type="button"
                    variant="default"
                    size="sm"
                    onClick={() => handleReindexClick('reindex')}
                    disabled={reindexing !== null}
                  >
                    {reindexing === 'reindex' ? (
                      <>
                        <Spinner size="sm" className="mr-2" />
                        {t('search.settings.processingLabel', 'Processing...')}
                      </>
                    ) : (
                      t('search.settings.fullReindexLabel', 'Full Reindex')
                    )}
                  </Button>
                  <span className="text-xs text-muted-foreground mt-1">{t('search.settings.fullReindexDescription', 'Recreate index and re-index all data from database')}</span>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t('search.settings.noIndexLabel', 'No index found for this tenant')}</p>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => fetchSettings()}
          disabled={loading}
        >
          {loading ? (
            <>
              <Spinner size="sm" className="mr-2" />
              {t('search.settings.loadingLabel', 'Loading settings...')}
            </>
          ) : (
            t('search.settings.refreshLabel', 'Refresh')
          )}
        </Button>
        {error && <span className="text-sm text-destructive">{error}</span>}
      </div>

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
              <Button
                type="button"
                variant="outline"
                onClick={handleReindexCancel}
              >
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

export default SearchSettingsPageClient
