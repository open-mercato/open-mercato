# Step 4 — Create Backend Pages (UI)

## 6. Create Backend Pages

Use `CrudForm` and `DataTable` from `@open-mercato/ui`. See the `om-backend-ui-design` skill for full component reference.

> **Optimistic locking (default ON).** `CrudForm` in edit mode auto-derives the expected-version header from `initialValues.updatedAt` and applies it to **both** save and delete — so pass the loaded record's `updatedAt` into `initialValues`. For custom (non-`CrudForm`) list-row deletes or dialog mutations, wrap the call with `withScopedApiRequestHeaders(buildOptimisticLockHeader(record.updatedAt), () => deleteCrud(...))` and surface the 409 with `surfaceRecordConflict(err, t)` from `@open-mercato/ui/backend/conflicts`. Never leave a mutating edit/delete UI without a version header — concurrent edits would silently overwrite.

### Page Metadata & Sidebar Navigation

**File**: `src/modules/<module_id>/backend/page.meta.ts`

Icons MUST use components from `lucide-react`. Never use inline `React.createElement('svg', ...)` — it breaks after `yarn generate`.

For full field reference, settings pages, and anti-patterns, see [../references/navigation-patterns.md](../references/navigation-patterns.md).

```tsx
import { Trophy } from 'lucide-react'

export const metadata = {
  requireAuth: true,
  requireFeatures: ['<module_id>.view'],
  pageTitle: '<Module Name>',
  pageTitleKey: '<module_id>.nav.title',
  pageGroup: '<Module Name>',                 // Sidebar section name
  pageGroupKey: '<module_id>.nav.group',      // i18n key — items with same key grouped together
  pageOrder: 100,                             // Sort within group (lower = higher)
  icon: <Trophy className="size-4" />,
  breadcrumb: [{ label: '<Module Name>', labelKey: '<module_id>.nav.title' }],
}
```

### List Page

**File**: `src/modules/<module_id>/backend/page.tsx`

```tsx
'use client'
import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { ColumnDef } from '@tanstack/react-table'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type <Entity> = { id: string; name: string; organizationId: string; tenantId: string }

type <Entity>ListResponse = {
  items: <Entity>[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

const PAGE_SIZE = 20

export default function <Module>ListPage() {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const [rows, setRows] = React.useState<<Entity>[]>([])
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [isLoading, setIsLoading] = React.useState(true)

  const columns = React.useMemo<ColumnDef<<Entity>>[]>(() => [
    { accessorKey: 'name', header: t('<module_id>.list.columns.name') },
  ], [t])

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      try {
        const params = new URLSearchParams()
        params.set('page', String(page))
        params.set('pageSize', String(PAGE_SIZE))
        const fallback: <Entity>ListResponse = { items: [], total: 0, page, pageSize: PAGE_SIZE, totalPages: 1 }
        const call = await apiCall<<Entity>ListResponse>(
          `/api/<module_id>/<entities>?${params.toString()}`,
          undefined,
          { fallback },
        )
        if (!call.ok) {
          flash(t('<module_id>.list.error.loadFailed'), 'error')
          return
        }
        const payload = call.result ?? fallback
        if (!cancelled) {
          setRows(Array.isArray(payload.items) ? payload.items : [])
          setTotal(payload.total || 0)
          setTotalPages(payload.totalPages || 1)
        }
      } catch (err) {
        if (!cancelled) {
          flash(err instanceof Error ? err.message : t('<module_id>.list.error.loadFailed'), 'error')
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [page, scopeVersion, t])

  return (
    <Page>
      <PageBody>
        <DataTable<<Entity>>
          title={t('<module_id>.list.title')}
          columns={columns}
          data={rows}
          isLoading={isLoading}
          pagination={{ page, pageSize: PAGE_SIZE, total, totalPages, onPageChange: setPage }}
        />
      </PageBody>
    </Page>
  )
}

export const metadata = {
  requireAuth: true,
  requireFeatures: ['<module_id>.<entity>.view'],
  pageTitle: '<Module Name>',
  pageTitleKey: '<module_id>.nav.title',
  pageGroup: '<Module Name>',
  pageGroupKey: '<module_id>.nav.group',
  pageOrder: 100,
}
```

### Create Page

**File**: `src/modules/<module_id>/backend/<entities>/new.tsx`

```tsx
'use client'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { useRouter } from 'next/navigation'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type <Entity> = { id: string; name: string }

export default function Create<Entity>Page() {
  const t = useT()
  const router = useRouter()

  return (
    <Page>
      <PageBody>
        <CrudForm
          title={t('<module_id>.create.title')}
          backHref="/backend/<module_id>"
          fields={[
            { id: 'name', label: t('<module_id>.fields.name'), type: 'text', required: true },
          ]}
          onSubmit={async (values) => {
            const { result } = await createCrud<<Entity>>('<module_id>/<entities>', values)
            router.push(`/backend/<module_id>/<entities>/${result.id}`)
          }}
        />
      </PageBody>
    </Page>
  )
}

export const metadata = {
  requireAuth: true,
  requireFeatures: ['<module_id>.<entity>.manage'],
  pageTitle: 'Create <Entity>',
  pageTitleKey: '<module_id>.create.title',
  pageGroup: '<Module Name>',
  pageGroupKey: '<module_id>.nav.group',
  navHidden: true,
}
```

### Edit Page

**File**: `src/modules/<module_id>/backend/<entities>/[id].tsx`

```tsx
'use client'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm } from '@open-mercato/ui/backend/CrudForm'
import { updateCrud, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type <Entity> = { id: string; name: string }
type <Entity>DetailResponse = { items: <Entity>[]; total: number; page: number; pageSize: number; totalPages: number }

export default function Edit<Entity>Page({ params }: { params: { id: string } }) {
  const t = useT()
  const router = useRouter()
  const { data: response, isLoading } = useQuery({
    queryKey: ['<module_id>', '<entities>', params.id],
    queryFn: () => apiCall<<Entity>DetailResponse>(`<module_id>/<entities>?id=${params.id}`),
  })

  return (
    <Page>
      <PageBody>
        <CrudForm
          title={t('<module_id>.edit.title')}
          backHref="/backend/<module_id>"
          fields={[
            { id: 'name', label: t('<module_id>.fields.name'), type: 'text', required: true },
          ]}
          isLoading={isLoading}
          initialValues={response?.items?.[0] ?? undefined}
          onSubmit={async (values) => {
            await updateCrud('<module_id>/<entities>', { id: params.id, ...values })
            router.push('/backend/<module_id>')
          }}
          onDelete={async () => {
            await deleteCrud('<module_id>/<entities>', params.id)
            router.push('/backend/<module_id>')
          }}
        />
      </PageBody>
    </Page>
  )
}

export const metadata = {
  requireAuth: true,
  requireFeatures: ['<module_id>.<entity>.manage'],
  pageTitle: 'Edit <Entity>',
  pageTitleKey: '<module_id>.edit.title',
  pageGroup: '<Module Name>',
  pageGroupKey: '<module_id>.nav.group',
  navHidden: true,
}
```
