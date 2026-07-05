"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { ColumnDef } from '@tanstack/react-table'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { ListEmptyState } from '@open-mercato/ui/backend/filters/ListEmptyState'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { apiCall, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { formatDateTime } from '@open-mercato/shared/lib/time'
import { normalizeRegistration, type RegistrationRecord } from './registrationForm'

type RegistrationsResponse = {
  items?: unknown[]
  total?: number
  totalPages?: number
  error?: string
}

const PAGE_SIZE = 20

function shortId(value: string | null): string {
  if (!value) return ''
  return value.length > 8 ? value.slice(0, 8) : value
}

function coverageVariant(value: string | null): 'success' | 'warning' | 'neutral' {
  if (value === 'standard') return 'success'
  if (value === 'extended') return 'warning'
  return 'neutral'
}

function coverageLabel(value: string | null, t: TranslateFn): string {
  if (value === 'standard') return t('warranty_claims.registrations.coverageType.standard', 'Standard')
  if (value === 'extended') return t('warranty_claims.registrations.coverageType.extended', 'Extended')
  if (value === 'none') return t('warranty_claims.registrations.coverageType.none', 'No coverage')
  return t('warranty_claims.common.noValue', 'Not set')
}

function sourceLabel(value: string | null, t: TranslateFn): string {
  if (value === 'order') return t('warranty_claims.registrations.source.order', 'Order')
  if (value === 'manual') return t('warranty_claims.registrations.source.manual', 'Manual')
  if (value === 'third_party') return t('warranty_claims.registrations.source.thirdParty', 'Third party')
  return t('warranty_claims.common.noValue', 'Not set')
}

export default function WarrantyClaimRegistrationsPage() {
  const t = useT()
  const router = useRouter()
  const scopeVersion = useOrganizationScopeVersion()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const [rows, setRows] = React.useState<RegistrationRecord[]>([])
  const [page, setPage] = React.useState(1)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const [loading, setLoading] = React.useState(true)
  const [reloadToken, setReloadToken] = React.useState(0)

  const mutationContextId = 'warranty-claim-registrations-list'
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId?: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: mutationContextId,
    blockedMessage: t('warranty_claims.registrations.list.error.blocked', 'Save blocked by validation.'),
  })

  const reload = React.useCallback(() => {
    setReloadToken((current) => current + 1)
  }, [])

  React.useEffect(() => {
    let cancelled = false
    async function loadRegistrations() {
      setLoading(true)
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(PAGE_SIZE),
        sortField: 'updatedAt',
        sortDir: 'desc',
      })
      if (search.trim()) params.set('search', search.trim())
      try {
        const fallback: RegistrationsResponse = { items: [], total: 0, totalPages: 1 }
        const call = await apiCall<RegistrationsResponse>(
          `/api/warranty_claims/registrations?${params.toString()}`,
          undefined,
          { fallback },
        )
        if (!call.ok) {
          const message = call.result?.error ?? t('warranty_claims.registrations.list.error.load', 'Failed to load warranty registrations.')
          flash(message, 'error')
          return
        }
        if (cancelled) return
        const items = Array.isArray(call.result?.items) ? call.result.items : []
        setRows(items.map(normalizeRegistration).filter((row): row is RegistrationRecord => row !== null))
        setTotal(typeof call.result?.total === 'number' ? call.result.total : items.length)
        setTotalPages(typeof call.result?.totalPages === 'number' ? call.result.totalPages : 1)
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error
            ? error.message
            : t('warranty_claims.registrations.list.error.load', 'Failed to load warranty registrations.')
          flash(message, 'error')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void loadRegistrations()
    return () => {
      cancelled = true
    }
  }, [page, reloadToken, scopeVersion, search, t])

  const handleDelete = React.useCallback(async (registration: RegistrationRecord) => {
    const confirmed = await confirm({
      title: t('warranty_claims.registrations.confirm.deleteTitle', 'Delete this warranty registration?'),
      variant: 'destructive',
    })
    if (!confirmed) return
    try {
      await runMutation({
        operation: () => withScopedApiRequestHeaders(
          buildOptimisticLockHeader(registration.updatedAt),
          () => deleteCrud('warranty_claims/registrations', registration.id, {
            errorMessage: t('warranty_claims.registrations.list.error.delete', 'Failed to delete warranty registration.'),
          }),
        ),
        mutationPayload: { id: registration.id },
        context: {
          formId: mutationContextId,
          resourceKind: 'warranty_claims.warranty_claim_registration',
          resourceId: registration.id,
          retryLastMutation,
        },
      })
      flash(t('warranty_claims.registrations.list.success.delete', 'Warranty registration deleted.'), 'success')
      reload()
    } catch (error) {
      if (surfaceRecordConflict(error, t, { onRefresh: reload })) return
      flash(
        error instanceof Error
          ? error.message
          : t('warranty_claims.registrations.list.error.delete', 'Failed to delete warranty registration.'),
        'error',
      )
    }
  }, [confirm, mutationContextId, reload, retryLastMutation, runMutation, t])

  const columns = React.useMemo<ColumnDef<RegistrationRecord>[]>(() => {
    const noValue = <span className="text-sm text-muted-foreground">{t('warranty_claims.common.noValue', 'Not set')}</span>
    return [
      {
        accessorKey: 'serialNumber',
        header: t('warranty_claims.registrations.list.column.serial', 'Serial'),
        meta: { alwaysVisible: true, maxWidth: '180px' },
        cell: ({ row }) => (
          <Link
            href={`/backend/warranty_claims/registrations/${row.original.id}/edit`}
            className="font-medium hover:underline"
          >
            {row.original.serialNumber ?? shortId(row.original.id)}
          </Link>
        ),
      },
      {
        accessorKey: 'productName',
        header: t('warranty_claims.registrations.list.column.product', 'Product'),
        meta: { truncate: true, maxWidth: '260px' },
        cell: ({ row }) => row.original.productName ? <span>{row.original.productName}</span> : noValue,
      },
      {
        accessorKey: 'customerId',
        header: t('warranty_claims.registrations.list.column.customer', 'Customer'),
        cell: ({ row }) => row.original.customerId ? <span className="font-mono text-xs">{shortId(row.original.customerId)}</span> : noValue,
      },
      {
        accessorKey: 'coverageType',
        header: t('warranty_claims.registrations.list.column.coverage', 'Coverage'),
        cell: ({ row }) => (
          <StatusBadge variant={coverageVariant(row.original.coverageType)}>
            {coverageLabel(row.original.coverageType, t)}
          </StatusBadge>
        ),
      },
      {
        accessorKey: 'warrantyExpiresAt',
        header: t('warranty_claims.registrations.list.column.warrantyExpiry', 'Warranty expiry'),
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {formatDateTime(row.original.warrantyExpiresAt) ?? t('warranty_claims.common.noValue', 'Not set')}
          </span>
        ),
      },
      {
        accessorKey: 'source',
        header: t('warranty_claims.registrations.list.column.source', 'Source'),
        cell: ({ row }) => <StatusBadge variant="neutral">{sourceLabel(row.original.source, t)}</StatusBadge>,
      },
      {
        accessorKey: 'updatedAt',
        header: t('warranty_claims.registrations.list.column.updated', 'Updated'),
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {formatDateTime(row.original.updatedAt) ?? t('warranty_claims.common.noValue', 'Not set')}
          </span>
        ),
      },
    ]
  }, [t])

  return (
    <Page>
      <PageBody>
        <DataTable<RegistrationRecord>
          stickyFirstColumn
          stickyActionsColumn
          title={t('warranty_claims.registrations.list.title', 'Warranty registrations')}
          refreshButton={{
            label: t('warranty_claims.registrations.list.actions.refresh', 'Refresh'),
            onRefresh: reload,
            isRefreshing: loading,
          }}
          actions={(
            <Button asChild>
              <Link href="/backend/warranty_claims/registrations/create">
                {t('warranty_claims.registrations.list.actions.new', 'New registration')}
              </Link>
            </Button>
          )}
          columns={columns}
          data={rows}
          searchValue={search}
          onSearchChange={(value) => {
            setSearch(value)
            setPage(1)
          }}
          searchPlaceholder={t('warranty_claims.registrations.list.searchPlaceholder', 'Search serial, SKU, or product')}
          onRowClick={(row) => router.push(`/backend/warranty_claims/registrations/${row.id}/edit`)}
          isLoading={loading}
          rowActions={(row) => (
            <RowActions
              items={[
                {
                  id: 'edit',
                  label: t('warranty_claims.registrations.list.actions.edit', 'Edit'),
                  onSelect: () => router.push(`/backend/warranty_claims/registrations/${row.id}/edit`),
                },
                {
                  id: 'delete',
                  label: t('warranty_claims.registrations.list.actions.delete', 'Delete'),
                  destructive: true,
                  onSelect: () => {
                    void handleDelete(row)
                  },
                },
              ]}
            />
          )}
          emptyState={(
            <ListEmptyState
              title={t('warranty_claims.registrations.list.empty.title', 'No warranty registrations yet')}
              description={t('warranty_claims.registrations.list.empty.description', 'Create a registration to resolve warranty entitlement by serial number.')}
              createHref="/backend/warranty_claims/registrations/create"
              createLabel={t('warranty_claims.registrations.list.actions.new', 'New registration')}
            />
          )}
          pagination={{
            page,
            pageSize: PAGE_SIZE,
            total,
            totalPages,
            onPageChange: setPage,
          }}
        />
        {ConfirmDialogElement}
      </PageBody>
    </Page>
  )
}
