"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { ColumnDef } from '@tanstack/react-table'
import { Plus, ShieldCheck } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge, type StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { DataTable } from '@open-mercato/ui'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { usePortalContext } from '@open-mercato/ui/portal/PortalContext'
import { PortalPageHeader } from '@open-mercato/ui/portal/components/PortalPageHeader'
import { PortalEmptyState } from '@open-mercato/ui/portal/components/PortalEmptyState'

type Props = { params: { orgSlug: string } }

type PortalClaimRow = {
  id: string
  claimNumber: string
  claimType: string
  status: string
  createdAt: string | null
  updatedAt: string | null
}

type PortalClaimsResponse = {
  items: PortalClaimRow[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

const CLAIM_STATUS_VARIANTS: Record<string, StatusBadgeVariant> = {
  draft: 'neutral',
  info_requested: 'neutral',
  submitted: 'info',
  in_review: 'info',
  approved: 'warning',
  awaiting_return: 'warning',
  received: 'warning',
  inspecting: 'warning',
  resolved: 'success',
  closed: 'success',
  rejected: 'error',
  cancelled: 'error',
}

function statusVariant(status: string): StatusBadgeVariant {
  return CLAIM_STATUS_VARIANTS[status] ?? 'neutral'
}

function formatDate(value: string | null, fallback: string): string {
  if (!value) return fallback
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export default function WarrantyClaimsPortalListPage({ params }: Props) {
  const t = useT()
  const router = useRouter()
  const { auth } = usePortalContext()
  const { user, loading } = auth
  const [rows, setRows] = React.useState<PortalClaimRow[]>([])
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(20)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!loading && !user) {
      router.replace(`/${params.orgSlug}/portal/login`)
    }
  }, [loading, user, router, params.orgSlug])

  React.useEffect(() => {
    if (!user) return
    let cancelled = false
    setIsLoading(true)
    setError(null)
    apiCall<PortalClaimsResponse>(
      `/api/warranty_claims/portal/claims?page=${page}&pageSize=${pageSize}`,
    )
      .then((res) => {
        if (cancelled) return
        if (!res.ok || !res.result) {
          setError(t('warranty_claims.portal.error.loadList'))
          setRows([])
          setTotal(0)
          setTotalPages(1)
          return
        }
        setRows(res.result.items)
        setTotal(res.result.total)
        setTotalPages(res.result.totalPages)
      })
      .catch(() => {
        if (!cancelled) {
          setError(t('warranty_claims.portal.error.loadList'))
          setRows([])
          setTotal(0)
          setTotalPages(1)
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [page, pageSize, t, user])

  const columns = React.useMemo<ColumnDef<PortalClaimRow>[]>(() => [
    {
      accessorKey: 'claimNumber',
      header: t('warranty_claims.list.column.claimNumber'),
      cell: ({ row }) => (
        <span className="font-medium text-foreground">{row.original.claimNumber}</span>
      ),
      meta: { truncate: true, maxWidth: 180 },
    },
    {
      accessorKey: 'claimType',
      header: t('warranty_claims.list.column.claimType'),
      cell: ({ row }) => t(`warranty_claims.claimType.${row.original.claimType}`),
      meta: { truncate: true, maxWidth: 160 },
    },
    {
      accessorKey: 'status',
      header: t('warranty_claims.list.column.status'),
      cell: ({ row }) => (
        <StatusBadge variant={statusVariant(row.original.status)} dot>
          {t(`warranty_claims.status.${row.original.status}`)}
        </StatusBadge>
      ),
      meta: { maxWidth: 180 },
    },
    {
      accessorKey: 'createdAt',
      header: t('warranty_claims.portal.list.column.createdAt'),
      cell: ({ row }) => formatDate(row.original.createdAt, t('warranty_claims.portal.value.notAvailable')),
      meta: { maxWidth: 160 },
    },
    {
      accessorKey: 'updatedAt',
      header: t('warranty_claims.list.column.updatedAt'),
      cell: ({ row }) => formatDate(row.original.updatedAt, t('warranty_claims.portal.value.notAvailable')),
      meta: { maxWidth: 160 },
    },
  ], [t])

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Spinner /></div>
  }

  if (!user) return null

  return (
    <div className="flex flex-col gap-8">
      <PortalPageHeader
        label={t('warranty_claims.portal.nav')}
        title={t('warranty_claims.portal.listTitle')}
        description={t('warranty_claims.portal.list.description')}
        action={
          <Button asChild>
            <Link href={`/${params.orgSlug}/portal/claims/new`}>
              <Plus className="size-4" aria-hidden="true" />
              {t('warranty_claims.portal.newClaim')}
            </Link>
          </Button>
        }
      />

      {error ? (
        <ErrorMessage label={error} />
      ) : null}

      <DataTable<PortalClaimRow>
        title={t('warranty_claims.portal.listTitle')}
        columns={columns}
        data={rows}
        isLoading={isLoading}
        error={error}
        pagination={{
          page,
          pageSize,
          total,
          totalPages,
          onPageChange: setPage,
          onPageSizeChange: (nextPageSize) => {
            setPageSize(nextPageSize)
            setPage(1)
          },
        }}
        onRowClick={(row) => {
          router.push(`/${params.orgSlug}/portal/claims/${row.id}`)
        }}
        rowClickActionIds={['open']}
        emptyState={(
          <PortalEmptyState
            icon={<ShieldCheck className="size-5" />}
            title={t('warranty_claims.portal.empty.title')}
            description={t('warranty_claims.portal.empty.description')}
            action={
              <Button asChild>
                <Link href={`/${params.orgSlug}/portal/claims/new`}>
                  <Plus className="size-4" aria-hidden="true" />
                  {t('warranty_claims.portal.newClaim')}
                </Link>
              </Button>
            }
          />
        )}
      />
    </div>
  )
}
