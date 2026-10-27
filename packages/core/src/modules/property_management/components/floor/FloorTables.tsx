"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { formatMetres, rectArea, type FloorLayoutData, type LayoutCommonArea, type LayoutSpace, type LayoutUnit } from './types'
import { useGuardedDelete } from '../placement/useGuardedDelete'

export type FloorTablesProps = { layout: FloorLayoutData; onChanged: () => void }

function sizeLabel(row: { width: number; depth: number }): string {
  return `${formatMetres(row.width)} × ${formatMetres(row.depth)} m`
}

function positionLabel(row: { x: number; y: number }): string {
  return `${formatMetres(row.x)}, ${formatMetres(row.y)}`
}

export function FloorTables({ layout, onChanged }: FloorTablesProps) {
  const t = useT()
  const router = useRouter()
  const { remove, ConfirmDialogElement } = useGuardedDelete('property-management-floor-tables')
  const spaceNames = React.useMemo(() => new Map(layout.spaces.map((space) => [space.id, space.name])), [layout.spaces])
  const floorArea = rectArea({ x: 0, y: 0, width: layout.floor.sizeX, depth: layout.floor.sizeY })
  const spacedArea = layout.spaces.reduce((sum, space) => sum + rectArea(space), 0)
  const kindLabel = React.useCallback(
    (kind: string) => t(`property_management.commonAreas.kind.${kind}`, kind),
    [t],
  )

  const spaceColumns = React.useMemo<ColumnDef<LayoutSpace>[]>(() => [
    { accessorKey: 'name', header: t('property_management.spaces.columns.name', 'Space'), meta: { maxWidth: '220px', truncate: true } },
    {
      accessorKey: 'purpose',
      header: t('property_management.spaces.columns.purpose', 'Purpose'),
      meta: { maxWidth: '260px', truncate: true },
      cell: ({ row }) => row.original.purpose ?? <span className="text-muted-foreground">—</span>,
    },
    { id: 'position', header: t('property_management.spaces.columns.position', 'Position (x, y)'), cell: ({ row }) => positionLabel(row.original) },
    { id: 'size', header: t('property_management.spaces.columns.size', 'Size'), cell: ({ row }) => sizeLabel(row.original) },
    { id: 'area', header: t('property_management.spaces.columns.area', 'Area'), cell: ({ row }) => `${formatMetres(rectArea(row.original))} m²` },
    { accessorKey: 'unitCount', header: t('property_management.spaces.columns.units', 'Units') },
  ], [t])

  const unitColumns = React.useMemo<ColumnDef<LayoutUnit>[]>(() => [
    { accessorKey: 'name', header: t('property_management.units.columns.name', 'Unit'), meta: { maxWidth: '220px', truncate: true } },
    { id: 'space', header: t('property_management.units.columns.space', 'Space'), cell: ({ row }) => spaceNames.get(row.original.spaceId) ?? '—' },
    { id: 'type', header: t('property_management.units.columns.type', 'Type'), cell: ({ row }) => row.original.categoryName ?? '—' },
    {
      id: 'product',
      header: t('property_management.units.columns.product', 'Product'),
      cell: ({ row }) => (
        <Link
          href={`/backend/catalog/products/${row.original.catalogProductId}`}
          className="hover:underline"
          onClick={(event) => event.stopPropagation()}
        >
          {row.original.productName ?? t('property_management.units.productMissing', 'Product missing')}
        </Link>
      ),
    },
    { id: 'size', header: t('property_management.units.columns.size', 'Size'), cell: ({ row }) => sizeLabel(row.original) },
    { id: 'area', header: t('property_management.units.columns.area', 'Area'), cell: ({ row }) => `${formatMetres(rectArea(row.original))} m²` },
    {
      id: 'use',
      header: t('property_management.units.columns.use', 'Use'),
      cell: ({ row }) => row.original.use
        ? t(`property_management.units.use.${row.original.use}`, row.original.use)
        : <span className="text-muted-foreground">—</span>,
    },
  ], [spaceNames, t])

  const areaColumns = React.useMemo<ColumnDef<LayoutCommonArea>[]>(() => [
    { accessorKey: 'name', header: t('property_management.commonAreas.columns.name', 'Common area'), meta: { maxWidth: '220px', truncate: true } },
    { id: 'kind', header: t('property_management.commonAreas.columns.kind', 'Kind'), cell: ({ row }) => kindLabel(row.original.kind) },
    { id: 'position', header: t('property_management.commonAreas.columns.position', 'Position (x, y)'), cell: ({ row }) => positionLabel(row.original) },
    { id: 'size', header: t('property_management.commonAreas.columns.size', 'Size'), cell: ({ row }) => sizeLabel(row.original) },
    { id: 'area', header: t('property_management.commonAreas.columns.area', 'Area'), cell: ({ row }) => `${formatMetres(rectArea(row.original))} m²` },
  ], [kindLabel, t])

  const deleteSpace = (space: LayoutSpace) => remove({
    resource: 'spaces',
    resourceKind: 'property_management.space',
    id: space.id,
    updatedAt: space.updatedAt,
    title: t('property_management.spaces.delete.title', 'Delete {name}?', { name: space.name }),
    description: space.unitCount
      ? t('property_management.spaces.delete.hasUnits', 'It still has {count} units. Move or delete them first.', { count: space.unitCount })
      : undefined,
    successMessage: t('property_management.spaces.delete.success', 'Space deleted.'),
    errorMessage: t('property_management.spaces.delete.error', 'Could not delete the space.'),
    onDeleted: onChanged,
    onRefresh: onChanged,
  })

  const deleteArea = (area: LayoutCommonArea) => remove({
    resource: 'common-areas',
    resourceKind: 'property_management.common_area',
    id: area.id,
    updatedAt: area.updatedAt,
    title: t('property_management.commonAreas.delete.title', 'Delete {name}?', { name: area.name }),
    successMessage: t('property_management.commonAreas.delete.success', 'Common area deleted.'),
    errorMessage: t('property_management.commonAreas.delete.error', 'Could not delete the common area.'),
    onDeleted: onChanged,
    onRefresh: onChanged,
  })

  const leasable = layout.units.filter((unit) => unit.use === 'leasable').length
  const bookable = layout.units.filter((unit) => unit.use === 'bookable').length

  return (
    <>
      <DataTable<LayoutSpace>
        title={t('property_management.spaces.list.title', 'Spaces')}
        actions={(
          <span className="text-sm text-muted-foreground">
            {t('property_management.spaces.list.summary', '{count} spaces · {spaced} of {total} m² of the floor is in a space', {
              count: layout.spaces.length,
              spaced: formatMetres(spacedArea),
              total: formatMetres(floorArea),
            })}
          </span>
        )}
        columns={spaceColumns}
        data={layout.spaces}
        onRowClick={(row) => router.push(`/backend/property_management/spaces/${row.id}`)}
        rowActions={(row) => (
          <RowActions
            items={[
              { id: 'edit', label: t('property_management.common.edit', 'Edit'), onSelect: () => router.push(`/backend/property_management/spaces/${row.id}`) },
              { id: 'delete', label: t('property_management.common.delete', 'Delete'), destructive: true, onSelect: () => { void deleteSpace(row) } },
            ]}
          />
        )}
      />
      <DataTable<LayoutUnit>
        title={t('property_management.units.list.title', 'Units')}
        actions={(
          <span className="text-sm text-muted-foreground">
            {t('property_management.units.list.summary', '{count} units — {leasable} leasable, {bookable} bookable', {
              count: layout.units.length,
              leasable,
              bookable,
            })}
          </span>
        )}
        columns={unitColumns}
        data={layout.units}
        onRowClick={(row) => router.push(`/backend/property_management/units/${row.id}`)}
        rowActions={(row) => (
          <RowActions
            items={[{ id: 'edit', label: t('property_management.common.edit', 'Edit'), onSelect: () => router.push(`/backend/property_management/units/${row.id}`) }]}
          />
        )}
      />
      <DataTable<LayoutCommonArea>
        title={t('property_management.commonAreas.list.title', 'Common areas')}
        actions={(
          <span className="text-sm text-muted-foreground">
            {t('property_management.commonAreas.list.summary', '{count} common areas · {area} m² — not leasable, not bookable', {
              count: layout.commonAreas.length,
              area: formatMetres(layout.commonAreas.reduce((sum, area) => sum + rectArea(area), 0)),
            })}
          </span>
        )}
        columns={areaColumns}
        data={layout.commonAreas}
        onRowClick={(row) => router.push(`/backend/property_management/common-areas/${row.id}`)}
        rowActions={(row) => (
          <RowActions
            items={[
              { id: 'edit', label: t('property_management.common.edit', 'Edit'), onSelect: () => router.push(`/backend/property_management/common-areas/${row.id}`) },
              { id: 'delete', label: t('property_management.common.delete', 'Delete'), destructive: true, onSelect: () => { void deleteArea(row) } },
            ]}
          />
        )}
      />
      {ConfirmDialogElement}
    </>
  )
}
