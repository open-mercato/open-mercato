"use client"
import * as React from 'react'
import type { ColumnDef, SortingState } from '@tanstack/react-table'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { Button } from '@open-mercato/ui/primitives/button'

type TodoRow = {
  id: number
  title: string
  is_done?: boolean
  tenant_id?: number | null
  organization_id?: number | null
  cf_priority?: number | null
  cf_severity?: string | null
  cf_blocked?: boolean | null
}

const columns: ColumnDef<TodoRow>[] = [
  { accessorKey: 'id', header: 'ID' },
  { accessorKey: 'title', header: 'Title' },
  { accessorKey: 'tenant_id', header: 'Tenant' },
  { accessorKey: 'organization_id', header: 'Org' },
  { accessorKey: 'is_done', header: 'Done' },
  { accessorKey: 'cf_priority', header: 'Priority' },
  { accessorKey: 'cf_severity', header: 'Severity' },
  { accessorKey: 'cf_blocked', header: 'Blocked' },
]

export default function TodosTable({ rows }: { rows: TodoRow[] }) {
  const [title, setTitle] = React.useState('')
  const [severity, setSeverity] = React.useState<string | undefined>(undefined)
  const [done, setDone] = React.useState<boolean | undefined>(undefined)
  const [blocked, setBlocked] = React.useState<boolean | undefined>(undefined)
  const [orgId, setOrgId] = React.useState<string>('')
  const [tenantId, setTenantId] = React.useState<string>('')
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'id', desc: false }])

  const filtered = React.useMemo(() => {
    return rows.filter((r) => {
      if (title && !r.title.toLowerCase().includes(title.toLowerCase())) return false
      if (severity && (r.cf_severity || '') !== severity) return false
      if (done !== undefined && done !== null) {
        if (done === true && r.is_done !== true) return false
        if (done === false && r.is_done === true) return false
      }
      if (blocked !== undefined && blocked !== null) {
        if (blocked === true && r.cf_blocked !== true) return false
        if (blocked === false && r.cf_blocked === true) return false
      }
      if (orgId) {
        const v = r.organization_id == null ? '' : String(r.organization_id)
        if (v !== orgId) return false
      }
      if (tenantId) {
        const v = r.tenant_id == null ? '' : String(r.tenant_id)
        if (v !== tenantId) return false
      }
      return true
    })
  }, [rows, title, severity, done, blocked, orgId, tenantId])

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <input placeholder="Title contains…" value={title} onChange={(e) => setTitle(e.target.value)} className="h-8 w-[180px] border rounded px-2" />
      <select value={severity ?? ''} onChange={(e) => setSeverity(e.target.value || undefined)} className="h-8 w-[140px] border rounded px-2">
        <option value="">Severity</option>
        <option value="low">Low</option>
        <option value="medium">Medium</option>
        <option value="high">High</option>
      </select>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={done === true} onChange={(e) => setDone(e.target.checked ? true : undefined)} /> Done
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={blocked === true} onChange={(e) => setBlocked(e.target.checked ? true : undefined)} /> Blocked
      </label>
      <input placeholder="Org ID" value={orgId} onChange={(e) => setOrgId(e.target.value)} className="h-8 w-[100px] border rounded px-2" />
      <input placeholder="Tenant ID" value={tenantId} onChange={(e) => setTenantId(e.target.value)} className="h-8 w-[110px] border rounded px-2" />
      <Button variant="outline" className="h-8" onClick={() => { setTitle(''); setSeverity(undefined); setDone(undefined); setBlocked(undefined); setOrgId(''); setTenantId('') }}>Reset</Button>
    </div>
  )

  return <DataTable columns={columns} data={filtered} toolbar={toolbar} sortable sorting={sorting} onSortingChange={setSorting} />
}
