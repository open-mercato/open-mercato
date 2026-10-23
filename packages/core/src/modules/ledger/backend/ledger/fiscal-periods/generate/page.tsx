'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'

// "Generate 12 months": twelve consecutive calendar-month periods from the
// first day of the month the user picks (PR #5663 review, point 3). Any other
// range is still created one at a time on the "New fiscal period" page.
export default function GenerateFiscalPeriodsPage() {
  const t = useT()
  const router = useRouter()

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
            label: t('ledger.fiscal_periods.generate.field.startDate', 'First month starts on'),
            required: true,
            helpText: t(
              'ledger.fiscal_periods.generate.field.startDateHelp',
              'Pick the first day of a month. Twelve consecutive calendar months are created from it, and none may overlap an existing period.',
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
          title={t('ledger.fiscal_periods.generate.title', 'Generate 12 months')}
          titleHeadingLevel={1}
          backHref="/backend/ledger/fiscal-periods"
          fields={[]}
          groups={groups}
          submitLabel={t('ledger.fiscal_periods.generate.action', 'Generate')}
          cancelHref="/backend/ledger/fiscal-periods"
          onSubmit={async (values) => {
            const startDate = String(values.startDate || '')
            if (!startDate) {
              throw createCrudFormError(t('ledger.fiscal_periods.generate.errors.startRequired', 'A start date is required.'))
            }
            if (new Date(startDate).getUTCDate() !== 1) {
              const message = t('ledger.fiscal_periods.generate.errors.notFirstOfMonth', 'The start date must be the first day of a month.')
              throw createCrudFormError(message, { startDate: message })
            }

            const call = await apiCall<{ ids?: string[]; error?: string }>('/api/ledger/fiscal-periods/generate', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ startDate }),
            })
            if (!call.ok) {
              throw createCrudFormError(
                call.result?.error ?? t('ledger.fiscal_periods.generate.errors.failed', 'Could not generate the fiscal periods.'),
              )
            }

            flash(t('ledger.fiscal_periods.generate.flash.created', 'Twelve fiscal periods created'), 'success')
            router.push('/backend/ledger/fiscal-periods')
          }}
        />
      </PageBody>
    </Page>
  )
}
