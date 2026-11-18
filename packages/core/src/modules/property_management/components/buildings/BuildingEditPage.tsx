"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Archive, Trash2 } from 'lucide-react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm } from '@open-mercato/ui/backend/CrudForm'
import { ErrorMessage, LoadingMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Button } from '@open-mercato/ui/primitives/button'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { E } from '#generated/entities.ids.generated'
import { normalizeBuilding, type BuildingListPayload, type BuildingRecord, type FloorRow } from './buildingRecord'
import { buildBuildingPayload, createInitialValues, useBuildingFormConfig, type BuildingFormValues } from './buildingForm'
import { BuildingDeleteDialog, type BuildingDeleteTarget } from './BuildingDeleteDialog'
import { BuildingArchiveDialog } from './BuildingArchiveDialog'
import { AvailabilityCard } from '../availability/AvailabilityCard'
import { useUnavailabilities } from '../availability/useUnavailabilities'
import { OutsideHoursDialog, type OutsideHoursBooking } from './OutsideHoursDialog'
import { FloorAvailabilityCard } from './FloorAvailabilityCard'
import { useCanManageProperty, ViewOnlyNotice } from '../manageAccess'
import { floorHref } from '../floor/types'

const LIST_HREF = '/backend/property_management/buildings'

type LoadState =
  | { status: 'loading' }
  | { status: 'notFound' }
  | { status: 'error'; message: string }
  | { status: 'ready'; record: BuildingRecord; canManageAll: boolean }

export function BuildingEditPage({ buildingId }: { buildingId: string }) {
  const t = useT()
  const router = useRouter()
  const canManage = useCanManageProperty()
  const [state, setState] = React.useState<LoadState>({ status: 'loading' })
  const [reloadToken, setReloadToken] = React.useState(0)
  const [dialog, setDialog] = React.useState<'delete' | 'archive' | null>(null)
  const [outsideHours, setOutsideHours] = React.useState<OutsideHoursBooking[]>([])
  const [outsideHoursTotal, setOutsideHoursTotal] = React.useState(0)

  const shownIdRef = React.useRef<string | null>(null)

  React.useEffect(() => {
    shownIdRef.current = state.status === 'ready' ? state.record.id : null
  }, [state])

  React.useEffect(() => {
    let cancelled = false
    if (!buildingId) {
      setState({ status: 'notFound' })
      return
    }
    setState((current) => (current.status === 'ready' && current.record.id === buildingId ? current : { status: 'loading' }))
    const fail = (message: string) => {
      if (shownIdRef.current === buildingId) flash(message, 'error')
      else setState({ status: 'error', message })
    }
    const params = new URLSearchParams({ id: buildingId, status: 'all', pageSize: '1' })
    void apiCall<BuildingListPayload>(`/api/property_management/buildings?${params.toString()}`).then((call) => {
      if (cancelled) return
      if (!call.ok) {
        fail(call.result?.error ?? t('property_management.buildings.edit.loadError', 'Could not load the building.'))
        return
      }
      const record = normalizeBuilding(Array.isArray(call.result?.items) ? call.result.items[0] : null)
      if (!record) {
        setState({ status: 'notFound' })
        return
      }
      setState({ status: 'ready', record, canManageAll: call.result?.canManageAll === true })
    }).catch(() => {
      if (!cancelled) fail(t('property_management.buildings.edit.loadError', 'Could not load the building.'))
    })
    return () => {
      cancelled = true
    }
  }, [buildingId, reloadToken, t])

  const record = state.status === 'ready' ? state.record : null
  const canManageAll = state.status === 'ready' ? state.canManageAll : false
  const recordId = record?.id ?? null
  const savedFloorIds = (record?.floors ?? []).map((floor) => floor.id ?? '').filter(Boolean).join(',')
  const availabilityQuery = React.useMemo(
    () => (recordId ? { buildingIds: [recordId], exactSubjectIds: [recordId, ...(savedFloorIds ? savedFloorIds.split(',') : [])] } : null),
    [recordId, savedFloorIds],
  )
  const availability = useUnavailabilities(availabilityQuery)
  const { fields, groups } = useBuildingFormConfig(t, {
    buildingId: record?.id ?? null,
    canManageAll,
    managers: record?.managers ?? [],
    savedFloors: record?.floors ?? [],
    archived: record?.status === 'archived',
    availability,
  })
  const initialValues = React.useMemo(() => createInitialValues(record), [record])
  const target: BuildingDeleteTarget | null = record ? { id: record.id, name: record.name, updatedAt: record.updatedAt } : null

  if (state.status === 'loading') {
    return <Page><PageBody><LoadingMessage label={t('property_management.buildings.edit.loading', 'Loading building…')} /></PageBody></Page>
  }
  if (state.status === 'notFound') {
    return (
      <Page>
        <PageBody>
          <RecordNotFoundState
            label={t('property_management.buildings.edit.notFound', 'Building not found')}
            description={t('property_management.buildings.edit.notFoundHint', 'It may have been deleted, or it is not one of the buildings assigned to you.')}
            backHref={LIST_HREF}
            backLabel={t('property_management.buildings.edit.backToList', 'Back to buildings')}
          />
        </PageBody>
      </Page>
    )
  }
  if (state.status === 'error' || !record) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage
            label={state.status === 'error' ? state.message : t('property_management.buildings.edit.loadError', 'Could not load the building.')}
            action={(
              <Button type="button" variant="outline" size="sm" onClick={() => setReloadToken((current) => current + 1)}>
                {t('property_management.common.retry', 'Try again')}
              </Button>
            )}
          />
        </PageBody>
      </Page>
    )
  }

  const archived = record.status === 'archived'
  const savedFloors = record.floors.filter((floor): floor is FloorRow & { id: string } => Boolean(floor.id))

  return (
    <Page>
      <PageBody>
        <div className="space-y-4">
          <CrudForm<BuildingFormValues>
            key={record.updatedAt ?? record.id}
            title={record.name}
            titleHeadingLevel={1}
            backHref={LIST_HREF}
            cancelHref={LIST_HREF}
            fields={fields}
            groups={groups}
            initialValues={initialValues}
            entityId={E.property_management.building}
            readOnly={archived || !canManage}
            readOnlyOverlay={archived ? undefined : (
              <ViewOnlyNotice>
                {savedFloors.length ? (
                  <nav aria-label={t('property_management.buildings.form.groupFloors', 'Floors')} className="flex flex-wrap gap-2">
                    {savedFloors.map((floor) => (
                      <Button key={floor.id} asChild variant="outline" size="sm">
                        <Link href={floorHref(record.id, floor.id)}>{floor.name}</Link>
                      </Button>
                    ))}
                  </nav>
                ) : null}
              </ViewOnlyNotice>
            )}
            submitLabel={t('property_management.buildings.edit.submit', 'Save changes')}
            onSubmit={async (values) => {
              const payload = buildBuildingPayload(values, t, { savedFloors: record.floors, includeManagers: canManageAll })
              const call = await updateCrud<{ bookingsOutsideHours?: OutsideHoursBooking[]; bookingsOutsideHoursTotal?: number }>('property_management/buildings', { ...payload, id: record.id }, {
                errorMessage: t('property_management.buildings.edit.error', 'Could not save the building.'),
              })
              flash(t('property_management.buildings.edit.success', 'Building saved.'), 'success')
              const listed = Array.isArray(call.result?.bookingsOutsideHours) ? call.result.bookingsOutsideHours : []
              setOutsideHours(listed)
              setOutsideHoursTotal(typeof call.result?.bookingsOutsideHoursTotal === 'number' ? call.result.bookingsOutsideHoursTotal : listed.length)
              setReloadToken((current) => current + 1)
            }}
          />
          {archived ? null : (
            <AvailabilityCard subject={{ type: 'building', id: record.id, name: record.name }} buildingId={record.id} availability={availability} />
          )}
          {archived || canManage ? null : (
            <FloorAvailabilityCard buildingId={record.id} floors={savedFloors} availability={availability} />
          )}
          {archived || !canManage ? null : (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card p-4">
              <p className="text-sm text-muted-foreground">
                {t('property_management.buildings.edit.dangerHint', 'Delete is for a building entered by mistake. Archive closes a location for good and keeps its history.')}
              </p>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => setDialog('archive')}>
                  <Archive className="size-4" aria-hidden />
                  {t('property_management.buildings.archive.open', 'Archive building')}
                </Button>
                <Button type="button" variant="destructive-outline" onClick={() => setDialog('delete')}>
                  <Trash2 className="size-4" aria-hidden />
                  {t('property_management.buildings.delete.open', 'Delete building')}
                </Button>
              </div>
            </div>
          )}
        </div>
        <OutsideHoursDialog bookings={outsideHours} total={outsideHoursTotal} onClose={() => setOutsideHours([])} />
        <BuildingDeleteDialog
          target={dialog === 'delete' ? target : null}
          onClose={() => setDialog(null)}
          onDeleted={() => router.push(LIST_HREF)}
          onArchiveInstead={() => setDialog('archive')}
        />
        <BuildingArchiveDialog
          target={dialog === 'archive' ? target : null}
          onClose={() => setDialog(null)}
          onArchived={() => router.push(LIST_HREF)}
        />
      </PageBody>
    </Page>
  )
}

export default BuildingEditPage
