'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeDetail } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { loadLedgerAccountOptions, loadLedgerAccountTypeOptions } from '../../lib/optionLoaders'

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
            id: 'slug',
            type: 'text',
            label: t('ledger.accounts.form.field.slug', 'Slug'),
            required: true,
            maxLength: 100,
            helpText: t('ledger.accounts.form.field.slugHelp', 'Unique within this organization.'),
          },
          {
            id: 'accountTypeId',
            type: 'select',
            label: t('ledger.accounts.form.field.accountType', 'Account type'),
            required: true,
            loadOptions: (query?: string) => loadLedgerAccountTypeOptions(query),
          },
          {
            id: 'description',
            type: 'textarea',
            label: t('ledger.accounts.form.field.description', 'Description'),
            maxLength: 1000,
          },
        ],
      },
      {
        id: 'hierarchy',
        column: 2,
        title: t('ledger.accounts.form.group.hierarchy', 'Hierarchy'),
        fields: [
          {
            id: 'parentAccountId',
            type: 'select',
            label: t('ledger.accounts.form.field.parent', 'Parent account'),
            placeholder: t('ledger.accounts.form.field.parentPlaceholder', 'None'),
            helpText: t(
              'ledger.accounts.form.field.parentHelp',
              'Structural only in Phase 1 — nothing reads this yet.',
            ),
            loadOptions: (query?: string) => loadLedgerAccountOptions(query),
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
          backHref="/backend/accounts"
          fields={[]}
          groups={groups}
          submitLabel={t('ledger.accounts.form.action.create', 'Create')}
          cancelHref="/backend/accounts"
          onSubmit={async (values) => {
            const payload = {
              organizationId,
              tenantId,
              slug: String(values.slug || '').trim(),
              accountTypeId: String(values.accountTypeId || ''),
              parentAccountId: values.parentAccountId ? String(values.parentAccountId) : null,
              description: values.description ? String(values.description).trim() : null,
            }

            await createCrud('ledger/accounts', payload)

            flash(t('ledger.accounts.flash.created', 'Account created'), 'success')
            router.push('/backend/accounts')
          }}
        />
      </PageBody>
    </Page>
  )
}
