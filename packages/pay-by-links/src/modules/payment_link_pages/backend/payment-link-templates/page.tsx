"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { ColumnDef } from '@tanstack/react-table'
import { Button } from '@open-mercato/ui/primitives/button'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { apiCallOrThrow, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Plus } from 'lucide-react'

type TemplateRow = {
  id: string
  name: string
  description?: string | null
  isDefault: boolean
  createdAt: string
}

type TemplatesResponse = {
  items?: Array<Record<string, unknown>>
  total?: number
  page?: number
  totalPages?: number
}

export default function PaymentLinkTemplatesListPage() {
  const t = useT()
  const router = useRouter()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const [data, setData] = React.useState<TemplateRow[]>([])
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [loading, setLoading] = React.useState(true)
  const [page, setPage] = React.useState(1)
  const pageSize = 50

  const fetchData = React.useCallback(async (currentPage: number) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(currentPage), pageSize: String(pageSize) })
      const response = await readApiResultOrThrow<TemplatesResponse>(
        `/api/payment_link_pages/templates?${params.toString()}`
      )
      const items = (response.items ?? []).map((item) => ({
        id: String(item.id ?? ''),
        name: String(item.name ?? ''),
        description: item.description != null ? String(item.description) : null,
        isDefault: item.is_default === true || item.isDefault === true,
        createdAt: String(item.created_at ?? item.createdAt ?? ''),
      }))
      setData(items)
      setTotal(typeof response.total === 'number' ? response.total : items.length)
      setTotalPages(typeof response.totalPages === 'number' ? response.totalPages : Math.ceil((typeof response.total === 'number' ? response.total : items.length) / pageSize))
    } catch {
      flash(t('payment_link_pages.templates.empty'), 'error')
    } finally {
      setLoading(false)
    }
  }, [t])

  React.useEffect(() => {
    fetchData(page)
  }, [page, fetchData])

  const handleArchive = React.useCallback(async (row: TemplateRow) => {
    const confirmed = await confirm({
      title: t('payment_link_pages.templates.actions.archive'),
      text: t('payment_link_pages.templates.actions.archive.confirm'),
      confirmText: t('payment_link_pages.templates.actions.archive'),
      variant: 'destructive',
    })
    if (!confirmed) return
    try {
      await apiCallOrThrow(`/api/payment_link_pages/templates`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: row.id }),
      })
      flash(t('payment_link_pages.templates.deleted'), 'success')
      fetchData(page)
    } catch {
      flash(t('payment_link_pages.templates.deleteError', 'Failed to delete template'), 'error')
    }
  }, [confirm, t, fetchData, page])

  const handleSetDefault = React.useCallback(async (row: TemplateRow) => {
    try {
      await apiCallOrThrow(`/api/payment_link_pages/templates/${row.id}/set-default`, {
        method: 'POST',
      })
      flash(t('payment_link_pages.templates.setDefault.success'), 'success')
      fetchData(page)
    } catch {
      flash(t('payment_link_pages.templates.setDefault.error', 'Failed to set default template'), 'error')
    }
  }, [t, fetchData, page])

  const handleDuplicate = React.useCallback(async (row: TemplateRow) => {
    try {
      const detailRes = await readApiResultOrThrow<TemplatesResponse>(
        `/api/payment_link_pages/templates?id=${row.id}&pageSize=1`
      )
      const source = (detailRes.items ?? [])[0]
      if (!source) return
      await apiCallOrThrow('/api/payment_link_pages/templates', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: `${source.name} (copy)`,
          description: source.description,
          isDefault: false,
          branding: source.branding,
          defaultTitle: source.default_title ?? source.defaultTitle,
          defaultDescription: source.default_description ?? source.defaultDescription,
          customFields: source.custom_fields ?? source.customFields,
          customFieldsetCode: source.custom_fieldset_code ?? source.customFieldsetCode,
          customerCapture: source.customer_capture ?? source.customerCapture,
          metadata: source.metadata,
        }),
      })
      flash(t('payment_link_pages.templates.duplicate.success'), 'success')
      fetchData(page)
    } catch {
      flash(t('payment_link_pages.templates.duplicate.error', 'Failed to duplicate template'), 'error')
    }
  }, [t, fetchData, page])

  const columns = React.useMemo<ColumnDef<TemplateRow>[]>(() => [
    {
      accessorKey: 'name',
      header: t('payment_link_pages.templates.columns.name'),
      cell: ({ row }) => (
        <Link href={`/backend/payment-link-templates/${row.original.id}`} className="font-medium hover:underline">
          {row.original.name}
        </Link>
      ),
    },
    {
      accessorKey: 'isDefault',
      header: t('payment_link_pages.templates.columns.isDefault'),
      cell: ({ row }) => row.original.isDefault ? <Badge variant="default">{t('payment_link_pages.templates.badge.default', 'Default')}</Badge> : null,
    },
    {
      accessorKey: 'description',
      header: t('payment_link_pages.templates.columns.description'),
      cell: ({ row }) => (
        <span className="text-muted-foreground truncate max-w-[300px] block">
          {row.original.description ?? '—'}
        </span>
      ),
    },
    {
      accessorKey: 'createdAt',
      header: t('payment_link_pages.templates.columns.createdAt'),
      cell: ({ row }) => {
        const date = row.original.createdAt
        if (!date) return '—'
        try {
          return new Date(date).toLocaleDateString()
        } catch {
          return date
        }
      },
    },
  ], [t])

  return (
    <Page>
      <PageBody>
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold">{t('payment_link_pages.templates.title')}</h1>
            <p className="text-sm text-muted-foreground">{t('payment_link_pages.templates.description')}</p>
          </div>
          <Button asChild>
            <Link href="/backend/payment-link-templates/new">
              <Plus className="mr-2 h-4 w-4" />
              {t('payment_link_pages.templates.create.title')}
            </Link>
          </Button>
        </div>
        <DataTable
          columns={columns}
          data={data}
          isLoading={loading}
          rowActions={(row) => (
            <RowActions
              items={[
                {
                  id: 'edit',
                  label: t('payment_link_pages.templates.actions.edit'),
                  onSelect: () => router.push(`/backend/payment-link-templates/${row.id}`),
                },
                {
                  id: 'duplicate',
                  label: t('payment_link_pages.templates.actions.duplicate'),
                  onSelect: () => handleDuplicate(row),
                },
                ...(!row.isDefault ? [{
                  id: 'set-default',
                  label: t('payment_link_pages.templates.actions.setDefault'),
                  onSelect: () => handleSetDefault(row),
                }] : []),
                {
                  id: 'archive',
                  label: t('payment_link_pages.templates.actions.archive'),
                  destructive: true,
                  onSelect: () => handleArchive(row),
                },
              ]}
            />
          )}
          pagination={{
            page,
            pageSize,
            total,
            totalPages,
            onPageChange: setPage,
          }}
          emptyState={
            <div className="text-center py-8">
              <p className="text-muted-foreground">{t('payment_link_pages.templates.empty')}</p>
              <p className="text-sm text-muted-foreground">{t('payment_link_pages.templates.empty.description')}</p>
            </div>
          }
        />
        {ConfirmDialogElement}
      </PageBody>
    </Page>
  )
}
