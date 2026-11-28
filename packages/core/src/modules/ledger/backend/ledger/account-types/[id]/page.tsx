'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { DataLoader } from '@open-mercato/ui/primitives/DataLoader'
import { RecordNotFoundState, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { loadLedgerAccountGroupOptions } from '../../../lib/optionLoaders'
import { TypeNumberField } from '../../../lib/prefixedNumberFields'

type LedgerAccountTypeData = {
  id: string
  number: string
  name: string
  normalBalance: 'DEBIT' | 'CREDIT'
  accountGroupId: string | null
  organizationId: string
  tenantId: string
  updatedAt: string | null
}

export default function EditLedgerAccountTypePage({ params }: { params?: { id?: string } }) {
  const t = useT()
  const router = useRouter()

  const [accountType, setAccountType] = React.useState<LedgerAccountTypeData | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [isNotFound, setIsNotFound] = React.useState(false)

  React.useEffect(() => {
    async function load() {
      try {
        const response = await apiCall<{ items: LedgerAccountTypeData[] }>(
          `/api/ledger/account-types?id=${params?.id}`,
        )
        if (response.ok && response.result && response.result.items.length > 0) {
          setAccountType(response.result.items[0])
        } else if (!response.ok) {
          setError(t('ledger.account_types.form.errors.load', 'Failed to load this account type'))
        } else {
          setIsNotFound(true)
        }
      } catch {
        setError(t('ledger.account_types.form.errors.load', 'Failed to load this account type'))
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [params, t])

  const groups = React.useMemo<CrudFormGroup[]>(
    () => [
      {
        id: 'basic',
        column: 1,
        title: t('ledger.account_types.form.group.details', 'Details'),
        fields: [
          {
            id: 'accountGroupId',
            type: 'select',
            label: t('ledger.account_types.form.field.accountGroup', 'Account group'),
            placeholder: t('ledger.account_types.form.field.accountGroupPlaceholder', 'None'),
            helpText: t(
              'ledger.account_types.form.field.accountGroupHelp',
              'Optional. System-seeded reference data. Cannot be changed once an account of this type has posted entries.',
            ),
            loadOptions: (query?: string) => loadLedgerAccountGroupOptions(query),
          },
          {
            id: 'number',
            type: 'custom',
            label: t('ledger.account_types.form.field.number', 'Number'),
            required: true,
            helpText: t(
              'ledger.account_types.form.field.numberEditHelp',
              'Cannot be changed once an account of this type has posted entries. The name stays editable.',
            ),
            component: (props) => <TypeNumberField {...props} />,
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
            helpText: t(
              'ledger.account_types.form.field.normalBalanceHelp',
              'Cannot be changed once an account of this type has posted entries.',
            ),
            options: [
              { value: 'DEBIT', label: t('ledger.common.debit', 'Debit') },
              { value: 'CREDIT', label: t('ledger.common.credit', 'Credit') },
            ],
          },
        ],
      },
    ],
    [t],
  )

  if (loading) {
    return (
      <Page>
        <PageBody>
          <DataLoader isLoading loadingMessage={t('ledger.account_types.form.loading', 'Loading account type…')}>
            <></>
          </DataLoader>
        </PageBody>
      </Page>
    )
  }

  if (isNotFound) {
    return (
      <Page>
        <PageBody>
          <RecordNotFoundState
            label={t('ledger.account_types.form.errors.notFound', 'Account type not found.')}
            backHref="/backend/ledger/account-types"
            backLabel={t('ledger.account_types.form.actions.backToList', 'Back to account types')}
          />
        </PageBody>
      </Page>
    )
  }

  if (error || !accountType) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage label={error ?? t('ledger.account_types.form.errors.notFound', 'Account type not found.')} />
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageBody>
        <CrudForm
          title={t('ledger.account_types.edit.title', 'Edit Account Type')}
          titleHeadingLevel={1}
          backHref="/backend/ledger/account-types"
          fields={[]}
          groups={groups}
          optimisticLockUpdatedAt={accountType.updatedAt}
          initialValues={{
            number: accountType.number,
            name: accountType.name,
            normalBalance: accountType.normalBalance,
            accountGroupId: accountType.accountGroupId ?? '',
          }}
          submitLabel={t('ledger.account_types.form.action.save', 'Save changes')}
          cancelHref="/backend/ledger/account-types"
          onSubmit={async (values) => {
            const payload = {
              id: accountType.id,
              number: String(values.number || '').trim(),
              name: String(values.name || '').trim(),
              normalBalance: values.normalBalance === 'CREDIT' ? 'CREDIT' : 'DEBIT',
              accountGroupId: values.accountGroupId ? String(values.accountGroupId).trim() : null,
            }

            await updateCrud('ledger/account-types', payload)

            flash(t('ledger.account_types.flash.updated', 'Account type updated'), 'success')
            router.push('/backend/ledger/account-types')
          }}
        />
      </PageBody>
    </Page>
  )
}
