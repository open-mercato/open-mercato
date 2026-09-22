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
import { loadLedgerAccountOptions, loadLedgerAccountTypeOptions } from '../../lib/optionLoaders'

type LedgerAccountData = {
  id: string
  slug: string
  accountTypeId: string
  parentAccountId: string | null
  description: string | null
  organizationId: string
  tenantId: string
  updatedAt: string | null
}

export default function EditLedgerAccountPage({ params }: { params?: { id?: string } }) {
  const t = useT()
  const router = useRouter()

  const [account, setAccount] = React.useState<LedgerAccountData | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [isNotFound, setIsNotFound] = React.useState(false)

  React.useEffect(() => {
    async function load() {
      try {
        const response = await apiCall<{ items: LedgerAccountData[] }>(`/api/ledger/accounts?id=${params?.id}`)
        if (response.ok && response.result && response.result.items.length > 0) {
          setAccount(response.result.items[0])
        } else if (!response.ok) {
          setError(t('ledger.accounts.form.errors.load', 'Failed to load this account'))
        } else {
          setIsNotFound(true)
        }
      } catch {
        setError(t('ledger.accounts.form.errors.load', 'Failed to load this account'))
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
        title: t('ledger.accounts.form.group.details', 'Details'),
        fields: [
          {
            id: 'slug',
            type: 'text',
            label: t('ledger.accounts.form.field.slug', 'Slug'),
            required: true,
            maxLength: 100,
          },
          {
            id: 'accountTypeId',
            type: 'select',
            label: t('ledger.accounts.form.field.accountType', 'Account type'),
            required: true,
            helpText: t(
              'ledger.accounts.form.field.accountTypeHelp',
              'Cannot be changed once this account has posted entries.',
            ),
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
            loadOptions: (query?: string) => loadLedgerAccountOptions(query, { excludeId: account?.id }),
          },
        ],
      },
    ],
    [t, account?.id],
  )

  if (loading) {
    return (
      <Page>
        <PageBody>
          <DataLoader label={t('ledger.accounts.form.loading', 'Loading account…')} />
        </PageBody>
      </Page>
    )
  }

  if (isNotFound) {
    return (
      <Page>
        <PageBody>
          <RecordNotFoundState
            label={t('ledger.accounts.form.errors.notFound', 'Account not found.')}
            backHref="/backend/ledger/accounts"
            backLabel={t('ledger.accounts.form.actions.backToList', 'Back to accounts')}
          />
        </PageBody>
      </Page>
    )
  }

  if (error || !account) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage label={error ?? t('ledger.accounts.form.errors.notFound', 'Account not found.')} />
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageBody>
        <CrudForm
          title={t('ledger.accounts.edit.title', 'Edit Account')}
          titleHeadingLevel={1}
          backHref="/backend/ledger/accounts"
          fields={[]}
          groups={groups}
          optimisticLockUpdatedAt={account.updatedAt}
          initialValues={{
            slug: account.slug,
            accountTypeId: account.accountTypeId,
            parentAccountId: account.parentAccountId ?? '',
            description: account.description ?? '',
          }}
          submitLabel={t('ledger.accounts.form.action.save', 'Save changes')}
          cancelHref="/backend/ledger/accounts"
          onSubmit={async (values) => {
            const payload = {
              id: account.id,
              slug: String(values.slug || '').trim(),
              accountTypeId: String(values.accountTypeId || ''),
              parentAccountId: values.parentAccountId ? String(values.parentAccountId) : null,
              description: values.description ? String(values.description).trim() : null,
            }

            await updateCrud('ledger/accounts', payload)

            flash(t('ledger.accounts.flash.updated', 'Account updated'), 'success')
            router.push('/backend/ledger/accounts')
          }}
        />
      </PageBody>
    </Page>
  )
}
