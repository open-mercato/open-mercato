'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeDetail } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { loadLedgerAccountOptions, loadCostCenterOptions } from '../../lib/optionLoaders'

export default function CreateDefaultAccountPostingRulePage() {
  const t = useT()
  const router = useRouter()
  const { organizationId, tenantId } = useOrganizationScopeDetail()

  const groups = React.useMemo<CrudFormGroup[]>(
    () => [
      {
        id: 'basic',
        column: 1,
        title: t('posting_rules.default_account_posting_rules.form.group.details', 'Details'),
        fields: [
          {
            id: 'sourceAccountId',
            type: 'select',
            label: t('posting_rules.default_account_posting_rules.form.field.sourceAccount', 'Source account (zespół 4)'),
            required: true,
            loadOptions: loadLedgerAccountOptions,
          },
          {
            id: 'targetAccountId',
            type: 'select',
            label: t('posting_rules.default_account_posting_rules.form.field.targetAccount', 'Target account (zespół 5)'),
            required: true,
            loadOptions: loadLedgerAccountOptions,
          },
          {
            id: 'defaultCostCenterId',
            type: 'select',
            label: t('posting_rules.default_account_posting_rules.form.field.defaultCostCentre', 'Default cost centre'),
            placeholder: t(
              'posting_rules.default_account_posting_rules.form.field.defaultCostCentrePlaceholder',
              'None (falls back to "UNALLOCATED")',
            ),
            loadOptions: loadCostCenterOptions,
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
          title={t('posting_rules.default_account_posting_rules.create.title', 'Create default account posting rule')}
          titleHeadingLevel={1}
          backHref="/backend/default-account-posting-rules"
          fields={[]}
          groups={groups}
          submitLabel={t('posting_rules.default_account_posting_rules.form.action.create', 'Create')}
          cancelHref="/backend/default-account-posting-rules"
          onSubmit={async (values) => {
            const defaultCostCenterId = values.defaultCostCenterId ? String(values.defaultCostCenterId) : null
            const payload = {
              organizationId,
              tenantId,
              sourceAccountId: String(values.sourceAccountId || ''),
              targetAccountId: String(values.targetAccountId || ''),
              defaultCostCenterId,
            }

            await createCrud('posting_rules/default-account-posting-rules', payload)

            flash(t('posting_rules.default_account_posting_rules.form.success.created', 'Default account posting rule created'), 'success')
            router.push('/backend/default-account-posting-rules')
          }}
        />
      </PageBody>
    </Page>
  )
}
