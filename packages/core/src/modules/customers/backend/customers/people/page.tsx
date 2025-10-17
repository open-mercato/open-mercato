"use client"

import * as React from 'react'
import Link from 'next/link'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import type { ColumnDef } from '@tanstack/react-table'
import { Button } from '@open-mercato/ui/primitives/button'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { apiFetch } from '@open-mercato/ui/backend/utils/api'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useOrganizationScopeVersion } from '@/lib/frontend/useOrganizationScope'
import { useT } from '@/lib/i18n/context'

type PersonRow = {
  id: string
  name: string
  description?: string | null
  email?: string | null
  phone?: string | null
  status?: string | null
  lifecycleStage?: string | null
  nextInteractionAt?: string | null
  nextInteractionName?: string | null
  organizationId?: string | null
  source?: string | null
}

type PeopleResponse = {
  items?: Array<Record<string, unknown>>
  total?: number
  page?: number
  totalPages?: number
}

function formatDate(value: string | null | undefined, fallback: string): string {
  if (!value) return fallback
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return fallback
  return date.toLocaleDateString()
}

function mapApiItem(item: Record<string, unknown>): PersonRow | null {
  const id = typeof item.id === 'string' ? item.id : null
  if (!id) return null
  const name = typeof item.display_name === 'string' ? item.display_name : ''
  const description = typeof item.description === 'string' ? item.description : null
  const email = typeof item.primary_email === 'string' ? item.primary_email : null
  const phone = typeof item.primary_phone === 'string' ? item.primary_phone : null
  const status = typeof item.status === 'string' ? item.status : null
  const lifecycleStage = typeof item.lifecycle_stage === 'string' ? item.lifecycle_stage : null
  const nextInteractionAt = typeof item.next_interaction_at === 'string' ? item.next_interaction_at : null
  const nextInteractionName = typeof item.next_interaction_name === 'string' ? item.next_interaction_name : null
  const organizationId = typeof item.organization_id === 'string' ? item.organization_id : null
  const source = typeof item.source === 'string' ? item.source : null
  return {
    id,
    name,
    description,
    email,
    phone,
    status,
    lifecycleStage,
    nextInteractionAt,
    nextInteractionName,
    organizationId,
    source,
  }
}

export default function CustomersPeoplePage() {
  const [rows, setRows] = React.useState<PersonRow[]>([])
  const [page, setPage] = React.useState(1)
  const [pageSize] = React.useState(20)
  const [total, setTotal] = React.useState(0)
  const [totalPages, setTotalPages] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const [isLoading, setIsLoading] = React.useState(true)
  const [reloadToken, setReloadToken] = React.useState(0)
  const scopeVersion = useOrganizationScopeVersion()
  const t = useT()

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setIsLoading(true)
      try {
        const params = new URLSearchParams()
        params.set('page', String(page))
        params.set('pageSize', String(pageSize))
        if (search.trim()) params.set('search', search.trim())
        const res = await apiFetch(`/api/customers/people?${params.toString()}`)
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          const message = typeof data?.error === 'string' ? data.error : t('customers.people.list.error.load')
          flash(message, 'error')
          return
        }
        const payload: PeopleResponse = await res.json().catch(() => ({}))
        if (cancelled) return
        const items = Array.isArray(payload.items) ? payload.items : []
        setRows(items.map((item) => mapApiItem(item as Record<string, unknown>)).filter((row): row is PersonRow => !!row))
        setTotal(typeof payload.total === 'number' ? payload.total : items.length)
        setTotalPages(typeof payload.totalPages === 'number' ? payload.totalPages : 1)
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : t('customers.people.list.error.load')
          flash(message, 'error')
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [page, pageSize, search, reloadToken, scopeVersion, t])

  const handleRefresh = React.useCallback(() => {
    setReloadToken((token) => token + 1)
  }, [])

  const columns = React.useMemo<ColumnDef<PersonRow>[]>(() => [
    {
      accessorKey: 'name',
      header: t('customers.people.list.columns.name'),
      cell: ({ row }) => (
        <Link href={`/backend/customers/people/${row.original.id}`} className="font-medium hover:underline">
          {row.original.name}
        </Link>
      ),
    },
    {
      accessorKey: 'email',
      header: t('customers.people.list.columns.email'),
      cell: ({ row }) => row.original.email || <span className="text-muted-foreground text-sm">{t('customers.people.list.noValue')}</span>,
    },
    {
      accessorKey: 'status',
      header: t('customers.people.list.columns.status'),
      cell: ({ row }) => row.original.status || <span className="text-muted-foreground text-sm">{t('customers.people.list.noValue')}</span>,
    },
    {
      accessorKey: 'nextInteractionAt',
      header: t('customers.people.list.columns.nextInteraction'),
      cell: ({ row }) =>
        row.original.nextInteractionAt
          ? (
            <span className="flex flex-col text-sm">
              <span>{formatDate(row.original.nextInteractionAt, t('customers.people.list.noValue'))}</span>
              {row.original.nextInteractionName && (
                <span className="text-xs text-muted-foreground">{row.original.nextInteractionName}</span>
              )}
            </span>
          )
          : <span className="text-muted-foreground text-sm">{t('customers.people.list.noValue')}</span>,
    },
    {
      accessorKey: 'source',
      header: t('customers.people.list.columns.source'),
      cell: ({ row }) => row.original.source || <span className="text-muted-foreground text-sm">{t('customers.people.list.noValue')}</span>,
    },
  ], [t])

  return (
    <Page>
      <PageBody>
        <DataTable<PersonRow>
          title={t('customers.people.list.title')}
          actions={(
            <div className="flex items-center gap-2">
              <Button variant="secondary" onClick={() => { setSearch(''); setPage(1); handleRefresh() }}>
                {t('customers.people.list.actions.refresh')}
              </Button>
              <Button asChild>
                <Link href="/backend/customers/people/create">
                  {t('customers.people.list.actions.new')}
                </Link>
              </Button>
            </div>
          )}
          columns={columns}
          data={rows}
          searchValue={search}
          onSearchChange={(value) => { setSearch(value); setPage(1) }}
          rowActions={(row) => (
            <RowActions
              items={[
                {
                  label: t('customers.people.list.actions.view'),
                  onSelect: () => { window.location.href = `/backend/customers/people/${row.original.id}` },
                },
                {
                  label: t('customers.people.list.actions.openInNewTab'),
                  onSelect: () => window.open(`/backend/customers/people/${row.original.id}`, '_blank'),
                },
              ]}
            />
          )}
          pagination={{ page, pageSize, total, totalPages, onPageChange: setPage }}
          isLoading={isLoading}
        />
      </PageBody>
    </Page>
  )
}
