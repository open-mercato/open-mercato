'use client'

import React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { Button } from '@open-mercato/ui/primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { ActionLogItem } from '../../components/AuditLogsActions'
import { AuditLogsActions } from '../../components/AuditLogsActions'
import type { AccessLogItem } from '../../components/AccessLogsTable'
import { AccessLogsTable } from '../../components/AccessLogsTable'

type ActionLogResponse = {
  items: ActionLogItem[]
  canViewTenant: boolean
}

type AccessLogResponse = {
  items: AccessLogItem[]
  canViewTenant: boolean
  page: number
  pageSize: number
  total: number
  totalPages: number
}

type TabOption = 'actions' | 'access'

const ACCESS_PAGE_SIZE = 50

export default function AuditLogsPage() {
  const t = useT()
  const [tab, setTab] = React.useState<TabOption>('actions')
  const [actions, setActions] = React.useState<ActionLogItem[]>([])
  const [accessLogs, setAccessLogs] = React.useState<AccessLogItem[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [undoableOnly, setUndoableOnly] = React.useState(false)
  const [accessPage, setAccessPage] = React.useState(1)
  const [accessPageSize, setAccessPageSize] = React.useState(ACCESS_PAGE_SIZE)
  const [accessTotal, setAccessTotal] = React.useState(0)
  const [accessTotalPages, setAccessTotalPages] = React.useState(1)
  const accessPageSizeRef = React.useRef(ACCESS_PAGE_SIZE)

  const fetchActions = React.useCallback(async () => {
    const query = undoableOnly ? '?undoableOnly=true' : ''
    const res = await apiFetch(`/api/audit_logs/audit-logs/actions${query}`)
    if (!res.ok) throw new Error(await res.text().catch(() => ''))
    return res.json() as Promise<ActionLogResponse>
  }, [undoableOnly])

  const fetchAccess = React.useCallback(async (page: number, pageSize: number) => {
    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('pageSize', String(pageSize))
    const res = await apiFetch(`/api/audit_logs/audit-logs/access?${params.toString()}`)
    if (!res.ok) throw new Error(await res.text().catch(() => ''))
    return res.json() as Promise<AccessLogResponse>
  }, [])

  const loadAll = React.useCallback(async (page: number, pageSize: number) => {
    const [actionsRes, accessRes] = await Promise.all([
      fetchActions(),
      fetchAccess(page, pageSize),
    ])
    setActions(actionsRes.items ?? [])
    setAccessLogs(accessRes.items ?? [])
    const resolvedPage = accessRes.page ?? page
    const resolvedPageSize = accessRes.pageSize ?? pageSize
    const resolvedTotal = accessRes.total ?? (accessRes.items?.length ?? 0)
    const resolvedTotalPages = accessRes.totalPages ?? Math.max(1, Math.ceil((resolvedTotal || 0) / (resolvedPageSize || 1)))
    setAccessPage(resolvedPage)
    setAccessPageSize((prev) => {
      if (resolvedPageSize === prev) {
        accessPageSizeRef.current = prev
        return prev
      }
      accessPageSizeRef.current = resolvedPageSize
      return resolvedPageSize
    })
    setAccessTotal(resolvedTotal)
    setAccessTotalPages(resolvedTotalPages)
  }, [fetchActions, fetchAccess])

  const loadWithState = React.useCallback(async (page: number, pageSize: number) => {
    setLoading(true)
    setError(null)
    try {
      await loadAll(page, pageSize)
    } catch (err) {
      console.error('Failed to load audit logs', err)
      setError(t('audit_logs.error.load'))
    } finally {
      setLoading(false)
    }
  }, [loadAll, t])

  React.useEffect(() => {
    setAccessPage(1)
    void loadWithState(1, accessPageSizeRef.current)
  }, [loadWithState, undoableOnly])

  const renderRefreshButton = React.useCallback(() => (
    <Button
      variant="outline"
      size="sm"
      onClick={() => void loadWithState(accessPage, accessPageSize)}
      disabled={loading}
    >
      {loading ? t('audit_logs.common.refreshing') : t('audit_logs.common.refresh')}
    </Button>
  ), [loadWithState, accessPage, accessPageSize, loading, t])

  const handleUndoError = React.useCallback(() => {
    setError(t('audit_logs.error.undo'))
  }, [t])

  const handleAccessPageChange = React.useCallback((nextPage: number) => {
    const totalPages = accessTotalPages || 1
    const normalized = Math.max(1, Math.min(nextPage, totalPages))
    void loadWithState(normalized, accessPageSizeRef.current)
  }, [accessTotalPages, loadWithState])

  const headerExtras = (
    <>
      {renderRefreshButton()}
      <label className="flex items-center gap-2 rounded border border-transparent px-2 py-1 text-sm text-muted-foreground">
        <span>{t('audit_logs.filters.undoable_only')}</span>
        <input
          type="checkbox"
          className="h-4 w-4 rounded border border-input"
          checked={undoableOnly}
          onChange={(e) => setUndoableOnly(e.target.checked)}
        />
      </label>
    </>
  )

  return (
    <Page>
      <PageBody>
        <div className="mb-6 border-b border-border">
      <nav className="flex items-center gap-6 text-sm" role="tablist" aria-label={t('audit_logs.tabs.label')}>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'actions'}
              className={`relative -mb-px border-b-2 px-0 pb-3 pt-2 font-medium transition-colors ${tab === 'actions' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
              onClick={() => setTab('actions')}
            >
              {t('audit_logs.actions.title')}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'access'}
              className={`relative -mb-px border-b-2 px-0 pb-3 pt-2 font-medium transition-colors ${tab === 'access' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
              onClick={() => setTab('access')}
            >
              {t('audit_logs.access.title')}
            </button>
          </nav>
        </div>

        {error && <div className="mb-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

        {tab === 'actions' && (
          <AuditLogsActions
            items={actions}
            onRefresh={() => loadWithState(accessPage, accessPageSize)}
            isLoading={loading}
            headerExtras={headerExtras}
            onUndoError={handleUndoError}
          />
        )}

        {tab === 'access' && (
          <AccessLogsTable
            items={accessLogs}
            isLoading={loading}
            actions={renderRefreshButton()}
            pagination={{
              page: accessPage,
              pageSize: accessPageSize,
              total: accessTotal,
              totalPages: accessTotalPages,
              onPageChange: handleAccessPageChange,
            }}
          />
        )}
      </PageBody>
    </Page>
  )
}
