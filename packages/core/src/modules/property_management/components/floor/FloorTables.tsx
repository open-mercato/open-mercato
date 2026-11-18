"use client"

import * as React from 'react'
import { GatedLink } from '../featureLinks'
import { useRouter } from 'next/navigation'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { useLocale, useT, type TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { formatMetres, rectArea, type FloorLayoutData, type LayoutCommonArea, type LayoutSpace, type LayoutUnit } from './types'
import { useGuardedDelete } from '../placement/useGuardedDelete'
import { AvailabilityCell, AvailabilityStateProvider } from '../availability/AvailabilityCell'
import type { UnavailabilitiesState } from '../availability/useUnavailabilities'
import { usePlural } from '../plural'

export type FloorTablesProps = {
  layout: FloorLayoutData
  onChanged: () => void
  availability: UnavailabilitiesState
  readOnly?: boolean
}

function sizeLabel(t: TranslateFn, row: { width: number; depth: number }, locale: string): string {
  return t('property_management.common.sizeMetres', '{width} × {depth} m', { width: formatMetres(row.width, locale), depth: formatMetres(row.depth, locale) })
}

function areaLabel(t: TranslateFn, row: { x: number; y: number; width: number; depth: number }, locale: string): string {
  return t('property_management.common.areaSquareMetres', '{area} m²', { area: formatMetres(rectArea(row), locale) })
}

function positionLabel(row: { x: number; y: number }, locale: string): string {
  return `${formatMetres(row.x, locale)}, ${formatMetres(row.y, locale)}`
}

export function FloorTables({ layout, onChanged, availability, readOnly = false }: FloorTablesProps) {
  const t = useT()
  const locale = useLocale()
  const { count } = usePlural()
  const router = useRouter()
  const { remove, ConfirmDialogElement } = useGuardedDelete('property-management-floor-tables')
  const spaceNames = React.useMemo(() => new Map(layout.spaces.map((space) => [space.id, space.name])), [layout.spaces])
  const floorArea = rectArea({ x: 0, y: 0, width: layout.floor.sizeX, depth: layout.floor.sizeY })
  const spacedArea = layout.spaces.reduce((sum, space) => sum + rectArea(space), 0)
  const archived = layout.building.status === 'archived'
  const floorAncestors = React.useMemo(
    () => [{ type: 'floor' as const, id: layout.floor.id }, { type: 'building' as const, id: layout.building.id }],
    [layout.building.id, layout.floor.id],
  )
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
    { id: 'position', header: t('property_management.spaces.columns.position', 'Position (x, y)'), cell: ({ row }) => positionLabel(row.original, locale) },
    { id: 'size', header: t('property_management.spaces.columns.size', 'Size'), cell: ({ row }) => sizeLabel(t, row.original, locale) },
    { id: 'area', header: t('property_management.spaces.columns.area', 'Area'), cell: ({ row }) => areaLabel(t, row.original, locale) },
    { accessorKey: 'unitCount', header: t('property_management.spaces.columns.units', 'Units') },
    {
      id: 'available',
      header: t('property_management.availability.column', 'Available'),
      meta: { truncate: false },
      cell: ({ row }) => (
        <AvailabilityCell subject={{ type: 'space', id: row.original.id, name: row.original.name }} ancestors={floorAncestors} disabled={archived} />
      ),
    },
  ], [archived, floorAncestors, locale, t])

  const unitColumns = React.useMemo<ColumnDef<LayoutUnit>[]>(() => [
    { accessorKey: 'name', header: t('property_management.units.columns.name', 'Unit'), meta: { maxWidth: '220px', truncate: true } },
    { id: 'space', header: t('property_management.units.columns.space', 'Space'), cell: ({ row }) => spaceNames.get(row.original.spaceId) ?? '—' },
    { id: 'type', header: t('property_management.units.columns.type', 'Type'), cell: ({ row }) => row.original.categoryName ?? '—' },
    {
      id: 'product',
      header: t('property_management.units.columns.product', 'Product'),
      cell: ({ row }) => (
        <GatedLink
          target="product"
          href={`/backend/catalog/products/${row.original.catalogProductId}`}
          onClick={(event) => event.stopPropagation()}
        >
          {row.original.productName ?? t('property_management.units.productMissing', 'Product missing')}
        </GatedLink>
      ),
    },
    { id: 'size', header: t('property_management.units.columns.size', 'Size'), cell: ({ row }) => sizeLabel(t, row.original, locale) },
    { id: 'area', header: t('property_management.units.columns.area', 'Area'), cell: ({ row }) => areaLabel(t, row.original, locale) },
    {
      id: 'use',
      header: t('property_management.units.columns.use', 'Use'),
      cell: ({ row }) => row.original.use
        ? t(`property_management.units.use.${row.original.use}`, row.original.use)
        : <span className="text-muted-foreground">—</span>,
    },
    {
      id: 'available',
      header: t('property_management.availability.column', 'Available'),
      meta: { truncate: false },
      cell: ({ row }) => (
        <AvailabilityCell
          subject={{ type: 'unit', id: row.original.id, name: row.original.name }}
          ancestors={[{ type: 'space', id: row.original.spaceId }, ...floorAncestors]}
          disabled={archived}
        />
      ),
    },
  ], [archived, floorAncestors, locale, spaceNames, t])

  const areaColumns = React.useMemo<ColumnDef<LayoutCommonArea>[]>(() => [
    { accessorKey: 'name', header: t('property_management.commonAreas.columns.name', 'Common area'), meta: { maxWidth: '220px', truncate: true } },
    { id: 'kind', header: t('property_management.commonAreas.columns.kind', 'Kind'), cell: ({ row }) => kindLabel(row.original.kind) },
    { id: 'position', header: t('property_management.commonAreas.columns.position', 'Position (x, y)'), cell: ({ row }) => positionLabel(row.original, locale) },
    { id: 'size', header: t('property_management.commonAreas.columns.size', 'Size'), cell: ({ row }) => sizeLabel(t, row.original, locale) },
    { id: 'area', header: t('property_management.commonAreas.columns.area', 'Area'), cell: ({ row }) => areaLabel(t, row.original, locale) },
  ], [kindLabel, locale, t])

  const deleteSpace = (space: LayoutSpace) => remove({
    resource: 'spaces',
    resourceKind: 'property_management.space',
    id: space.id,
    updatedAt: space.updatedAt,
    title: t('property_management.spaces.delete.title', 'Delete {name}?', { name: space.name }),
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
    <AvailabilityStateProvider value={availability}>
      <DataTable<LayoutSpace>
        title={t('property_management.spaces.list.title', 'Spaces')}
        actions={(
          <span className="text-sm text-muted-foreground">
            {t('property_management.spaces.list.summary', '{spaces} · {spaced} of {total} m² of the floor is in a space', {
              spaces: count('spaces', layout.spaces.length),
              spaced: formatMetres(spacedArea, locale),
              total: formatMetres(floorArea, locale),
            })}
          </span>
        )}
        columns={spaceColumns}
        data={layout.spaces}
        onRowClick={readOnly ? undefined : (row) => router.push(`/backend/property_management/spaces/${row.id}`)}
        rowActions={readOnly ? undefined : (row) => (
          <RowActions
            items={[
              { id: 'edit', label: t('property_management.common.edit', 'Edit'), onSelect: () => router.push(`/backend/property_management/spaces/${row.id}`) },
              ...(row.unitCount
                ? []
                : [{ id: 'delete', label: t('property_management.common.delete', 'Delete'), destructive: true, onSelect: () => { void deleteSpace(row) } }]),
            ]}
          />
        )}
      />
      <DataTable<LayoutUnit>
        title={t('property_management.units.list.title', 'Units')}
        actions={(
          <span className="text-sm text-muted-foreground">
            {t('property_management.units.list.summary', '{units} — {leasable} leasable, {bookable} bookable', {
              units: count('units', layout.units.length),
              leasable,
              bookable,
            })}
          </span>
        )}
        columns={unitColumns}
        data={layout.units}
        onRowClick={readOnly ? undefined : (row) => router.push(`/backend/property_management/units/${row.id}`)}
        rowActions={readOnly ? undefined : (row) => (
          <RowActions
            items={[{ id: 'edit', label: t('property_management.common.edit', 'Edit'), onSelect: () => router.push(`/backend/property_management/units/${row.id}`) }]}
          />
        )}
      />
      <DataTable<LayoutCommonArea>
        title={t('property_management.commonAreas.list.title', 'Common areas')}
        actions={(
          <span className="text-sm text-muted-foreground">
            {t('property_management.commonAreas.list.summary', '{areas} · {area} m² — not leasable, not bookable', {
              areas: count('commonAreas', layout.commonAreas.length),
              area: formatMetres(layout.commonAreas.reduce((sum, area) => sum + rectArea(area), 0), locale),
            })}
          </span>
        )}
        columns={areaColumns}
        data={layout.commonAreas}
        onRowClick={readOnly ? undefined : (row) => router.push(`/backend/property_management/common-areas/${row.id}`)}
        rowActions={readOnly ? undefined : (row) => (
          <RowActions
            items={[
              { id: 'edit', label: t('property_management.common.edit', 'Edit'), onSelect: () => router.push(`/backend/property_management/common-areas/${row.id}`) },
              { id: 'delete', label: t('property_management.common.delete', 'Delete'), destructive: true, onSelect: () => { void deleteArea(row) } },
            ]}
          />
        )}
      />
      {ConfirmDialogElement}
    </AvailabilityStateProvider>
  )
}
