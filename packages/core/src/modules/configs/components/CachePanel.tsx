"use client"

import * as React from 'react'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { Button } from '@open-mercato/ui/primitives/button'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@/lib/i18n/context'

const API_PATH = '/api/configs/cache'

type CrudCacheSegment = {
  segment: string
  resource: string | null
  method: string | null
  path: string | null
  keyCount: number
}

type CrudCacheStats = {
  generatedAt: string
  totalKeys: number
  segments: CrudCacheSegment[]
}

type FetchState = {
  loading: boolean
  error: string | null
  stats: CrudCacheStats | null
}

export function CachePanel() {
  const t = useT()
  const [state, setState] = React.useState<FetchState>({ loading: true, error: null, stats: null })
  const [canManage, setCanManage] = React.useState(false)
  const [checkingFeature, setCheckingFeature] = React.useState(true)
  const [purgingAll, setPurgingAll] = React.useState(false)
  const [segmentPurges, setSegmentPurges] = React.useState<Record<string, boolean>>({})

  const loadStats = React.useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: null }))
    try {
      const response = await apiFetch(API_PATH)
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || typeof payload?.generatedAt !== 'string') {
        const message =
          typeof payload?.error === 'string'
            ? payload.error
            : t('configs.cache.loadError', 'Failed to load cache statistics.')
        setState({ loading: false, error: message, stats: null })
        return
      }
      setState({ loading: false, error: null, stats: payload as CrudCacheStats })
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : t('configs.cache.loadError', 'Failed to load cache statistics.')
      setState({ loading: false, error: message, stats: null })
    }
  }, [t])

  React.useEffect(() => {
    loadStats().catch(() => {})
  }, [loadStats])

  React.useEffect(() => {
    let cancelled = false
    async function checkManageFeature() {
      try {
        const response = await apiFetch('/api/auth/feature-check', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ features: ['configs.cache.manage', 'configs.manage'] }),
        })
        const payload = await response.json().catch(() => ({}))
        if (cancelled) return
        const granted = Array.isArray(payload?.granted)
          ? (payload.granted as unknown[]).filter((feature) => typeof feature === 'string') as string[]
          : []
        const hasFeature =
          payload?.ok === true ||
          granted.includes('configs.cache.manage') ||
          granted.includes('configs.manage')
        setCanManage(hasFeature)
      } catch {
        if (!cancelled) setCanManage(false)
      } finally {
        if (!cancelled) setCheckingFeature(false)
      }
    }
    checkManageFeature().catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const handleRefresh = React.useCallback(() => {
    loadStats().catch(() => {})
  }, [loadStats])

  const handlePurgeAll = React.useCallback(async () => {
    if (!canManage || purgingAll) return
    if (typeof window !== 'undefined') {
      const confirmed = window.confirm(
        t('configs.cache.purgeAllConfirm', 'Purge all cached entries for this tenant?'))
    setPurgingAll(true)
    try {
      const response = await apiFetch(API_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'purgeAll' }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        const message =
          typeof payload?.error === 'string'
            ? payload.error
            : t('configs.cache.purgeError', 'Failed to purge cache segment.')
        flash(message, 'error')
        return
      }
      const stats = payload?.stats as CrudCacheStats | undefined
      if (stats) setState({ loading: false, error: null, stats })
      else handleRefresh()
      flash(t('configs.cache.purgeAllSuccess', 'Cache cleared.'), 'success')
      setSegmentPurges({})
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : t('configs.cache.purgeError', 'Failed to purge cache segment.')
      flash(message, 'error')
    } finally {
      setPurgingAll(false)
    }
  }, [canManage, purgingAll, t, handleRefresh])

  const handlePurgeSegment = React.useCallback(async (segment: string) => {
    if (!canManage || segmentPurges[segment]) return
    if (typeof window !== 'undefined') {
      const confirmed = window.confirm(
        t('configs.cache.purgeSegmentConfirm', 'Purge cached entries for this segment?')
      )
      if (!confirmed) return
    }
    setSegmentPurges((prev) => ({ ...prev, [segment]: true }))
    try {
      const response = await apiFetch(API_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'purgeSegment', segment }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        const message =
          typeof payload?.error === 'string'
            ? payload.error
            : t('configs.cache.purgeError', 'Failed to purge cache segment.')
        flash(message, 'error')
        return
      }
      const stats = payload?.stats as CrudCacheStats | undefined
      if (stats) setState({ loading: false, error: null, stats })
      else handleRefresh()
      const deleted = typeof payload?.deleted === 'number' ? payload.deleted : 0
      flash(
        t('configs.cache.purgeSegmentSuccess', {
          segment,
          count: deleted,
        }),
        'success'
      )
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : t('configs.cache.purgeError', 'Failed to purge cache segment.')
      flash(message, 'error')
    } finally {
      setSegmentPurges((prev) => {
        const next = { ...prev }
        delete next[segment]
        return next
      })
    }
  }, [canManage, segmentPurges, t, handleRefresh])

  if (state.loading) {
    return (
      <section className="space-y-3 rounded-lg border bg-background p-6">
        <header className="space-y-1">
          <h2 className="text-lg font-semibold">{t('configs.cache.title', 'Cache overview')}</h2>
          <p className="text-sm text-muted-foreground">
            {t('configs.cache.description', 'Inspect cached CRUD responses and clear segments when necessary.')}
          </p>
        </header>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="h-4 w-4" />
          {t('configs.cache.loading', 'Loading cache statistics…')}
        </div>
      </section>
    )
  }

  if (state.error) {
    return (
      <section className="space-y-3 rounded-lg border bg-background p-6">
        <header className="space-y-1">
          <h2 className="text-lg font-semibold">{t('configs.cache.title', 'Cache overview')}</h2>
          <p className="text-sm text-muted-foreground">
            {t('configs.cache.description', 'Inspect cached CRUD responses and clear segments when necessary.')}
          </p>
        </header>
        <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {state.error}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={handleRefresh}>
            {t('configs.cache.retry', 'Retry')}
          </Button>
        </div>
      </section>
    )
  }

  const stats = state.stats
  const canShowActions = !checkingFeature && canManage

  return (
    <section className="space-y-6 rounded-lg border bg-background p-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">{t('configs.cache.title', 'Cache overview')}</h2>
          <p className="text-sm text-muted-foreground">
            {t('configs.cache.description', 'Inspect cached CRUD responses and clear segments when necessary.')}
          </p>
          {stats ? (
            <>
              <p className="text-xs text-muted-foreground">
                {t(
                  'configs.cache.generatedAt',
                  'Stats generated {{timestamp}}',
                  { timestamp: new Date(stats.generatedAt).toLocaleString() }
                )}
              </p>
              <p className="text-xs text-muted-foreground">
                {t(
                  'configs.cache.totalEntries',
                  '{{count}} cached entries',
                  { count: stats.totalKeys }
                )}
              </p>
            </>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handleRefresh}>
            {t('configs.cache.refresh', 'Refresh')}
          </Button>
          {canShowActions ? (
            <Button variant="destructive" disabled={purgingAll} onClick={() => { void handlePurgeAll() }}>
              {purgingAll
                ? t('configs.cache.purgeAllLoading', 'Purging…')
                : t('configs.cache.purgeAll', 'Purge all cache')}
            </Button>
          ) : null}
        </div>
      </header>
      <div className="space-y-4 rounded-lg border bg-card p-4">
        {stats && stats.segments.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 text-left">
                    {t('configs.cache.table.segment', 'Segment')}
                  </th>
                  <th className="px-3 py-2 text-left">
                    {t('configs.cache.table.path', 'Path')}
                  </th>
                  <th className="px-3 py-2 text-left">
                    {t('configs.cache.table.method', 'Method')}
                  </th>
                  <th className="px-3 py-2 text-left">
                    {t('configs.cache.table.count', 'Cached keys')}
                  </th>
                  {canShowActions ? (
                    <th className="px-3 py-2 text-right">
                      {t('configs.cache.table.actions', 'Actions')}
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {stats.segments.map((segment) => {
                  const isPurging = !!segmentPurges[segment.segment]
                  return (
                    <tr key={segment.segment} className="border-t">
                      <td className="px-3 py-2 align-top font-medium">
                        <div className="flex flex-col">
                          <span>{segment.segment}</span>
                          {segment.resource ? (
                            <span className="text-xs text-muted-foreground">{segment.resource}</span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-3 py-2 align-top">
                        <code className="text-xs text-muted-foreground">
                          {segment.path ?? t('configs.cache.table.pathUnknown', 'n/a')}
                        </code>
                      </td>
                      <td className="px-3 py-2 align-top">
                        <span className="text-xs uppercase text-muted-foreground">
                          {segment.method ?? 'GET'}
                        </span>
                      </td>
                      <td className="px-3 py-2 align-top">
                        {t('configs.cache.table.countValue', '{{count}} keys', { count: segment.keyCount })}
                      </td>
                      {canShowActions ? (
                        <td className="px-3 py-2 align-top text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={isPurging}
                            onClick={() => { void handlePurgeSegment(segment.segment) }}
                          >
                            {isPurging
                              ? t('configs.cache.purgeSegmentLoading', 'Purging…')
                              : t('configs.cache.purgeSegment', 'Purge segment')}
                          </Button>
                        </td>
                      ) : null}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t('configs.cache.empty', 'No cached CRUD responses for this tenant.')}
          </p>
        )}
      </div>
    </section>
  )
}

export default CachePanel
