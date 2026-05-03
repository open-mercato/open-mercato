'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeDetail } from '@open-mercato/shared/lib/frontend/useOrganizationScope'

const KIND_VALUES = ['raw', 'semi', 'final', 'tool', 'indirect'] as const

type MaterialFormValues = {
  code: string
  name: string
  description?: string
  kind: (typeof KIND_VALUES)[number]
  isPurchasable?: boolean
  isStockable?: boolean
  isProducible?: boolean
}

export default function CreateMaterialPage() {
  const t = useT()
  const router = useRouter()
  const { organizationId, tenantId } = useOrganizationScopeDetail()

  const groups = React.useMemo<CrudFormGroup[]>(
    () => [
      {
        id: 'identity',
        column: 1,
        title: t('materials.form.group.identity', 'Identity'),
        fields: [
          {
            id: 'code',
            type: 'text',
            label: t('materials.form.field.code', 'Code'),
            placeholder: t('materials.form.field.code.placeholder', 'e.g. RAW-COTTON-A1'),
            helpText: t(
              'materials.form.field.code.help',
              'Unique within this organization. Letters, digits, dot, dash, underscore. Max 64.',
            ),
            required: true,
            maxLength: 64,
          },
          {
            id: 'name',
            type: 'text',
            label: t('materials.form.field.name', 'Name'),
            required: true,
            maxLength: 255,
          },
          {
            id: 'description',
            type: 'textarea',
            label: t('materials.form.field.description', 'Description'),
            rows: 3,
          },
        ],
      },
      {
        id: 'classification',
        column: 1,
        title: t('materials.form.group.classification', 'Classification'),
        fields: [
          {
            id: 'kind',
            type: 'select',
            label: t('materials.form.field.kind', 'Kind'),
            required: true,
            options: KIND_VALUES.map((k) => ({
              value: k,
              label: t(`materials.kind.${k}`, k),
            })),
          },
        ],
      },
      {
        id: 'capabilities',
        column: 2,
        title: t('materials.form.group.capabilities', 'Capabilities'),
        description: t(
          'materials.form.group.capabilities.help',
          'Toggle what this material can do. Sales is managed via the Sales tab on the detail page (creates a sales profile with GTIN and CN/HS code).',
        ),
        fields: [
          {
            id: 'isPurchasable',
            type: 'checkbox',
            label: t('materials.form.field.isPurchasable', 'Purchasable'),
            defaultValue: true,
          },
          {
            id: 'isStockable',
            type: 'checkbox',
            label: t('materials.form.field.isStockable', 'Stockable'),
            defaultValue: true,
          },
          {
            id: 'isProducible',
            type: 'checkbox',
            label: t('materials.form.field.isProducible', 'Producible'),
            defaultValue: false,
          },
        ],
      },
    ],
    [t],
  )

  return (
    <Page>
      <PageBody>
        <CrudForm<MaterialFormValues>
          title={t('materials.create.title', 'New material')}
          backHref="/backend/materials"
          cancelHref="/backend/materials"
          submitLabel={t('materials.form.submit', 'Create material')}
          groups={groups}
          initialValues={{
            kind: 'raw',
            isPurchasable: true,
            isStockable: true,
            isProducible: false,
          }}
          onSubmit={async (values) => {
            const payload: Record<string, unknown> = {
              code: values.code,
              name: values.name,
              kind: values.kind,
              isPurchasable: !!values.isPurchasable,
              isStockable: !!values.isStockable,
              isProducible: !!values.isProducible,
              ...(values.description ? { description: values.description } : {}),
              ...(organizationId ? { organizationId } : {}),
              ...(tenantId ? { tenantId } : {}),
            }
            const { result } = await createCrud<{ id?: string }>('materials', payload)
            const newId = typeof result?.id === 'string' ? result.id : null
            flash(t('materials.create.success', 'Material created'), 'success')
            if (newId) router.push(`/backend/materials/${newId}`)
            else router.push('/backend/materials')
          }}
        />
      </PageBody>
    </Page>
  )
}
