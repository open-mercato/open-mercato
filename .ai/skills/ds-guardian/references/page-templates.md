# Page Templates

DS-compliant templates for scaffolding new pages. Replace `YourModule`, `YourEntity`, `your-module`, etc.

## List Page

```tsx
// backend/<module>/page.tsx
'use client'

import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable, type ColumnDef } from '@open-mercato/ui/backend/DataTable'
import { EmptyState } from '@open-mercato/ui/backend/EmptyState'                // DS: empty state required
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'          // DS: semantic status
import { Button } from '@open-mercato/ui/primitives/button'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'                // DS: never raw fetch
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'                    // DS: never hardcoded strings
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { Plus } from 'lucide-react'                                             // DS: lucide icons only
import { useEffect, useState } from 'react'
import type { StatusMap } from '@open-mercato/ui/primitives/status-badge'

// CHANGE: Define status map for your entity
const statusMap: StatusMap<'active' | 'inactive'> = {
  active: 'success',
  inactive: 'neutral',
}

export default function ListPage() {
  const t = useT()
  const { confirm } = useConfirmDialog()
  const [rows, setRows] = useState<YourEntity[]>([])
  const [isLoading, setIsLoading] = useState(true)                              // DS: loading state required
  const [pagination, setPagination] = useState({ page: 1, pageSize: 25, total: 0, totalPages: 0 })
  const [search, setSearch] = useState('')

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    apiCall(`/api/your-module?page=${pagination.page}&pageSize=${pagination.pageSize}&search=${search}`)
      .then((res) => {
        if (cancelled) return
        if (res.ok) {
          setRows(res.result.data)
          setPagination((prev) => ({ ...prev, total: res.result.total, totalPages: res.result.totalPages }))
        }
      })
      .finally(() => { if (!cancelled) setIsLoading(false) })
    return () => { cancelled = true }
  }, [pagination.page, pagination.pageSize, search])

  // CHANGE: Define columns for your entity
  const columns: ColumnDef<YourEntity>[] = [
    { accessorKey: 'name', header: t('module.name', 'Name') },
    {
      accessorKey: 'status',
      header: t('module.status', 'Status'),
      cell: ({ row }) => (
        // DS: StatusBadge with StatusMap — never hardcoded colors
        <StatusBadge variant={statusMap[row.original.status] ?? 'neutral'} dot>
          {t(`module.status.${row.original.status}`, row.original.status)}
        </StatusBadge>
      ),
    },
  ]

  // DS: EmptyState when no data — do not show an empty table
  if (!isLoading && rows.length === 0 && !search) {
    return (
      <Page>
        <PageBody>
          <EmptyState
            title={t('module.empty.title', 'No items yet')}
            description={t('module.empty.description', 'Create your first item to get started.')}
            action={{ label: t('module.create', 'Create item'), onClick: () => {} }}
          />
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageBody>
        <DataTable
          columns={columns}
          data={rows}
          isLoading={isLoading}
          pagination={pagination}
          onPageChange={(page) => setPagination((prev) => ({ ...prev, page }))}
          searchValue={search}
          onSearchChange={setSearch}
          headerActions={
            <Button size="sm">
              <Plus className="mr-2 h-4 w-4" />
              {t('module.create', 'Create')}
            </Button>
          }
        />
      </PageBody>
    </Page>
  )
}

// DS: metadata required for RBAC and breadcrumbs
export const metadata = {
  title: 'module.list.title',
  requireAuth: true,
  requireFeatures: ['module.view'],
  breadcrumb: [{ labelKey: 'module.list.title', label: 'Items' }],
}
```

## Create Page

```tsx
// backend/<module>/create/page.tsx
'use client'

import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { collectCustomFieldValues } from '@open-mercato/ui/backend/utils/customFieldValues'
import { useRouter } from 'next/navigation'

export default function CreatePage() {
  const t = useT()
  const router = useRouter()

  // CHANGE: Define fields for your entity
  const fields: CrudField[] = [
    { id: 'name', label: t('module.name', 'Name'), type: 'text', required: true },
    { id: 'status', label: t('module.status', 'Status'), type: 'select', options: [] },
    { id: 'description', label: t('module.description', 'Description'), type: 'textarea' },
  ]

  const handleSubmit = async (values: Record<string, unknown>) => {
    const customFields = collectCustomFieldValues(values)
    const result = await createCrud('/api/your-module', { ...values, customFields })
    if (!result.ok) {
      throw createCrudFormError(
        t('module.create.error', 'Failed to create item'),
        result.errors,
      )
    }
    flash(t('module.create.success', 'Item created'), 'success')
    router.push(`/backend/your-module/${result.result.id}`)
  }

  return (
    <Page>
      <PageBody>
        <CrudForm
          title={t('module.create.title', 'Create item')}
          fields={fields}
          entityIds={['your_entity']}
          onSubmit={handleSubmit}
          backHref="/backend/your-module"
          cancelHref="/backend/your-module"
          submitLabel={t('common.create', 'Create')}
        />
      </PageBody>
    </Page>
  )
}

export const metadata = {
  title: 'module.create.title',
  requireAuth: true,
  requireFeatures: ['module.create'],
  breadcrumb: [
    { labelKey: 'module.list.title', label: 'Items', href: '/backend/your-module' },
    { labelKey: 'module.create.title', label: 'Create' },
  ],
}
```

## Detail Page

```tsx
// backend/<module>/[id]/page.tsx
'use client'

import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'  // DS: loading/error required
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'          // DS: semantic status
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'          // DS: section headers
import { Button } from '@open-mercato/ui/primitives/button'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import type { StatusMap } from '@open-mercato/ui/primitives/status-badge'

// CHANGE: Define status map for your entity
const statusMap: StatusMap<'active' | 'inactive'> = {
  active: 'success',
  inactive: 'neutral',
}

export default function DetailPage({ params }: { params: { id: string } }) {
  const t = useT()
  const router = useRouter()
  const { confirm } = useConfirmDialog()
  const [data, setData] = useState<YourEntity | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    apiCall(`/api/your-module/${params.id}`)
      .then((res) => {
        if (cancelled) return
        if (res.ok) setData(res.result)
        else setError(t('module.detail.notFound', 'Item not found'))
      })
      .finally(() => { if (!cancelled) setIsLoading(false) })
    return () => { cancelled = true }
  }, [params.id])

  // DS: LoadingMessage — never raw Spinner for page-level loading
  if (isLoading) return <LoadingMessage />
  // DS: ErrorMessage — never raw text for errors
  if (error || !data) return <ErrorMessage message={error ?? t('module.detail.notFound', 'Not found')} />

  const handleDelete = async () => {
    const confirmed = await confirm({
      title: t('module.delete.confirm.title', 'Delete item?'),
      description: t('module.delete.confirm.description', 'This action cannot be undone.'),
      variant: 'destructive',
    })
    if (!confirmed) return
    const result = await deleteCrud(`/api/your-module/${params.id}`)
    if (result.ok) {
      flash(t('module.delete.success', 'Item deleted'), 'success')
      router.push('/backend/your-module')
    } else {
      flash(t('module.delete.error', 'Failed to delete'), 'error')
    }
  }

  return (
    <Page>
      <PageBody>
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">{data.name}</h2>
            <StatusBadge variant={statusMap[data.status] ?? 'neutral'} dot>
              {t(`module.status.${data.status}`, data.status)}
            </StatusBadge>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => router.push('edit')}>
              {t('common.edit', 'Edit')}
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              {t('common.delete', 'Delete')}
            </Button>
          </div>
        </div>

        {/* CHANGE: Add detail sections */}
        <div className="mt-6 space-y-6">
          <SectionHeader
            title={t('module.sections.details', 'Details')}
          />
          {/* Section content */}
        </div>
      </PageBody>
    </Page>
  )
}

export const metadata = {
  title: 'module.detail.title',
  requireAuth: true,
  requireFeatures: ['module.view'],
}
```

## DS Checklist for Generated Pages

Every generated page must pass:
- [ ] All strings via `useT()` — no hardcoded text
- [ ] `EmptyState` for zero-data (list pages)
- [ ] `LoadingMessage` for loading state
- [ ] `ErrorMessage` for error state
- [ ] `StatusBadge` with `StatusMap` for entity status
- [ ] `metadata` with `requireAuth`, `requireFeatures`, `breadcrumb`
- [ ] `aria-label` on icon-only buttons
- [ ] `apiCall` for data fetching — no raw `fetch`
- [ ] No `text-red-*`, `bg-green-*`, etc. — semantic tokens only
- [ ] No `text-[Npx]` — use typography scale
- [ ] No `<Notice>` — use `<Alert>`
- [ ] No inline `<svg>` — use `lucide-react`
