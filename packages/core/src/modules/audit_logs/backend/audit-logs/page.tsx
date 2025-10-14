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
}

type TabOption = 'actions' | 'access'

export default function AuditLogsPage() {
  const t = useT()
  const [tab, setTab] = React.useState<TabOption>('actions')
  const [actions, setActions] = React.useState<ActionLogItem[]>([])
  const [accessLogs, setAccessLogs] = React.useState<AccessLogItem[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [undoableOnly, setUndoableOnly] = React.useState(false)

  const loadData = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const query = undoableOnly ? '?undoableOnly=true' : ''
      const [actionsRes, accessRes] = await Promise.all([
        apiFetch(`/api/audit_logs/audit-logs/actions${query}`).then(async (res) => {
          if (!res.ok) throw new Error(await res.text().catch(() => ''))
          return res.json() as Promise<ActionLogResponse>
        }),
        apiFetch('/api/audit_logs/audit-logs/access').then(async (res) => {
          if (!res.ok) throw new Error(await res.text().catch(() => ''))
          return res.json() as Promise<AccessLogResponse>
        }),
      ])
      setActions(actionsRes.items ?? [])
      setAccessLogs(accessRes.items ?? [])
    } catch (err) {
      console.error('Failed to load audit logs', err)
      setError(t('audit_logs.error.load'))
    } finally {
      setLoading(false)
    }
  }, [undoableOnly, t])

  React.useEffect(() => {
    void loadData()
  }, [loadData])

  const renderRefreshButton = React.useCallback(() => (
    <Button
      variant="outline"
      size="sm"
      onClick={() => void loadData()}
      disabled={loading}
    >
      {loading ? t('audit_logs.common.refreshing') : t('audit_logs.common.refresh')}
    </Button>
  ), [loadData, loading, t])

  const handleUndoError = React.useCallback(() => {
    setError(t('audit_logs.error.undo'))
  }, [t])

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
            onRefresh={loadData}
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
          />
        )}
      </PageBody>
    </Page>
  )
}
