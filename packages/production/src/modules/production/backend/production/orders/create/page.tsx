'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { orderCreateSchema, type OrderCreateInput } from '../../../../data/validators.js'

export default function CreateProductionOrderPage() {
  const t = useT()
  const router = useRouter()

  const fields = React.useMemo<CrudField[]>(
    () => [
      { id: 'productId', type: 'text', label: t('production.orders.field.product_id', 'Product ID'), required: true, layout: 'half' },
      { id: 'variantId', type: 'text', label: t('production.orders.field.variant_id', 'Variant ID'), layout: 'half' },
      { id: 'qtyPlanned', type: 'number', label: t('production.orders.field.qty_planned', 'Quantity planned'), required: true, layout: 'half' },
      { id: 'uom', type: 'text', label: t('production.orders.field.uom', 'UoM'), required: true, layout: 'half' },
      { id: 'dueDate', type: 'date', label: t('production.orders.field.due_date', 'Due date'), layout: 'half' },
      { id: 'priority', type: 'number', label: t('production.orders.field.priority', 'Priority'), layout: 'half' },
      {
        id: 'sourceType',
        type: 'select',
        label: t('production.orders.field.source_type', 'Source'),
        layout: 'half',
        options: [
          { value: 'manual', label: t('production.orders.source_type.manual', 'Manual') },
          { value: 'sales_order', label: t('production.orders.source_type.sales_order', 'Sales order') },
          { value: 'mrp', label: t('production.orders.source_type.mrp', 'MRP') },
        ],
      },
    ],
    [t],
  )

  return (
    <Page>
      <PageBody>
        <CrudForm<OrderCreateInput>
          title={t('production.orders.create.title', 'Create production order')}
          backHref="/backend/production/orders"
          fields={fields}
          schema={orderCreateSchema}
          initialValues={{ priority: 0, sourceType: 'manual' }}
          submitLabel={t('production.orders.form.submit', 'Create production order')}
          cancelHref="/backend/production/orders"
          onSubmit={async (values) => {
            const call = await createCrud<{ id: string }>('production/orders', values)
            flash(t('production.orders.success.created', 'Production order created successfully'), 'success')
            const id = call.result?.id
            router.push(id ? `/backend/production/orders/${id}` : '/backend/production/orders')
          }}
        />
      </PageBody>
    </Page>
  )
}
