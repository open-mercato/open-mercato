"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { useBackendChrome } from '@open-mercato/ui/backend/BackendChromeProvider'
import { hasFeature } from '@open-mercato/shared/security/features'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { E } from '#generated/entities.ids.generated'
import type { FloorRow, ManagerRecord } from './buildingRecord'
import { buildBuildingPayload, createInitialValues, useBuildingFormConfig, type BuildingFormValues } from './buildingForm'

const LIST_HREF = '/backend/property_management/buildings'
const NO_FLOORS: FloorRow[] = []
const NO_MANAGERS: ManagerRecord[] = []
const MANAGE_ALL_FEATURE = 'property_management.buildings.manage_all'

export function BuildingCreatePage() {
  const t = useT()
  const router = useRouter()
  const { payload: chrome, isReady } = useBackendChrome()
  const canManageAll = hasFeature(chrome?.grantedFeatures, MANAGE_ALL_FEATURE)

  const { fields, groups } = useBuildingFormConfig(t, { buildingId: null, canManageAll, managers: NO_MANAGERS, savedFloors: NO_FLOORS })
  const initialValues = React.useMemo(() => createInitialValues(null), [])

  if (!isReady) {
    return (
      <Page>
        <PageBody>
          <LoadingMessage label={t('property_management.common.loading', 'Loading…')} />
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageBody>
        <CrudForm<BuildingFormValues>
          title={t('property_management.buildings.create.title', 'New building')}
          titleHeadingLevel={1}
          backHref={LIST_HREF}
          cancelHref={LIST_HREF}
          fields={fields}
          groups={groups}
          initialValues={initialValues}
          entityId={E.property_management.building}
          submitLabel={t('property_management.buildings.create.submit', 'Create building')}
          onSubmit={async (values) => {
            const payload = buildBuildingPayload(values, t, { savedFloors: NO_FLOORS, includeManagers: canManageAll })
            const call = await createCrud<{ id?: string | null }>('property_management/buildings', payload, {
              errorMessage: t('property_management.buildings.create.error', 'Could not create the building.'),
            })
            flash(t('property_management.buildings.create.success', 'Building created.'), 'success')
            const id = call.result?.id
            router.push(id ? `${LIST_HREF}/${id}` : LIST_HREF)
          }}
        />
      </PageBody>
    </Page>
  )
}

export default BuildingCreatePage
