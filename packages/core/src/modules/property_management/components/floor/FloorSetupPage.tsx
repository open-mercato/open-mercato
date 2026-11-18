"use client"

import * as React from 'react'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { ErrorMessage, LoadingMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { Button } from '@open-mercato/ui/primitives/button'
import { FloorDetailsForm } from './FloorDetailsForm'
import { FloorLayoutCanvas } from './FloorLayoutCanvas'
import { FloorTables } from './FloorTables'
import { formatMetres } from './types'
import { useFloorLayout } from './useFloorLayout'
import { AvailabilityCard } from '../availability/AvailabilityCard'
import { useUnavailabilities } from '../availability/useUnavailabilities'
import { useCanManageProperty } from '../manageAccess'

export type FloorSetupPageProps = { buildingId: string; floorId: string }

export function FloorSetupPage({ buildingId, floorId }: FloorSetupPageProps) {
  const t = useT()
  const locale = useLocale()
  const canManage = useCanManageProperty()
  const { data, loading, notFound, error, reload } = useFloorLayout(floorId || null)
  const buildingHref = `/backend/property_management/buildings/${buildingId}`
  const availabilityQuery = React.useMemo(() => (data
    ? {
        buildingIds: [data.building.id],
        exactSubjectIds: [data.building.id, data.floor.id, ...data.spaces.map((space) => space.id), ...data.units.map((unit) => unit.id)],
      }
    : null), [data])
  const availability = useUnavailabilities(availabilityQuery)
  const availabilityKnown = !availability.loading && !availability.error
  const unavailableSubjectIds = React.useMemo(
    () => new Set(availabilityKnown ? availability.rows.filter((row) => row.inEffect).map((row) => row.subjectId) : []),
    [availability.rows, availabilityKnown],
  )

  if (loading && !data) {
    return (
      <Page>
        <PageBody>
          <LoadingMessage label={t('property_management.floors.loading', 'Loading floor…')} />
        </PageBody>
      </Page>
    )
  }
  if (notFound || (data && data.building.id !== buildingId)) {
    return (
      <Page>
        <PageBody>
          <RecordNotFoundState
            label={t('property_management.floors.notFound', 'Floor not found')}
            backHref="/backend/property_management/buildings"
            backLabel={t('property_management.floors.backToBuildings', 'Back to buildings')}
          />
        </PageBody>
      </Page>
    )
  }
  if (error || !data) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage
            label={t('property_management.floors.loadError', 'Could not load the floor.')}
            action={<Button type="button" variant="outline" onClick={reload}>{t('property_management.common.retry', 'Try again')}</Button>}
          />
        </PageBody>
      </Page>
    )
  }

  const query = `?floorId=${encodeURIComponent(data.floor.id)}`
  const archived = data.building.status === 'archived'
  const editable = canManage && !archived
  const description = t('property_management.floors.header.description', '{building} · floor {number} · {x} × {y} m', {
    building: data.building.name,
    number: data.floor.number,
    x: formatMetres(data.floor.sizeX, locale),
    y: formatMetres(data.floor.sizeY, locale),
  })

  return (
    <Page>
      <PageBody>
        <div className="space-y-4">
          <PageHeader
            title={data.floor.name}
            description={description}
            actions={(
              <div className="flex flex-wrap items-center gap-2">
                <Button asChild variant="outline">
                  <Link href={buildingHref}>{t('property_management.floors.header.openBuilding', 'Open building')}</Link>
                </Button>
                {editable ? (
                  <>
                    <Button asChild variant="outline">
                      <Link href={`/backend/property_management/spaces/create${query}`}>
                        <Plus className="mr-2 size-4" />
                        {t('property_management.floors.header.addSpace', 'Add space')}
                      </Link>
                    </Button>
                    <Button asChild variant="outline">
                      <Link href={`/backend/property_management/common-areas/create${query}`}>
                        <Plus className="mr-2 size-4" />
                        {t('property_management.floors.header.addCommonArea', 'Add common area')}
                      </Link>
                    </Button>
                    <Button asChild>
                      <Link href={`/backend/property_management/units/create${query}`}>
                        <Plus className="mr-2 size-4" />
                        {t('property_management.floors.header.addUnit', 'Add unit')}
                      </Link>
                    </Button>
                  </>
                ) : null}
              </div>
            )}
          />
          <FloorDetailsForm floor={data.floor} onSaved={reload} readOnly={!editable} archived={archived} />
          <AvailabilityCard
            subject={{ type: 'floor', id: data.floor.id, name: data.floor.name }}
            buildingId={data.building.id}
            ancestors={[{ type: 'building', id: data.building.id }]}
            disabled={archived}
            availability={availability}
          />
          <FloorLayoutCanvas layout={data} unavailableSubjectIds={unavailableSubjectIds} />
          <FloorTables
            layout={data}
            onChanged={reload}
            availability={availability}
            readOnly={!editable}
          />
        </div>
      </PageBody>
    </Page>
  )
}

export default FloorSetupPage
