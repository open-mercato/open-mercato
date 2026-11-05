'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeDetail } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { loadLedgerAccountTypeOptions } from '../../../lib/optionLoaders'
import { AccountNumberField } from '../../../lib/prefixedNumberFields'

export default function CreateLedgerAccountPage() {
  const t = useT()
  const router = useRouter()
  const { organizationId, tenantId } = useOrganizationScopeDetail()

  const groups = React.useMemo<CrudFormGroup[]>(
    () => [
      {
        id: 'basic',
        column: 1,
        title: t('ledger.accounts.form.group.details', 'Details'),
        fields: [
          {
            id: 'accountTypeId',
            type: 'select',
            label: t('ledger.accounts.form.field.accountType', 'Account type'),
            required: true,
            loadOptions: (query?: string) => loadLedgerAccountTypeOptions(query),
          },
          {
            id: 'number',
            type: 'custom',
            label: t('ledger.accounts.form.field.number', 'Number'),
            required: true,
            helpText: t(
              'ledger.accounts.form.field.numberHelp',
              'Unique within this organization. In a Polish group it starts with the type number.',
            ),
            component: (props) => <AccountNumberField {...props} />,
          },
          {
            id: 'description',
            type: 'textarea',
            label: t('ledger.accounts.form.field.description', 'Description'),
            maxLength: 1000,
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
          title={t('ledger.accounts.create.title', 'Create Account')}
          titleHeadingLevel={1}
          backHref="/backend/ledger/accounts"
          fields={[]}
          groups={groups}
          submitLabel={t('ledger.accounts.form.action.create', 'Create')}
          cancelHref="/backend/ledger/accounts"
          onSubmit={async (values) => {
            const payload = {
              organizationId,
              tenantId,
              number: String(values.number || '').trim(),
              accountTypeId: String(values.accountTypeId || ''),
              description: values.description ? String(values.description).trim() : null,
            }

            await createCrud('ledger/accounts', payload)

            flash(t('ledger.accounts.flash.created', 'Account created'), 'success')
            router.push('/backend/ledger/accounts')
          }}
        />
      </PageBody>
    </Page>
  )
}
