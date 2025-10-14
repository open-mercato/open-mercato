'use client'

import React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'

type ActionLogItem = {
  id: string
  commandId: string
  actionLabel: string | null
  executionState: string
  actorUserId: string | null
  tenantId: string | null
  organizationId: string | null
  resourceKind: string | null
  resourceId: string | null
  undoToken: string | null
  createdAt: string
  snapshotBefore?: unknown
  snapshotAfter?: unknown
  changes?: Record<string, unknown> | null
}

type ActionLogResponse = {
  items: ActionLogItem[]
  canViewTenant: boolean
}

type AccessLogItem = {
  id: string
  resourceKind: string
  resourceId: string
  accessType: string
  actorUserId: string | null
  tenantId: string | null
  organizationId: string | null
  fields: string[]
  context: Record<string, unknown> | null
  createdAt: string
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
  const [undoing, setUndoing] = React.useState(false)
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

  const latestUndoable = React.useMemo(() => actions.find((item) => item.undoToken), [actions])

  const handleUndo = async () => {
    if (!latestUndoable?.undoToken) return
    setUndoing(true)
    try {
      await apiFetch('/api/audit-logs/actions/undo', {
        method: 'POST',
        body: { undoToken: latestUndoable.undoToken },
      })
      await loadData()
    } catch (err: any) {
      setError(err?.message ?? 'Undo failed')
    } finally {
      setUndoing(false)
    }
  }

  const renderActionsTable = () => (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <HeaderCell>Action</HeaderCell>
            <HeaderCell>Resource</HeaderCell>
            <HeaderCell>User</HeaderCell>
            <HeaderCell>Tenant</HeaderCell>
            <HeaderCell>Organization</HeaderCell>
            <HeaderCell>When</HeaderCell>
            <HeaderCell>Status</HeaderCell>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200 bg-white">
          {actions.map((item) => (
            <tr key={item.id}>
              <Cell>{item.actionLabel || item.commandId}</Cell>
              <Cell>{formatResource(item)}</Cell>
              <Cell>{item.actorUserId || '—'}</Cell>
              <Cell>{item.tenantId || '—'}</Cell>
              <Cell>{item.organizationId || '—'}</Cell>
              <Cell>{formatDate(item.createdAt)}</Cell>
              <Cell>{item.executionState}</Cell>
            </tr>
          ))}
        </tbody>
      </table>
      {!actions.length && <p className="mt-4 text-sm text-gray-500">No actions recorded yet.</p>}
    </div>
  )

  const renderAccessTable = () => (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <HeaderCell>Resource</HeaderCell>
            <HeaderCell>Access</HeaderCell>
            <HeaderCell>User</HeaderCell>
            <HeaderCell>Tenant</HeaderCell>
            <HeaderCell>Organization</HeaderCell>
            <HeaderCell>Fields</HeaderCell>
            <HeaderCell>When</HeaderCell>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200 bg-white">
          {accessLogs.map((item) => (
            <tr key={item.id}>
              <Cell>{formatResource(item)}</Cell>
              <Cell>{item.accessType}</Cell>
              <Cell>{item.actorUserId || '—'}</Cell>
              <Cell>{item.tenantId || '—'}</Cell>
              <Cell>{item.organizationId || '—'}</Cell>
              <Cell>{item.fields.length ? item.fields.join(', ') : '—'}</Cell>
              <Cell>{formatDate(item.createdAt)}</Cell>
            </tr>
          ))}
        </tbody>
      </table>
      {!accessLogs.length && <p className="mt-4 text-sm text-gray-500">No access events recorded yet.</p>}
    </div>
  )

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
          <div className="space-y-4">
            {latestUndoable?.undoToken && (
              <button
                type="button"
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                onClick={handleUndo}
                disabled={undoing}
              >
                {undoing ? 'Undoing…' : 'Undo last action'}
              </button>
            )}
            {loading ? <p className="text-sm text-gray-500">Loading…</p> : renderActionsTable()}
          </div>
        )}

        {tab === 'access' && (loading ? <p className="text-sm text-gray-500">Loading…</p> : renderAccessTable())}
      </PageBody>
    </Page>
  )
}

function formatResource(item: { resourceKind?: string | null; resourceId?: string | null }) {
  if (!item.resourceKind && !item.resourceId) return '—'
  return [item.resourceKind, item.resourceId].filter(Boolean).join(' · ')
}

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function HeaderCell({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">{children}</th>
}

function Cell({ children }: { children: React.ReactNode }) {
  return <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">{children}</td>
}
