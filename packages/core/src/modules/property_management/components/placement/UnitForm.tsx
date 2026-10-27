"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { CrudField, CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { createCrud, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import type { PlacementIssue } from '../../lib/geometry'
import { floorHref, formatMetres } from '../floor/types'
import { PlacementEditor } from './PlacementEditor'
import { PlacementFormShell, PlacementPageState } from './PlacementFormShell'
import { toNumber } from './placementModel'
import { UnitProductField, useCatalogCategories } from './UnitProductField'
import { UnitProductHistory, useUnitProductInfo, type UsageBlockerRow } from './UnitProductHistory'
import { useGuardedDelete } from './useGuardedDelete'
import { usePlacementHost, type PlacementRecord } from './usePlacementHost'

type UnitRecord = PlacementRecord & {
  name: string
  spaceId: string
  catalogCategoryId: string
  catalogProductId: string
  x: number
  y: number
  width: number
  depth: number
  blockers?: UsageBlockerRow[]
}

type UnitValues = {
  id?: string
  name: string
  spaceId: string
  catalogCategoryId: string
  catalogProductId: string
  x: number
  y: number
  width: number
  depth: number
  updatedAt?: string | null
}

const FORM_ID = 'property-management-unit-form'

export function UnitForm({ unitId }: { unitId?: string | null }) {
  const t = useT()
  const router = useRouter()
  const recordId = unitId || null
  const host = usePlacementHost<UnitRecord>('units', recordId)
  const { categories } = useCatalogCategories()
  const { info } = useUnitProductInfo(recordId)
  const [issues, setIssues] = React.useState<PlacementIssue[]>([])
  const { remove, ConfirmDialogElement } = useGuardedDelete(FORM_ID)
  const layout = host.layout
  const record = host.record
  const backHref = layout ? floorHref(layout.building.id, layout.floor.id) : '/backend/property_management/buildings'
  const lockedReason = info?.productLocked
    ? t('property_management.units.form.productLocked', 'Locked while the unit is leased — the lease was signed for this product.')
    : null

  const initialValues = React.useMemo<Partial<UnitValues>>(() => {
    if (record) {
      return {
        id: record.id,
        name: record.name,
        spaceId: record.spaceId,
        catalogCategoryId: record.catalogCategoryId,
        catalogProductId: record.catalogProductId,
        x: record.x,
        y: record.y,
        width: record.width,
        depth: record.depth,
        updatedAt: record.updatedAt,
      }
    }
    const space = layout?.spaces[0] ?? null
    return {
      name: '',
      spaceId: space?.id ?? '',
      catalogCategoryId: '',
      catalogProductId: '',
      x: space?.x ?? 0,
      y: space?.y ?? 0,
      width: Math.min(4, space?.width ?? 4),
      depth: Math.min(3, space?.depth ?? 3),
    }
  }, [layout, record])

  const categoryNames = React.useMemo(() => new Map(categories.map((category) => [category.id, category.name])), [categories])

  const fields = React.useMemo<CrudField[]>(() => [
    { id: 'name', label: t('property_management.units.form.name', 'Name'), type: 'text', required: true },
    {
      id: 'spaceId',
      label: t('property_management.units.form.space', 'Space'),
      type: 'select',
      required: true,
      options: (layout?.spaces ?? []).map((space) => ({
        value: space.id,
        label: t('property_management.units.form.spaceOption', '{name} — {width} × {depth} m at {x}, {y}', {
          name: space.name,
          width: formatMetres(space.width),
          depth: formatMetres(space.depth),
          x: formatMetres(space.x),
          y: formatMetres(space.y),
        }),
      })),
    },
    {
      id: 'catalogCategoryId',
      label: t('property_management.units.form.type', 'Type'),
      type: 'select',
      required: true,
      disabled: Boolean(lockedReason),
      description: t('property_management.units.form.typeHint', 'Categories from the product catalog.'),
      options: categories.map((category) => ({ value: category.id, label: `${'· '.repeat(category.depth)}${category.name}` })),
    },
    {
      id: 'catalogProductId',
      label: t('property_management.units.form.product', 'Product'),
      type: 'custom',
      required: true,
      component: (props) => (
        <UnitProductField
          {...props}
          lockedReason={lockedReason}
          categoryName={typeof props.values?.catalogCategoryId === 'string' ? categoryNames.get(props.values.catalogCategoryId) ?? null : null}
        />
      ),
    },
    { id: 'width', label: t('property_management.units.form.width', 'Width, metres'), type: 'number', required: true, layout: 'half' },
    { id: 'depth', label: t('property_management.units.form.depth', 'Depth, metres'), type: 'number', required: true, layout: 'half' },
  ], [categories, categoryNames, layout, lockedReason, t])

  const groups = React.useMemo<CrudFormGroup[]>(() => {
    if (!layout) return []
    return [
      {
        id: 'details',
        title: t('property_management.units.form.details', 'Unit'),
        fields: ['name', 'spaceId', 'catalogCategoryId', 'catalogProductId', 'width', 'depth'],
      },
      {
        id: 'placement',
        title: t('property_management.placement.previewTitle', 'Preview'),
        component: ({ values, setValue }) => (
          <PlacementEditor
            kind="unit"
            layout={layout}
            selfId={record?.id ?? null}
            label={String(values.name || t('property_management.units.form.newLabel', 'New unit'))}
            values={values}
            setValue={setValue}
            current={record}
            onIssuesChange={setIssues}
          />
        ),
      },
    ]
  }, [layout, record, t])

  if (host.loading || host.notFound || host.error || !layout) {
    return <PlacementPageState loading={host.loading} notFound={host.notFound || (!host.loading && !layout && !host.error)} error={host.error} backHref={backHref} />
  }

  const blockers = record?.blockers ?? []
  const upcoming = info?.upcomingBookings ?? []
  const contentHeader = (
    <>
      {info?.activeLeases.length ? (
        <Alert status="information">
          <AlertDescription>
            {t('property_management.units.form.leasedNotice', 'Active lease {lease}. You can still move or resize this unit; its type and product are locked and it cannot be deleted while the lease is active.', {
              lease: info.activeLeases.map((lease) => lease.label).join(', '),
            })}
          </AlertDescription>
        </Alert>
      ) : null}
      {upcoming.length ? (
        <Alert status="information">
          <AlertDescription>
            {t('property_management.units.form.bookingsNotice', 'This unit has {count} upcoming bookings. They keep the product and price they were made at; new bookings use the new product.', {
              count: upcoming.length,
            })}
          </AlertDescription>
        </Alert>
      ) : null}
    </>
  )

  return (
    <>
      <PlacementFormShell<UnitValues>
        title={record ? record.name : t('property_management.units.form.createTitle', 'New unit')}
        subtitle={t('property_management.units.form.subtitle', '{floor} · {building} · {x} × {y} m', {
          floor: layout.floor.name,
          building: layout.building.name,
          x: formatMetres(layout.floor.sizeX),
          y: formatMetres(layout.floor.sizeY),
        })}
        backHref={backHref}
        formId={FORM_ID}
        fields={fields}
        groups={groups}
        initialValues={initialValues}
        submitLabel={record ? t('property_management.common.saveChanges', 'Save changes') : t('property_management.units.form.create', 'Create unit')}
        blocked={issues.length > 0}
        blockedMessage={t('property_management.placement.blocked', 'Fix the placement before saving.')}
        contentHeader={contentHeader}
        deleteLabel={t('property_management.units.form.delete', 'Delete unit')}
        deleteDisabledReason={blockers.length
          ? t('property_management.units.form.deleteBlocked', 'Cancel {items} first — a unit with a lease or bookings cannot be deleted.', {
              items: blockers.map((blocker) => blocker.label).join(', '),
            })
          : null}
        onDelete={record ? async () => {
          const done = await remove({
            resource: 'units',
            resourceKind: 'property_management.unit',
            id: record.id,
            updatedAt: record.updatedAt,
            title: t('property_management.units.delete.title', 'Delete {name}?', { name: record.name }),
            successMessage: t('property_management.units.delete.success', 'Unit deleted.'),
            errorMessage: t('property_management.units.delete.error', 'Could not delete the unit.'),
            onRefresh: host.reload,
          })
          if (done) router.push(backHref)
        } : undefined}
        onSubmit={async (values) => {
          const payload = {
            name: String(values.name ?? '').trim(),
            spaceId: String(values.spaceId ?? ''),
            catalogCategoryId: String(values.catalogCategoryId ?? ''),
            catalogProductId: String(values.catalogProductId ?? ''),
            x: toNumber(values.x),
            y: toNumber(values.y),
            width: toNumber(values.width),
            depth: toNumber(values.depth),
          }
          const errorMessage = t('property_management.units.form.saveError', 'Could not save the unit.')
          if (record) {
            await updateCrud('property_management/units', { id: record.id, ...payload }, { errorMessage })
          } else {
            await createCrud('property_management/units', { floorId: layout.floor.id, ...payload }, { errorMessage })
          }
          flash(t('property_management.units.form.saved', 'Unit saved.'), 'success')
          router.push(backHref)
        }}
      >
        {record ? <UnitProductHistory periods={info?.periods ?? []} /> : null}
      </PlacementFormShell>
      {ConfirmDialogElement}
    </>
  )
}

export default UnitForm
