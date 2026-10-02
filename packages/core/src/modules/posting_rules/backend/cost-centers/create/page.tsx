'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeDetail } from '@open-mercato/shared/lib/frontend/useOrganizationScope'

export default function CreateCostCenterPage() {
  const t = useT()
  const router = useRouter()
  const { organizationId, tenantId } = useOrganizationScopeDetail()

  const groups = React.useMemo<CrudFormGroup[]>(
    () => [
      {
        id: 'basic',
        column: 1,
        title: t('posting_rules.cost_centers.form.group.details', 'Details'),
        fields: [
          {
            id: 'code',
            type: 'text',
            label: t('posting_rules.cost_centers.form.field.code', 'Code'),
            required: true,
            maxLength: 100,
          },
          {
            id: 'name',
            type: 'text',
            label: t('posting_rules.cost_centers.form.field.name', 'Name'),
            required: true,
            maxLength: 200,
          },
          {
            id: 'isActive',
            type: 'checkbox',
            label: t('posting_rules.cost_centers.form.field.isActive', 'Active'),
            defaultValue: true,
          },
        ],
      },
    ],
    [t],
  )

  return (
    <Page>
      <PageBody>
        <CrudForm
          title={t('posting_rules.cost_centers.create.title', 'Create cost centre')}
          titleHeadingLevel={1}
          backHref="/backend/cost-centers"
          fields={[]}
          groups={groups}
          submitLabel={t('posting_rules.cost_centers.form.action.create', 'Create')}
          cancelHref="/backend/cost-centers"
          onSubmit={async (values) => {
            const payload = {
              organizationId,
              tenantId,
              code: String(values.code || '').trim(),
              name: String(values.name || '').trim(),
              isActive: values.isActive !== false,
            }

            await createCrud('posting_rules/cost-centers', payload)

            flash(t('posting_rules.cost_centers.form.success.created', 'Cost centre created'), 'success')
            router.push('/backend/cost-centers')
          }}
        />
      </PageBody>
    </Page>
  )
}
