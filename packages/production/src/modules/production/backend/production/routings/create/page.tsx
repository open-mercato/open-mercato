'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { routingCreateSchema, type RoutingCreateInput } from '../../../../data/validators.js'
import { RoutingOperationsEditor, type RoutingOperationRow, type WorkCenterOption } from '../../components/RoutingOperationsEditor'

export default function CreateRoutingPage() {
  const t = useT()
  const router = useRouter()
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

  const fields = React.useMemo<CrudField[]>(
    () => [
      { id: 'productId', type: 'text', label: t('production.routings.field.product_id', 'Product ID'), required: true, layout: 'half' },
      { id: 'variantId', type: 'text', label: t('production.routings.field.variant_id', 'Variant ID'), layout: 'half' },
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
      { id: 'version', type: 'number', label: t('production.routings.field.version', 'Version'), layout: 'half' },
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

  return (
    <Page>
      <PageBody>
        <CrudForm<RoutingCreateInput>
          title={t('production.routings.create.title', 'Create routing')}
          backHref="/backend/production/routings"
          fields={fields}
          schema={routingCreateSchema}
          initialValues={{ status: 'draft', operations: [] }}
          submitLabel={t('production.routings.form.submit', 'Create routing')}
          cancelHref="/backend/production/routings"
          onSubmit={async (values) => {
            await createCrud('production/routings', values)
            flash(t('production.routings.success.created', 'Routing created successfully'), 'success')
            router.push('/backend/production/routings')
          }}
        />
      </PageBody>
    </Page>
  )
}
