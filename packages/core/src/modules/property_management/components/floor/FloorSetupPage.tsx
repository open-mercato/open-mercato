"use client"

import * as React from 'react'
import Link from 'next/link'
import { Plus } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { ErrorMessage, LoadingMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { Button } from '@open-mercato/ui/primitives/button'
import { FloorDetailsForm } from './FloorDetailsForm'
import { FloorLayoutCanvas } from './FloorLayoutCanvas'
import { FloorTables } from './FloorTables'
import { formatMetres } from './types'
import { useFloorLayout } from './useFloorLayout'

export type FloorSetupPageProps = { buildingId: string; floorId: string }

export function FloorSetupPage({ buildingId, floorId }: FloorSetupPageProps) {
  const t = useT()
  const { data, loading, notFound, error, reload } = useFloorLayout(floorId || null)
  const buildingHref = `/backend/property_management/buildings/${buildingId}`

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
          <ErrorMessage label={t('property_management.floors.loadError', 'Could not load the floor.')} />
        </PageBody>
      </Page>
    )
  }

  const query = `?floorId=${encodeURIComponent(data.floor.id)}`
  const description = t('property_management.floors.header.description', '{building} · floor {number} · {x} × {y} m', {
    building: data.building.name,
    number: data.floor.number,
    x: formatMetres(data.floor.sizeX),
    y: formatMetres(data.floor.sizeY),
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
              </div>
            )}
          />
          <FloorDetailsForm floor={data.floor} onSaved={reload} />
          <FloorLayoutCanvas layout={data} />
          <FloorTables layout={data} onChanged={reload} />
        </div>
      </PageBody>
    </Page>
  )
}

export default FloorSetupPage
