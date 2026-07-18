'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { updateCrud, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { LoadingMessage, ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { workCenterCreateSchema, type WorkCenterCreateInput } from '../../../../data/validators.js'

type WorkCenterData = WorkCenterCreateInput & { id: string; updatedAt: string }

export default function EditWorkCenterPage({ params }: { params?: { id?: string } }) {
  const t = useT()
  const router = useRouter()
  const [record, setRecord] = React.useState<WorkCenterData | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [isNotFound, setIsNotFound] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const call = await apiCall<{ items: WorkCenterData[] }>(`/api/production/work-centers?id=${params?.id}`)
        if (cancelled) return
        if (call.ok && call.result && call.result.items.length > 0) {
          setRecord(call.result.items[0])
        } else if (!call.ok) {
          setError(t('production.work_centers.error.load_failed', 'Failed to load work center'))
        } else {
          setIsNotFound(true)
        }
      } catch {
        if (!cancelled) setError(t('production.work_centers.error.load_failed', 'Failed to load work center'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [params?.id, t])

  const fields = React.useMemo<CrudField[]>(
    () => [
      { id: 'name', type: 'text', label: t('production.work_centers.field.name', 'Name'), required: true },
      {
        id: 'kind',
        type: 'select',
        label: t('production.work_centers.field.kind', 'Kind'),
        required: true,
        options: [
          { value: 'machine', label: t('production.work_centers.kind.machine', 'Machine') },
          { value: 'manual', label: t('production.work_centers.kind.manual', 'Manual') },
          { value: 'line', label: t('production.work_centers.kind.line', 'Line') },
          { value: 'subcontractor', label: t('production.work_centers.kind.subcontractor', 'Subcontractor') },
        ],
      },
      {
        id: 'costRatePerHour',
        type: 'number',
        label: t('production.work_centers.field.cost_rate_per_hour', 'Cost rate / hour'),
        required: true,
        layout: 'half',
      },
      {
        id: 'parallelStations',
        type: 'number',
        label: t('production.work_centers.field.parallel_stations', 'Parallel stations'),
        layout: 'half',
      },
      {
        id: 'efficiencyFactor',
        type: 'number',
        label: t('production.work_centers.field.efficiency_factor', 'Efficiency factor'),
        layout: 'half',
      },
      {
        id: 'availabilityRuleSetId',
        type: 'text',
        label: t('production.work_centers.field.availability_rule_set_id', 'Availability rule set ID'),
        description: t('production.work_centers.note.availability_rule_set', 'Optional; a picker for availability rule sets is a planned enhancement.'),
        layout: 'half',
      },
      { id: 'isActive', type: 'checkbox', label: t('production.work_centers.field.is_active', 'Active') },
    ],
    [t],
  )

  const handleDelete = React.useCallback(async () => {
    if (!record) return
    try {
      // CrudForm already wraps onDelete with withScopedApiRequestHeaders(
      // buildOptimisticLockHeader(optimisticLockUpdatedAt), ...), so no manual
      // header wrap is needed here.
      await deleteCrud('production/work-centers', { id: record.id })
      flash(t('production.work_centers.success.deleted', 'Work center deleted successfully'), 'success')
      router.push('/backend/production/work-centers')
    } catch (err) {
      if (surfaceRecordConflict(err, t)) return
      flash(t('production.work_centers.error.delete_failed', 'Failed to delete work center'), 'error')
    }
  }, [record, t, router])

  if (loading) {
    return (
      <Page>
        <PageBody>
          <LoadingMessage label={t('production.work_centers.loading', 'Loading work center...')} />
        </PageBody>
      </Page>
    )
  }

  if (isNotFound) {
    return (
      <Page>
        <PageBody>
          <RecordNotFoundState
            label={t('production.work_centers.error.not_found', 'Work center not found')}
            backHref="/backend/production/work-centers"
            backLabel={t('production.work_centers.title', 'Work Centers')}
          />
        </PageBody>
      </Page>
    )
  }

  if (error || !record) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage label={error ?? t('production.work_centers.error.not_found', 'Work center not found')} />
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageBody>
        <CrudForm<WorkCenterCreateInput>
          title={t('production.work_centers.edit.title', 'Edit work center')}
          backHref="/backend/production/work-centers"
          fields={fields}
          schema={workCenterCreateSchema}
          optimisticLockUpdatedAt={record.updatedAt}
          initialValues={{
            name: record.name,
            kind: record.kind,
            costRatePerHour: record.costRatePerHour,
            parallelStations: record.parallelStations,
            efficiencyFactor: record.efficiencyFactor,
            availabilityRuleSetId: record.availabilityRuleSetId ?? undefined,
            isActive: record.isActive,
          }}
          submitLabel={t('production.work_centers.form.save', 'Save changes')}
          cancelHref="/backend/production/work-centers"
          onDelete={handleDelete}
          onSubmit={async (values) => {
            try {
              await updateCrud('production/work-centers', { id: record.id, ...values })
            } catch (err) {
              if (surfaceRecordConflict(err, t)) return
              throw err
            }
            flash(t('production.work_centers.success.updated', 'Work center updated successfully'), 'success')
            router.push('/backend/production/work-centers')
          }}
        />
      </PageBody>
    </Page>
  )
}
