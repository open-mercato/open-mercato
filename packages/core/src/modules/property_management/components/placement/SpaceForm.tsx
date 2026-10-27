"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { CrudField, CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { createCrud, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import type { PlacementIssue } from '../../lib/geometry'
import { floorHref, formatMetres } from '../floor/types'
import { PlacementEditor } from './PlacementEditor'
import { PlacementFormShell, PlacementPageState } from './PlacementFormShell'
import { toNumber } from './placementModel'
import { useGuardedDelete } from './useGuardedDelete'
import { usePlacementHost, type PlacementRecord } from './usePlacementHost'

type SpaceRecord = PlacementRecord & {
  name: string
  purpose: string | null
  x: number
  y: number
  width: number
  depth: number
  isDefault: boolean
  unitCount?: number
}

type SpaceValues = {
  id?: string
  name: string
  purpose: string
  x: number
  y: number
  width: number
  depth: number
  updatedAt?: string | null
}

const FORM_ID = 'property-management-space-form'

export function SpaceForm({ spaceId }: { spaceId?: string | null }) {
  const t = useT()
  const router = useRouter()
  const recordId = spaceId || null
  const host = usePlacementHost<SpaceRecord>('spaces', recordId)
  const [issues, setIssues] = React.useState<PlacementIssue[]>([])
  const { remove, ConfirmDialogElement } = useGuardedDelete(FORM_ID)
  const layout = host.layout
  const record = host.record
  const backHref = layout ? floorHref(layout.building.id, layout.floor.id) : '/backend/property_management/buildings'

  const initialValues = React.useMemo<Partial<SpaceValues>>(() => {
    if (record) {
      return {
        id: record.id,
        name: record.name,
        purpose: record.purpose ?? '',
        x: record.x,
        y: record.y,
        width: record.width,
        depth: record.depth,
        updatedAt: record.updatedAt,
      }
    }
    const width = layout ? Math.min(6, layout.floor.sizeX) : 6
    const depth = layout ? Math.min(6, layout.floor.sizeY) : 6
    return { name: '', purpose: '', x: 0, y: 0, width, depth }
  }, [layout, record])

  const fields = React.useMemo<CrudField[]>(() => [
    { id: 'name', label: t('property_management.spaces.form.name', 'Name'), type: 'text', required: true },
    {
      id: 'purpose',
      label: t('property_management.spaces.form.purpose', 'Purpose'),
      type: 'text',
      description: t('property_management.spaces.form.purposeHint', 'What the space is for, or who it is for — e.g. coworking, parking, fintech tenants.'),
    },
    { id: 'width', label: t('property_management.spaces.form.width', 'Width, metres'), type: 'number', required: true, layout: 'half' },
    { id: 'depth', label: t('property_management.spaces.form.depth', 'Depth, metres'), type: 'number', required: true, layout: 'half' },
  ], [t])

  const groups = React.useMemo<CrudFormGroup[]>(() => {
    if (!layout) return []
    return [
      { id: 'details', title: t('property_management.spaces.form.details', 'Space'), fields: ['name', 'purpose', 'width', 'depth'] },
      {
        id: 'placement',
        title: t('property_management.placement.previewTitle', 'Preview'),
        component: ({ values, setValue }) => (
          <PlacementEditor
            kind="space"
            layout={layout}
            selfId={record?.id ?? null}
            label={String(values.name || t('property_management.spaces.form.newLabel', 'New space'))}
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

  const subtitle = record
    ? t('property_management.spaces.form.editSubtitle', 'Space · {floor} · {building} · {count} units', {
        floor: layout.floor.name,
        building: layout.building.name,
        count: layout.units.filter((unit) => unit.spaceId === record.id).length,
      })
    : t('property_management.spaces.form.createSubtitle', '{floor} · {building} · {x} × {y} m', {
        floor: layout.floor.name,
        building: layout.building.name,
        x: formatMetres(layout.floor.sizeX),
        y: formatMetres(layout.floor.sizeY),
      })
  const ownUnits = record ? layout.units.filter((unit) => unit.spaceId === record.id) : []

  return (
    <>
      <PlacementFormShell<SpaceValues>
        title={record ? record.name : t('property_management.spaces.form.createTitle', 'New space')}
        subtitle={subtitle}
        backHref={backHref}
        formId={FORM_ID}
        fields={fields}
        groups={groups}
        initialValues={initialValues}
        submitLabel={record ? t('property_management.common.saveChanges', 'Save changes') : t('property_management.spaces.form.create', 'Create space')}
        blocked={issues.length > 0}
        blockedMessage={t('property_management.placement.blocked', 'Fix the placement before saving.')}
        deleteLabel={t('property_management.spaces.form.delete', 'Delete space')}
        deleteDisabledReason={ownUnits.length
          ? t('property_management.spaces.form.deleteBlocked', 'Move or delete its units first — a space with units cannot be deleted.')
          : null}
        onDelete={record ? async () => {
          const done = await remove({
            resource: 'spaces',
            resourceKind: 'property_management.space',
            id: record.id,
            updatedAt: record.updatedAt,
            title: t('property_management.spaces.delete.title', 'Delete {name}?', { name: record.name }),
            successMessage: t('property_management.spaces.delete.success', 'Space deleted.'),
            errorMessage: t('property_management.spaces.delete.error', 'Could not delete the space.'),
            onRefresh: host.reload,
          })
          if (done) router.push(backHref)
        } : undefined}
        onSubmit={async (values) => {
          const payload = {
            name: String(values.name ?? '').trim(),
            purpose: String(values.purpose ?? '').trim() || null,
            x: toNumber(values.x),
            y: toNumber(values.y),
            width: toNumber(values.width),
            depth: toNumber(values.depth),
          }
          const errorMessage = t('property_management.spaces.form.saveError', 'Could not save the space.')
          if (record) {
            await updateCrud('property_management/spaces', { id: record.id, ...payload }, { errorMessage })
          } else {
            await createCrud('property_management/spaces', { floorId: layout.floor.id, ...payload }, { errorMessage })
          }
          flash(t('property_management.spaces.form.saved', 'Space saved.'), 'success')
          router.push(backHref)
        }}
      />
      {ConfirmDialogElement}
    </>
  )
}

export default SpaceForm
