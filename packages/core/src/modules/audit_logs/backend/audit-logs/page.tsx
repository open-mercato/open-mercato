'use client'

import React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import type { ActionLogItem } from './AuditLogsActions'
import { AuditLogsActions } from './AuditLogsActions'
import type { AccessLogItem } from './AccessLogsTable'
import { AccessLogsTable } from './AccessLogsTable'

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
        apiFetch<ActionLogResponse>(`/api/audit-logs/actions${query}`),
        apiFetch<AccessLogResponse>('/api/audit-logs/access'),
      ])
      setActions(actionsRes.items)
      setAccessLogs(accessRes.items)
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load audit logs')
    } finally {
      setLoading(false)
    }
  }, [undoableOnly])

  React.useEffect(() => {
    void loadData()
  }, [loadData])

  return (
    <Page>
      <PageBody>
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setTab('actions')}
              className={`rounded-md px-3 py-1 text-sm ${tab === 'actions' ? 'bg-gray-900 text-white' : 'bg-gray-200 text-gray-700'}`}
            >
              Action Log
            </button>
            <button
              type="button"
              onClick={() => setTab('access')}
              className={`rounded-md px-3 py-1 text-sm ${tab === 'access' ? 'bg-gray-900 text-white' : 'bg-gray-200 text-gray-700'}`}
            >
              Access Log
            </button>
          </div>
          <button
            type="button"
            className="rounded-md border border-gray-300 px-3 py-1 text-sm"
            onClick={() => void loadData()}
            disabled={loading}
          >
            Refresh
          </button>
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <span>Undoable only</span>
            <input
              type="checkbox"
              checked={undoableOnly}
              onChange={(e) => setUndoableOnly(e.target.checked)}
            />
          </label>
        </div>

        {error && <div className="mb-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

        {tab === 'actions' && (
          loading ? <p className="text-sm text-gray-500">Loading…</p> : <AuditLogsActions items={actions} onRefresh={loadData} />
        )}

        {tab === 'access' && (loading ? <p className="text-sm text-gray-500">Loading…</p> : <AccessLogsTable items={accessLogs} />)}
      </PageBody>
    </Page>
  )
}
