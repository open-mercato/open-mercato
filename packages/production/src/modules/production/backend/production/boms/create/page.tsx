'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { bomCreateSchema, type BomCreateInput } from '../../../../data/validators.js'
import { BomItemsEditor, type BomItemRow } from '../../components/BomItemsEditor'

export default function CreateBomPage() {
  const t = useT()
  const router = useRouter()

  const fields = React.useMemo<CrudField[]>(
    () => [
      { id: 'productId', type: 'text', label: t('production.boms.field.product_id', 'Product ID'), required: true, layout: 'half' },
      { id: 'variantId', type: 'text', label: t('production.boms.field.variant_id', 'Variant ID'), layout: 'half' },
      { id: 'name', type: 'text', label: t('production.boms.field.name', 'Name'), required: true },
      {
        id: 'status',
        type: 'select',
        label: t('production.boms.field.status', 'Status'),
        layout: 'half',
        options: [
          { value: 'draft', label: t('production.status.draft', 'Draft') },
          { value: 'active', label: t('production.status.active', 'Active') },
          { value: 'archived', label: t('production.status.archived', 'Archived') },
        ],
      },
      { id: 'version', type: 'number', label: t('production.boms.field.version', 'Version'), layout: 'half' },
      { id: 'validFrom', type: 'date', label: t('production.boms.field.valid_from', 'Valid from'), layout: 'half' },
      { id: 'validTo', type: 'date', label: t('production.boms.field.valid_to', 'Valid to'), layout: 'half' },
      {
        id: 'items',
        type: 'custom',
        label: t('production.boms.items.title', 'BOM items'),
        layout: 'full',
        component: ({ value, setValue }) => (
          <BomItemsEditor value={(value as BomItemRow[]) ?? []} onChange={setValue} t={t} />
        ),
      },
    ],
    [t],
  )

  return (
    <Page>
      <PageBody>
        <CrudForm<BomCreateInput>
          title={t('production.boms.create.title', 'Create BOM')}
          backHref="/backend/production/boms"
          fields={fields}
          schema={bomCreateSchema}
          initialValues={{ status: 'draft', items: [] }}
          submitLabel={t('production.boms.form.submit', 'Create BOM')}
          cancelHref="/backend/production/boms"
          onSubmit={async (values) => {
            await createCrud('production/boms', values)
            flash(t('production.boms.success.created', 'BOM created successfully'), 'success')
            router.push('/backend/production/boms')
          }}
        />
      </PageBody>
    </Page>
  )
}
