"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { CrudField, CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { createCrud, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import type { PlacementIssue } from '../../lib/geometry'
import { COMMON_AREA_KIND_VALUES, floorHref, formatMetres } from '../floor/types'
import { PlacementEditor } from './PlacementEditor'
import { PlacementFormShell, PlacementPageState } from './PlacementFormShell'
import { toNumber } from './placementModel'
import { useGuardedDelete } from './useGuardedDelete'
import { usePlacementHost, type PlacementRecord } from './usePlacementHost'

type CommonAreaRecord = PlacementRecord & {
  name: string
  kind: string
  x: number
  y: number
  width: number
  depth: number
}

type CommonAreaValues = {
  id?: string
  name: string
  kind: string
  x: number
  y: number
  width: number
  depth: number
  updatedAt?: string | null
}

const FORM_ID = 'property-management-common-area-form'

export function CommonAreaForm({ commonAreaId }: { commonAreaId?: string | null }) {
  const t = useT()
  const router = useRouter()
  const recordId = commonAreaId || null
  const host = usePlacementHost<CommonAreaRecord>('common-areas', recordId)
  const [issues, setIssues] = React.useState<PlacementIssue[]>([])
  const { remove, ConfirmDialogElement } = useGuardedDelete(FORM_ID)
  const layout = host.layout
  const record = host.record
  const backHref = layout ? floorHref(layout.building.id, layout.floor.id) : '/backend/property_management/buildings'

  const initialValues = React.useMemo<Partial<CommonAreaValues>>(() => {
    if (record) {
      return {
        id: record.id,
        name: record.name,
        kind: record.kind,
        x: record.x,
        y: record.y,
        width: record.width,
        depth: record.depth,
        updatedAt: record.updatedAt,
      }
    }
    return { name: '', kind: 'corridor', x: 0, y: 0, width: 3, depth: 3 }
  }, [record])

  const fields = React.useMemo<CrudField[]>(() => [
    { id: 'name', label: t('property_management.commonAreas.form.name', 'Name'), type: 'text', required: true },
    {
      id: 'kind',
      label: t('property_management.commonAreas.form.kind', 'Kind'),
      type: 'select',
      required: true,
      description: t('property_management.commonAreas.form.kindHint', 'Corridors, kitchens, toilets and the like — never leased or booked.'),
      options: COMMON_AREA_KIND_VALUES.map((value) => ({ value, label: t(`property_management.commonAreas.kind.${value}`, value) })),
    },
    { id: 'width', label: t('property_management.commonAreas.form.width', 'Width, metres'), type: 'number', required: true, layout: 'half' },
    { id: 'depth', label: t('property_management.commonAreas.form.depth', 'Depth, metres'), type: 'number', required: true, layout: 'half' },
  ], [t])

  const groups = React.useMemo<CrudFormGroup[]>(() => {
    if (!layout) return []
    return [
      { id: 'details', title: t('property_management.commonAreas.form.details', 'Common area'), fields: ['name', 'kind', 'width', 'depth'] },
      {
        id: 'placement',
        title: t('property_management.placement.previewTitle', 'Preview'),
        component: ({ values, setValue }) => (
          <PlacementEditor
            kind="common_area"
            layout={layout}
            selfId={record?.id ?? null}
            label={String(values.name || t('property_management.commonAreas.form.newLabel', 'New common area'))}
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

  return (
    <>
      <PlacementFormShell<CommonAreaValues>
        title={record ? record.name : t('property_management.commonAreas.form.createTitle', 'New common area')}
        subtitle={t('property_management.commonAreas.form.subtitle', '{floor} · {building} · {x} × {y} m', {
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
        submitLabel={record ? t('property_management.common.saveChanges', 'Save changes') : t('property_management.commonAreas.form.create', 'Create common area')}
        blocked={issues.length > 0}
        blockedMessage={t('property_management.placement.blocked', 'Fix the placement before saving.')}
        deleteLabel={t('property_management.commonAreas.form.delete', 'Delete common area')}
        onDelete={record ? async () => {
          const done = await remove({
            resource: 'common-areas',
            resourceKind: 'property_management.common_area',
            id: record.id,
            updatedAt: record.updatedAt,
            title: t('property_management.commonAreas.delete.title', 'Delete {name}?', { name: record.name }),
            successMessage: t('property_management.commonAreas.delete.success', 'Common area deleted.'),
            errorMessage: t('property_management.commonAreas.delete.error', 'Could not delete the common area.'),
            onRefresh: host.reload,
          })
          if (done) router.push(backHref)
        } : undefined}
        onSubmit={async (values) => {
          const payload = {
            name: String(values.name ?? '').trim(),
            kind: String(values.kind ?? 'other'),
            x: toNumber(values.x),
            y: toNumber(values.y),
            width: toNumber(values.width),
            depth: toNumber(values.depth),
          }
          const errorMessage = t('property_management.commonAreas.form.saveError', 'Could not save the common area.')
          if (record) {
            await updateCrud('property_management/common-areas', { id: record.id, ...payload }, { errorMessage })
          } else {
            await createCrud('property_management/common-areas', { floorId: layout.floor.id, ...payload }, { errorMessage })
          }
          flash(t('property_management.commonAreas.form.saved', 'Common area saved.'), 'success')
          router.push(backHref)
        }}
      />
      {ConfirmDialogElement}
    </>
  )
}

export default CommonAreaForm
