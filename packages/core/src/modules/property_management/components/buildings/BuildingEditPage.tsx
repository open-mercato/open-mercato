"use client"

import * as React from 'react'
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
import { normalizeBuilding, type BuildingListPayload, type BuildingRecord } from './buildingRecord'
import { buildBuildingPayload, createInitialValues, useBuildingFormConfig, type BuildingFormValues } from './buildingForm'
import { BuildingDeleteDialog, type BuildingDeleteTarget } from './BuildingDeleteDialog'
import { BuildingArchiveDialog } from './BuildingArchiveDialog'

const LIST_HREF = '/backend/property_management/buildings'

type LoadState =
  | { status: 'loading' }
  | { status: 'notFound' }
  | { status: 'error'; message: string }
  | { status: 'ready'; record: BuildingRecord; canManageAll: boolean }

export function BuildingEditPage({ buildingId }: { buildingId: string }) {
  const t = useT()
  const router = useRouter()
  const [state, setState] = React.useState<LoadState>({ status: 'loading' })
  const [reloadToken, setReloadToken] = React.useState(0)
  const [dialog, setDialog] = React.useState<'delete' | 'archive' | null>(null)

  React.useEffect(() => {
    let cancelled = false
    if (!buildingId) {
      setState({ status: 'notFound' })
      return
    }
    setState((current) => (current.status === 'ready' ? current : { status: 'loading' }))
    const params = new URLSearchParams({ id: buildingId, status: 'all', pageSize: '1' })
    void apiCall<BuildingListPayload>(`/api/property_management/buildings?${params.toString()}`).then((call) => {
      if (cancelled) return
      if (!call.ok) {
        setState({ status: 'error', message: call.result?.error ?? t('property_management.buildings.edit.loadError', 'Could not load the building.') })
        return
      }
      const record = normalizeBuilding(Array.isArray(call.result?.items) ? call.result.items[0] : null)
      if (!record) {
        setState({ status: 'notFound' })
        return
      }
      setState({ status: 'ready', record, canManageAll: call.result?.canManageAll === true })
    })
    return () => {
      cancelled = true
    }
  }, [buildingId, reloadToken, t])

  const record = state.status === 'ready' ? state.record : null
  const canManageAll = state.status === 'ready' ? state.canManageAll : false
  const { fields, groups } = useBuildingFormConfig(t, {
    buildingId: record?.id ?? null,
    canManageAll,
    managers: record?.managers ?? [],
    savedFloors: record?.floors ?? [],
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
    return <Page><PageBody><ErrorMessage label={state.status === 'error' ? state.message : t('property_management.buildings.edit.loadError', 'Could not load the building.')} /></PageBody></Page>
  }

  const archived = record.status === 'archived'

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
            readOnly={archived}
            submitLabel={t('property_management.buildings.edit.submit', 'Save changes')}
            onSubmit={async (values) => {
              const payload = buildBuildingPayload(values, t, { savedFloors: record.floors, includeManagers: canManageAll })
              await updateCrud('property_management/buildings', { ...payload, id: record.id }, {
                errorMessage: t('property_management.buildings.edit.error', 'Could not save the building.'),
              })
              flash(t('property_management.buildings.edit.success', 'Building saved.'), 'success')
              setReloadToken((current) => current + 1)
            }}
          />
          {archived ? null : (
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
