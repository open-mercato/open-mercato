"use client"

import * as React from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Building2, LayoutGrid, Lock } from 'lucide-react'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { usePlural } from '../plural'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { EmptyState } from '@open-mercato/ui/backend/EmptyState'
import { ErrorMessage, LoadingMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { Button } from '@open-mercato/ui/primitives/button'
import { floorHref, formatMetres } from '../floor/types'
import { useCanManageProperty } from '../manageAccess'
import { defaultFloorOf, isCalendarDate, isoToday, type BuildingOption } from './floorPlanModel'
import { readCrmAccess } from './floorPlanCrm'
import { FloorPlanCanvas } from './FloorPlanCanvas'
import { FloorPlanLegend } from './FloorPlanLegend'
import { FloorPlanToolbar } from './FloorPlanToolbar'
import { UnitDetailDrawer } from './UnitDetailDrawer'
import { useFloorPlanBuildings, useFloorPlanLayout } from './useFloorPlanData'

export type FloorPlanPageProps = { today?: string }

function pickBuilding(buildings: BuildingOption[], requestedId: string | null): BuildingOption | null {
  return buildings.find((building) => building.id === requestedId)
    ?? buildings.find((building) => building.status !== 'archived')
    ?? buildings[0]
    ?? null
}

export function FloorPlanPage({ today: serverToday }: FloorPlanPageProps) {
  const t = useT()
  const locale = useLocale()
  const { count } = usePlural()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const today = serverToday ?? isoToday()
  const requestedDate = searchParams?.get('date') ?? null
  const date = requestedDate && isCalendarDate(requestedDate) ? requestedDate : today
  const requestedBuildingId = searchParams?.get('buildingId') ?? null
  const buildingsState = useFloorPlanBuildings(requestedBuildingId)
  const buildings = buildingsState.data?.buildings ?? []
  const building = buildingsState.resolving ? null : pickBuilding(buildings, requestedBuildingId)
  const requestedFloorId = searchParams?.get('floorId') ?? null
  const floor = building?.floors.find((entry) => entry.id === requestedFloorId) ?? defaultFloorOf(building)
  const layoutState = useFloorPlanLayout(floor?.id ?? null, date)
  const [selectedUnitId, setSelectedUnitId] = React.useState<string | null>(null)
  const canManage = useCanManageProperty()

  const navigate = React.useCallback(
    (next: { buildingId?: string; floorId?: string | null; date?: string }) => {
      const params = new URLSearchParams(searchParams?.toString() ?? '')
      if (next.buildingId !== undefined) params.set('buildingId', next.buildingId)
      if (next.floorId === null) params.delete('floorId')
      else if (next.floorId !== undefined) params.set('floorId', next.floorId)
      if (next.date !== undefined) {
        if (next.date === today) params.delete('date')
        else params.set('date', next.date)
      }
      setSelectedUnitId(null)
      router.replace(`${pathname ?? ''}?${params.toString()}`)
    },
    [pathname, router, searchParams, today],
  )

  const header = (
    <PageHeader
      title={t('property_management.floorPlan.title', 'Floor plan')}
      description={t('property_management.floorPlan.description', 'See which units are leased, booked or unavailable on a day.')}
    />
  )

  if ((buildingsState.loading && !buildingsState.data) || buildingsState.resolving) {
    return (
      <Page>
        <PageBody>
          <LoadingMessage label={t('property_management.floorPlan.loading', 'Loading the floor plan…')} />
        </PageBody>
      </Page>
    )
  }
  if (buildingsState.error || !buildingsState.data) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage
            label={t('property_management.floorPlan.buildingsError', 'Could not load your buildings.')}
            action={<Button type="button" variant="outline" onClick={buildingsState.reload}>{t('property_management.floorPlan.retry', 'Try again')}</Button>}
          />
        </PageBody>
      </Page>
    )
  }
  if (!building) {
    const canManageAll = buildingsState.data.canManageAll
    const canAddBuilding = canManageAll && canManage
    return (
      <Page>
        <PageBody>
          <div className="space-y-4">
            {header}
            <EmptyState
              icon={canManageAll ? <Building2 className="size-6" /> : <Lock className="size-6" />}
              title={canManageAll
                ? t('property_management.floorPlan.noBuildings.title', 'No buildings yet')
                : t('property_management.floorPlan.noAssignment.title', 'No buildings assigned to you yet')}
              description={canManageAll
                ? t('property_management.floorPlan.noBuildings.description', 'Add a building with its floors and units to see its floor plan here.')
                : t('property_management.floorPlan.noAssignment.description', 'You are not a manager of any building, so there is no floor plan to show. Ask an administrator to assign you to a building.')}
              actions={canAddBuilding ? (
                <Button asChild variant="outline">
                  <Link href="/backend/property_management/buildings/create">{t('property_management.floorPlan.noBuildings.action', 'Add building')}</Link>
                </Button>
              ) : undefined}
            />
          </div>
        </PageBody>
      </Page>
    )
  }

  const layout = layoutState.data && floor && layoutState.data.floor.id === floor.id && layoutState.data.date === date ? layoutState.data : null
  const selectedUnit = layout?.units.find((unit) => unit.id === selectedUnitId) ?? null

  return (
    <Page>
      <PageBody>
        <div className="space-y-4">
          <PageHeader
            title={t('property_management.floorPlan.title', 'Floor plan')}
            description={t('property_management.floorPlan.description', 'See which units are leased, booked or unavailable on a day.')}
            actions={(
              <FloorPlanToolbar
                buildings={buildings}
                building={building}
                floorId={floor?.id ?? null}
                date={date}
                today={today}
                refreshing={layoutState.loading}
                onBuildingChange={(buildingId) => navigate({ buildingId, floorId: null })}
                onFloorChange={(floorId) => navigate({ buildingId: building.id, floorId })}
                onDateChange={(nextDate) => navigate({ date: nextDate })}
                onRefresh={layoutState.reload}
              />
            )}
          />
          {!floor ? (
            <EmptyState
              icon={<LayoutGrid className="size-6" />}
              title={t('property_management.floorPlan.noFloors.title', 'This building has no floors')}
              description={t('property_management.floorPlan.noFloors.description', 'Add floors to {building} to draw its floor plan.', { building: building.name })}
              actions={(
                <Button asChild variant="outline">
                  <Link href={`/backend/property_management/buildings/${building.id}`}>{t('property_management.floorPlan.openBuilding', 'Open building')}</Link>
                </Button>
              )}
            />
          ) : (
            <section className="space-y-4 rounded-lg border bg-card p-4" aria-labelledby="pm-floor-plan-title" data-testid="pm-floor-plan-card">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <h2 id="pm-floor-plan-title" className="text-base font-semibold">
                    {t('property_management.floorPlan.cardTitle', '{building}, {floor}', { building: building.name, floor: floor.name })}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {layout
                      ? t('property_management.floorPlan.summary', '{units}, {x} × {y} m', {
                          units: count('units', layout.units.length),
                          x: formatMetres(layout.floor.sizeX, locale),
                          y: formatMetres(layout.floor.sizeY, locale),
                        })
                      : t('property_management.floorPlan.floorNumber', 'Floor {number}', { number: floor.number })}
                  </p>
                </div>
                <FloorPlanLegend thresholdDays={layout?.leaseEndingThresholdDays ?? null} />
              </div>
              {layoutState.notFound ? (
                <RecordNotFoundState
                  className="min-h-0 py-6"
                  label={t('property_management.floors.notFound', 'Floor not found')}
                  description={t('property_management.floorPlan.floorNotFound.description', 'It may have been deleted, or its building is no longer assigned to you.')}
                  action={(
                    <Button type="button" variant="outline" onClick={() => { buildingsState.reload(); layoutState.reload() }}>
                      {t('property_management.floorPlan.floorNotFound.action', 'Reload the floor plan')}
                    </Button>
                  )}
                />
              ) : layoutState.error ? (
                <ErrorMessage
                  label={t('property_management.floorPlan.layoutError', 'Could not load the leases and bookings of this floor.')}
                  description={t('property_management.floorPlan.layoutErrorHint', 'Nothing is shown rather than an empty floor. Try again in a moment.')}
                  action={<Button type="button" variant="outline" onClick={layoutState.reload}>{t('property_management.floorPlan.retry', 'Try again')}</Button>}
                />
              ) : !layout ? (
                <LoadingMessage label={t('property_management.floorPlan.loadingFloor', 'Loading the floor…')} />
              ) : (
                <>
                  <FloorPlanCanvas layout={layout} selectedUnitId={selectedUnitId} onSelectUnit={setSelectedUnitId} />
                  {!layout.units.length ? (
                    <EmptyState
                      icon={<LayoutGrid className="size-6" />}
                      title={t('property_management.floorPlan.noUnits.title', 'No units configured on this floor')}
                      description={t('property_management.floorPlan.noUnits.description', '{floor} has no units set up yet, so there is nothing to show.', { floor: floor.name })}
                      actions={(
                        <Button asChild variant="outline">
                          <Link href={floorHref(building.id, floor.id)}>{t('property_management.floorPlan.noUnits.action', 'Set up the floor')}</Link>
                        </Button>
                      )}
                    />
                  ) : null}
                </>
              )}
            </section>
          )}
        </div>
      </PageBody>
      <UnitDetailDrawer unit={selectedUnit} date={layout?.date ?? date} crmAccess={readCrmAccess(layout?.crmAccess)} onClose={() => setSelectedUnitId(null)} />
    </Page>
  )
}

export default FloorPlanPage
