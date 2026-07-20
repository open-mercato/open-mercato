/**
 * List page template (lineage: om-ds-guardian page-templates.md §List Page,
 * trimmed from packages/core/src/modules/customers/backend/customers/people/page.tsx).
 */
export const listPageTemplate = `"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable, type DataTableExportFormat } from '@open-mercato/ui/backend/DataTable'
import type { ColumnDef } from '@tanstack/react-table'
import { Button } from '@open-mercato/ui/primitives/button'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { apiCall, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildCrudExportUrl, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useT } from '@open-mercato/shared/lib/i18n/context'
{{filterTypeImport}}{{statusImports}}
type {{entityPascal}}Row = {
  id: string
  updatedAt?: string | null
{{rowTypeFields}}
}

type {{entityPascal}}ListResponse = {
  items: {{entityPascal}}Row[]
  total: number
  totalPages: number
}

// DS guardrail: keep pageSize at or below 100.
const PAGE_SIZE = 25

export default function {{entityPascal}}ListPage() {
  const t = useT()
  const router = useRouter()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const { runMutation } = useGuardedMutation({ contextId: '{{moduleId}}.list' })
  const [rows, setRows] = React.useState<{{entityPascal}}Row[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [search, setSearch] = React.useState('')
{{filterStateLine}}  const [reloadToken, setReloadToken] = React.useState(0)

  const listParams = React.useMemo(() => {
    const params: Record<string, string | number> = { page, pageSize: PAGE_SIZE }
    if (search) params.search = search
{{filterParamLines}}    return params
  }, {{listParamsDeps}})

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      try {
        const query = new URLSearchParams()
        for (const [key, value] of Object.entries(listParams)) query.set(key, String(value))
        const fallback: {{entityPascal}}ListResponse = { items: [], total: 0, totalPages: 1 }
        const call = await apiCall<{{entityPascal}}ListResponse>('/api/{{moduleId}}?' + query.toString(), undefined, { fallback })
        if (cancelled) return
        if (!call.ok) {
          flash(t('{{moduleId}}.list.loadError', 'Failed to load {{moduleTitleLower}}'), 'error')
          return
        }
        const result = call.result ?? fallback
        setRows(result.items)
        setTotal(result.total)
        setTotalPages(result.totalPages)
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [listParams, reloadToken, t])

  const handleDelete = React.useCallback(async (row: {{entityPascal}}Row) => {
    const confirmed = await confirm({
      title: t('{{moduleId}}.delete.confirmTitle', 'Delete {{entityLower}}?'),
      description: t('{{moduleId}}.delete.confirmDescription', 'This action cannot be undone.'),
      variant: 'destructive',
    })
    if (!confirmed) return
    try {
      // Optimistic locking is ON by default: derive the expected-updated-at
      // header from the row the user acted on.
      await runMutation({
        operation: () =>
          withScopedApiRequestHeaders(
            buildOptimisticLockHeader(row.updatedAt ?? undefined),
            () => deleteCrud('{{moduleId}}', row.id),
          ),
        context: { resourceKind: '{{moduleId}}.{{entitySnake}}', resourceId: row.id },
        mutationPayload: { id: row.id },
      })
      flash(t('{{moduleId}}.delete.success', '{{entityTitle}} deleted'), 'success')
      setReloadToken((token) => token + 1)
    } catch {
      flash(t('{{moduleId}}.delete.error', 'Failed to delete {{entityLower}}'), 'error')
    }
  }, [confirm, runMutation, t])

  const columns = React.useMemo<ColumnDef<{{entityPascal}}Row>[]>(() => [
{{columnsBlock}}
  ], [t])

{{filtersMemo}}  const exporter = React.useMemo(() => ({
    getUrl: (format: DataTableExportFormat) => buildCrudExportUrl('{{moduleId}}', { ...listParams, all: 'true' }, format),
    filename: (format: DataTableExportFormat) => '{{moduleId}}.' + format,
  }), [listParams])

  return (
    <Page>
      <PageBody>
        <DataTable<{{entityPascal}}Row>
          title={t('{{moduleId}}.list.title', '{{moduleTitle}}')}
          actions={(
            <Button asChild>
              <Link href="/backend/{{moduleId}}/create">{t('{{moduleId}}.list.actions.create', 'Create {{entityLower}}')}</Link>
            </Button>
          )}
          columns={columns}
          data={rows}
          isLoading={isLoading}
          searchValue={search}
          onSearchChange={(value) => { setSearch(value); setPage(1) }}
          searchPlaceholder={t('{{moduleId}}.list.searchPlaceholder', 'Search {{moduleTitleLower}}')}
{{filterProps}}          exporter={exporter}
          extensionTableId="{{moduleId}}.list"
          onRowClick={(row) => router.push('/backend/{{moduleId}}/' + row.id)}
          rowActions={(row) => (
            <RowActions
              items={[
                {
                  id: 'edit',
                  label: t('{{moduleId}}.list.actions.edit', 'Edit'),
                  onSelect: () => { router.push('/backend/{{moduleId}}/' + row.id) },
                },
                {
                  id: 'delete',
                  label: t('{{moduleId}}.list.actions.delete', 'Delete'),
                  destructive: true,
                  onSelect: () => { void handleDelete(row) },
                },
              ]}
            />
          )}
          emptyState={(
            <EmptyState
              title={t('{{moduleId}}.list.empty.title', 'No {{moduleTitleLower}} yet')}
              description={t('{{moduleId}}.list.empty.description', 'Create your first {{entityLower}} to get started.')}
              actions={(
                <Button asChild>
                  <Link href="/backend/{{moduleId}}/create">{t('{{moduleId}}.list.actions.create', 'Create {{entityLower}}')}</Link>
                </Button>
              )}
            />
          )}
          pagination={{ page, pageSize: PAGE_SIZE, total, totalPages, onPageChange: setPage }}
        />
      </PageBody>
      {ConfirmDialogElement}
    </Page>
  )
}
`
