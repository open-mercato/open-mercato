'use client'

import * as React from 'react'
import { extensionPoints } from '@open-mercato/core/modules/audit_logs/extension-points'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { DataTable, type PaginationProps } from '@open-mercato/ui/backend/DataTable'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { formatDisplayDateTime } from '@open-mercato/ui/primitives/date-format'
import { AccessLogDetailsDialog } from './AccessLogDetailsDialog'
import {
  ACCESS_LOG_OUTCOME_VARIANTS,
  readAccessLogDurationMs,
  readAccessLogOutcome,
} from '../lib/accessLogContext'

export type AccessLogItem = {
  id: string
  resourceKind: string
  resourceId: string
  accessType: string
  actorUserId: string | null
  actorUserName: string | null
  tenantId: string | null
  tenantName: string | null
  organizationId: string | null
  organizationName: string | null
  fields: string[]
  context: Record<string, unknown> | null
  createdAt: string
}

export type AccessLogsTableProps = {
  items: AccessLogItem[] | undefined
  isLoading?: boolean
  actions?: React.ReactNode
  pagination?: PaginationProps
  filters?: FilterDef[]
  filterValues?: FilterValues
  onFiltersApply?: (values: FilterValues) => void
  onFiltersClear?: () => void
}

export function AccessLogsTable({ items, isLoading, actions, pagination, filters, filterValues, onFiltersApply, onFiltersClear }: AccessLogsTableProps) {
  const t = useT()
  const locale = useLocale()
  const accessItems = Array.isArray(items) ? items : []
  const noneLabel = t('audit_logs.common.none')
  const [selected, setSelected] = React.useState<AccessLogItem | null>(null)

  const columns = React.useMemo<ColumnDef<AccessLogItem, any>[]>(() => [
    {
      accessorKey: 'resourceKind',
      header: t('audit_logs.access.columns.resource'),
      cell: (info) => formatResource(info.row.original, noneLabel),
    },
    {
      accessorKey: 'accessType',
      header: t('audit_logs.access.columns.access'),
    },
    {
      id: 'outcome',
      header: t('audit_logs.access.columns.outcome'),
      cell: (info) => {
        const outcome = readAccessLogOutcome(info.row.original.context)
        if (!outcome) return noneLabel
        return (
          <StatusBadge variant={ACCESS_LOG_OUTCOME_VARIANTS[outcome]} dot>
            {t(`audit_logs.access.outcome.${outcome}`)}
          </StatusBadge>
        )
      },
    },
    {
      id: 'duration',
      header: t('audit_logs.access.columns.duration'),
      cell: (info) => {
        const durationMs = readAccessLogDurationMs(info.row.original.context)
        return durationMs === null ? noneLabel : t('audit_logs.access.duration_ms', { value: durationMs })
      },
      meta: { priority: 3 },
    },
    {
      accessorKey: 'actorUserId',
      header: t('audit_logs.access.columns.user'),
      cell: (info) => info.row.original.actorUserName || noneLabel,
      meta: { priority: 3 },
    },
    {
      accessorKey: 'tenantId',
      header: t('audit_logs.access.columns.tenant'),
      cell: (info) => info.row.original.tenantName || info.getValue() || noneLabel,
      meta: { priority: 4 },
    },
    {
      accessorKey: 'organizationId',
      header: t('audit_logs.access.columns.organization'),
      cell: (info) => info.row.original.organizationName || info.getValue() || noneLabel,
      meta: { priority: 4 },
    },
    {
      accessorKey: 'fields',
      header: t('audit_logs.access.columns.fields'),
      cell: (info) => {
        const value = info.getValue() as string[]
        return value?.length ? value.join(', ') : noneLabel
      },
    },
    {
      accessorKey: 'createdAt',
      header: t('audit_logs.access.columns.when'),
      cell: (info) => formatDate(info.getValue() as string, locale),
    },
  ], [t, noneLabel, locale])

  return (
    <>
      <DataTable<AccessLogItem>
        title={t('audit_logs.access.title')}
        titleHeadingLevel={2}
        data={accessItems}
        columns={columns}
        perspective={{ tableId: extensionPoints.hosts.accessLogsTable.tableId }}
        isLoading={Boolean(isLoading)}
        actions={actions}
        pagination={pagination}
        filters={filters}
        filterValues={filterValues}
        onFiltersApply={onFiltersApply}
        onFiltersClear={onFiltersClear}
        onRowClick={(item) => setSelected(item)}
      />
      {selected ? <AccessLogDetailsDialog item={selected} onClose={() => setSelected(null)} /> : null}
    </>
  )
}

function formatResource(item: { resourceKind?: string | null; resourceId?: string | null }, fallback: string) {
  if (!item.resourceKind && !item.resourceId) return fallback
  return [item.resourceKind, item.resourceId].filter(Boolean).join(' · ')
}

function formatDate(value: string, locale?: string) {
  return formatDisplayDateTime(value, locale) ?? value
}
