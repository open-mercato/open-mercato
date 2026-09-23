'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeDetail } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { loadLedgerAccountGroupOptions, loadLedgerAccountTypeOptions } from '../../lib/optionLoaders'

export default function CreateLedgerAccountTypePage() {
  const t = useT()
  const router = useRouter()
  const { organizationId, tenantId } = useOrganizationScopeDetail()

  const groups = React.useMemo<CrudFormGroup[]>(
    () => [
      {
        id: 'basic',
        column: 1,
        title: t('ledger.account_types.form.group.details', 'Details'),
        fields: [
          {
            id: 'slug',
            type: 'text',
            label: t('ledger.account_types.form.field.slug', 'Slug'),
            required: true,
            maxLength: 100,
            helpText: t('ledger.account_types.form.field.slugHelp', 'Unique within this organization.'),
          },
          {
            id: 'name',
            type: 'text',
            label: t('ledger.account_types.form.field.name', 'Name'),
            required: true,
            maxLength: 200,
          },
          {
            id: 'normalBalance',
            type: 'select',
            label: t('ledger.account_types.form.field.normalBalance', 'Normal balance'),
            required: true,
            defaultValue: 'DEBIT',
            options: [
              { value: 'DEBIT', label: t('ledger.common.debit', 'Debit') },
              { value: 'CREDIT', label: t('ledger.common.credit', 'Credit') },
            ],
          },
        ],
      },
      {
        id: 'hierarchy',
        column: 2,
        title: t('ledger.account_types.form.group.hierarchy', 'Hierarchy'),
        fields: [
          {
            id: 'parentAccountTypeId',
            type: 'select',
            label: t('ledger.account_types.form.field.parent', 'Parent account type'),
            placeholder: t('ledger.account_types.form.field.parentPlaceholder', 'None'),
            loadOptions: (query?: string) => loadLedgerAccountTypeOptions(query),
          },
          {
            id: 'accountGroupId',
            type: 'select',
            label: t('ledger.account_types.form.field.accountGroup', 'Account group'),
            placeholder: t('ledger.account_types.form.field.accountGroupPlaceholder', 'None'),
            helpText: t(
              'ledger.account_types.form.field.accountGroupHelp',
              'Optional. The Polish "zespoły" classification group — system-seeded reference data, not editable from this form.',
            ),
            loadOptions: (query?: string) => loadLedgerAccountGroupOptions(query),
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
          title={t('ledger.account_types.create.title', 'Create Account Type')}
          titleHeadingLevel={1}
          backHref="/backend/account-types"
          fields={[]}
          groups={groups}
          submitLabel={t('ledger.account_types.form.action.create', 'Create')}
          cancelHref="/backend/account-types"
          onSubmit={async (values) => {
            const payload = {
              organizationId,
              tenantId,
              slug: String(values.slug || '').trim(),
              name: String(values.name || '').trim(),
              normalBalance: values.normalBalance === 'CREDIT' ? 'CREDIT' : 'DEBIT',
              parentAccountTypeId: values.parentAccountTypeId ? String(values.parentAccountTypeId) : null,
              accountGroupId: values.accountGroupId ? String(values.accountGroupId).trim() : null,
            }

            await createCrud('ledger/account-types', payload)

            flash(t('ledger.account_types.flash.created', 'Account type created'), 'success')
            router.push('/backend/account-types')
          }}
        />
      </PageBody>
    </Page>
  )
}
