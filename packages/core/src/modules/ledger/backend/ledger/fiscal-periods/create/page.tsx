'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeDetail } from '@open-mercato/shared/lib/frontend/useOrganizationScope'

export default function CreateFiscalPeriodPage() {
  const t = useT()
  const router = useRouter()
  const { organizationId, tenantId } = useOrganizationScopeDetail()

  const groups = React.useMemo<CrudFormGroup[]>(
    () => [
      {
        id: 'basic',
        column: 1,
        title: t('ledger.fiscal_periods.form.group.details', 'Details'),
        fields: [
          {
            id: 'startDate',
            type: 'date',
            label: t('ledger.fiscal_periods.form.field.startDate', 'Start date'),
            required: true,
          },
          {
            id: 'endDate',
            type: 'date',
            label: t('ledger.fiscal_periods.form.field.endDate', 'End date'),
            required: true,
            helpText: t(
              'ledger.fiscal_periods.form.field.endDateHelp',
              'Must not be before the start date, and must not overlap an existing period for this organization.',
            ),
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
          title={t('ledger.fiscal_periods.create.title', 'Create Fiscal Period')}
          titleHeadingLevel={1}
          backHref="/backend/ledger/fiscal-periods"
          fields={[]}
          groups={groups}
          submitLabel={t('ledger.fiscal_periods.form.action.create', 'Create')}
          cancelHref="/backend/ledger/fiscal-periods"
          onSubmit={async (values) => {
            const startDate = String(values.startDate || '')
            const endDate = String(values.endDate || '')
            if (!startDate || !endDate) {
              throw createCrudFormError(t('ledger.fiscal_periods.form.errors.datesRequired', 'Both dates are required.'))
            }
            if (new Date(endDate).getTime() < new Date(startDate).getTime()) {
              throw createCrudFormError(
                t('ledger.fiscal_periods.form.errors.endBeforeStart', 'End date must not be before start date.'),
                { endDate: t('ledger.fiscal_periods.form.errors.endBeforeStart', 'End date must not be before start date.') },
              )
            }

            const payload = { organizationId, tenantId, startDate, endDate }

            await createCrud('ledger/fiscal-periods', payload)

            flash(t('ledger.fiscal_periods.flash.created', 'Fiscal period created'), 'success')
            router.push('/backend/ledger/fiscal-periods')
          }}
        />
      </PageBody>
    </Page>
  )
}
