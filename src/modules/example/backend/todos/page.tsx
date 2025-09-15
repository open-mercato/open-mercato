import { createRequestContainer } from '@/lib/di/container'
import { Page, PageHeader, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { getAuthFromCookies } from '@/lib/auth/server'
import type { ColumnDef } from '@tanstack/react-table'
import TodosTable from './TodosTable'

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

export default async function ExampleTodosPage() {
  const container = await createRequestContainer()
  const queryEngine = container.resolve<any>('queryEngine')
  const auth = await getAuthFromCookies()
  const orgId = auth?.orgId ? Number(auth.orgId) : undefined
  // Pull base columns and CF columns (aliased as cf:*) using the query engine
  const res = await queryEngine.query('example:todo', {
    organizationId: orgId,
    fields: ['id', 'title', 'tenant_id', 'organization_id', 'is_done', 'cf:priority', 'cf:severity', 'cf:blocked'],
    sort: [{ field: 'id', dir: 'asc' }],
    page: { page: 1, pageSize: 50 },
  })
  // Map to rows expected by DataTable (cf:* are projected as columns with "cf_" prefix)
  const rows: TodoRow[] = (res.items as any[]).map((it) => ({
    id: it.id,
    title: it.title,
    tenant_id: (it as any).tenant_id,
    organization_id: (it as any).organization_id,
    is_done: it.is_done,
    cf_priority: (it as any)['cf:priority'] ?? (it as any).cf_priority,
    cf_severity: (it as any)['cf:severity'] ?? (it as any).cf_severity,
    cf_blocked: (it as any)['cf:blocked'] ?? (it as any).cf_blocked,
  }))

  return (
    <Page>
      <PageHeader title="Todos" description="Example todos with custom fields (priority, severity, blocked)" />
      <PageBody>
        <TodosTable rows={rows} />
      </PageBody>
    </Page>
  )
}
