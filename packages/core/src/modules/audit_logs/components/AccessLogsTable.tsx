'use client'

import * as React from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@open-mercato/ui/backend/DataTable'

export type AccessLogItem = {
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

export function AccessLogsTable({ items, actions }: { items: AccessLogItem[]; actions?: React.ReactNode }) {
  const columns = React.useMemo<ColumnDef<AccessLogItem, any>[]>(() => [
    {
      accessorKey: 'resourceKind',
      header: 'Resource',
      cell: (info) => formatResource(info.row.original),
    },
    {
      accessorKey: 'accessType',
      header: 'Access',
    },
    {
      accessorKey: 'actorUserId',
      header: 'User',
      cell: (info) => info.getValue() || '—',
      meta: { priority: 3 },
    },
    {
      accessorKey: 'tenantId',
      header: 'Tenant',
      cell: (info) => info.getValue() || '—',
      meta: { priority: 4 },
    },
    {
      accessorKey: 'organizationId',
      header: 'Organization',
      cell: (info) => info.getValue() || '—',
      meta: { priority: 4 },
    },
    {
      accessorKey: 'fields',
      header: 'Fields',
      cell: (info) => {
        const value = info.getValue() as string[]
        return value?.length ? value.join(', ') : '—'
      },
    },
    {
      accessorKey: 'createdAt',
      header: 'When',
      cell: (info) => formatDate(info.getValue() as string),
    },
  ], [])

  return (
    <DataTable<AccessLogItem>
      title="Access Log"
      data={items}
      columns={columns}
      actions={actions}
    />
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
