'use client'

import * as React from 'react'
import type { z } from 'zod'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { updateCrud, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { LoadingMessage, ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { routingUpdateSchema } from '../../../../data/validators.js'
import { RoutingOperationsEditor, type RoutingOperationRow, type WorkCenterOption } from '../../components/RoutingOperationsEditor'

const routingEditSchema = routingUpdateSchema.omit({ id: true })
type RoutingEditValues = z.infer<typeof routingEditSchema>

type RoutingDetail = {
  id: string
  productId: string
  variantId: string | null
  version: number
  status: 'draft' | 'active' | 'archived'
  name: string
  updatedAt: string
  operations: RoutingOperationRow[]
}

export default function EditRoutingPage({ params }: { params?: { id?: string } }) {
  const t = useT()
  const router = useRouter()
  const [record, setRecord] = React.useState<RoutingDetail | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [isNotFound, setIsNotFound] = React.useState(false)
  const [workCenterOptions, setWorkCenterOptions] = React.useState<WorkCenterOption[]>([])

  React.useEffect(() => {
    let cancelled = false
    async function loadWorkCenters() {
      const call = await apiCall<{ items: Array<{ id: string; name: string }> }>('/api/production/work-centers?pageSize=100')
      if (cancelled || !call.ok || !call.result) return
      setWorkCenterOptions(call.result.items.map((wc) => ({ value: wc.id, label: wc.name })))
    }
    loadWorkCenters()
    return () => {
      cancelled = true
    }
  }, [])

  const loadRecord = React.useCallback(async () => {
    if (!params?.id) return
    setLoading(true)
    try {
      const call = await apiCall<RoutingDetail>(`/api/production/routings/${params.id}`)
      if (call.ok && call.result) {
        setRecord(call.result)
      } else if (call.status === 404) {
        setIsNotFound(true)
      } else {
        setError(t('production.routings.error.load_failed', 'Failed to load routing'))
      }
    } catch {
      setError(t('production.routings.error.load_failed', 'Failed to load routing'))
    } finally {
      setLoading(false)
    }
  }, [params?.id, t])

  React.useEffect(() => {
    loadRecord()
  }, [loadRecord])

  const fields = React.useMemo<CrudField[]>(
    () => [
      { id: 'name', type: 'text', label: t('production.routings.field.name', 'Name'), required: true },
      {
        id: 'status',
        type: 'select',
        label: t('production.routings.field.status', 'Status'),
        layout: 'half',
        options: [
          { value: 'draft', label: t('production.status.draft', 'Draft') },
          { value: 'active', label: t('production.status.active', 'Active') },
          { value: 'archived', label: t('production.status.archived', 'Archived') },
        ],
      },
      {
        id: 'operations',
        type: 'custom',
        label: t('production.routings.operations.title', 'Routing operations'),
        layout: 'full',
        component: ({ value, setValue }) => (
          <RoutingOperationsEditor
            value={(value as RoutingOperationRow[]) ?? []}
            onChange={setValue}
            t={t}
            workCenterOptions={workCenterOptions}
          />
        ),
      },
    ],
    [t, workCenterOptions],
  )

  const handleDelete = React.useCallback(async () => {
    if (!record) return
    try {
      // CrudForm already wraps onDelete with withScopedApiRequestHeaders(
      // buildOptimisticLockHeader(optimisticLockUpdatedAt), ...), so no manual
      // header wrap is needed here.
      await deleteCrud('production/routings', { id: record.id })
      flash(t('production.routings.success.deleted', 'Routing deleted successfully'), 'success')
      router.push('/backend/production/routings')
    } catch (err) {
      if (surfaceRecordConflict(err, t)) return
      flash(t('production.routings.error.delete_failed', 'Failed to delete routing'), 'error')
    }
  }, [record, t, router])

  if (loading) {
    return (
      <Page>
        <PageBody>
          <LoadingMessage label={t('production.routings.loading', 'Loading routing...')} />
        </PageBody>
      </Page>
    )
  }

  if (isNotFound) {
    return (
      <Page>
        <PageBody>
          <RecordNotFoundState
            label={t('production.routings.error.not_found', 'Routing not found')}
            backHref="/backend/production/routings"
            backLabel={t('production.routings.title', 'Routings')}
          />
        </PageBody>
      </Page>
    )
  }

  if (error || !record) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage label={error ?? t('production.routings.error.not_found', 'Routing not found')} />
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageBody>
        <CrudForm<RoutingEditValues>
          title={t('production.routings.edit.title', 'Edit routing')}
          backHref="/backend/production/routings"
          fields={fields}
          schema={routingEditSchema}
          optimisticLockUpdatedAt={record.updatedAt}
          initialValues={{
            name: record.name,
            status: record.status,
            operations: record.operations,
          } as unknown as Partial<RoutingEditValues>}
          submitLabel={t('production.routings.form.save', 'Save changes')}
          cancelHref="/backend/production/routings"
          onDelete={handleDelete}
          onSubmit={async (values) => {
            try {
              await updateCrud('production/routings', { id: record.id, ...values })
            } catch (err) {
              if (surfaceRecordConflict(err, t)) return
              throw err
            }
            flash(t('production.routings.success.updated', 'Routing updated successfully'), 'success')
            router.push('/backend/production/routings')
          }}
        />
      </PageBody>
    </Page>
  )
}
