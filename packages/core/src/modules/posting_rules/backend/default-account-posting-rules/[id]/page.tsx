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
import { loadLedgerAccountOptions, loadCostCenterOptions } from '../../lib/optionLoaders'

type DefaultAccountPostingRuleData = {
  id: string
  sourceAccountId: string
  targetAccountId: string
  defaultCostCenterId: string | null
  organizationId: string
  tenantId: string
  updatedAt: string | null
}

export default function EditDefaultAccountPostingRulePage({ params }: { params?: { id?: string } }) {
  const t = useT()
  const router = useRouter()

  const [rule, setRule] = React.useState<DefaultAccountPostingRuleData | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [isNotFound, setIsNotFound] = React.useState(false)

  React.useEffect(() => {
    async function load() {
      try {
        const response = await apiCall<{ items: DefaultAccountPostingRuleData[] }>(
          `/api/posting_rules/default-account-posting-rules?id=${params?.id}`,
        )
        if (response.ok && response.result && response.result.items.length > 0) {
          setRule(response.result.items[0])
        } else if (!response.ok) {
          setError(t('posting_rules.default_account_posting_rules.form.errors.load', 'Failed to load this rule'))
        } else {
          setIsNotFound(true)
        }
      } catch {
        setError(t('posting_rules.default_account_posting_rules.form.errors.load', 'Failed to load this rule'))
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
        title: t('posting_rules.default_account_posting_rules.form.group.details', 'Details'),
        fields: [
          {
            id: 'sourceAccountId',
            type: 'select',
            label: t('posting_rules.default_account_posting_rules.form.field.sourceAccount', 'Source account (zespół 4)'),
            required: true,
            // Immutable after creation (see `defaultAccountPostingRuleUpdateSchema`,
            // which excludes `sourceAccountId`) — shown for context but not
            // editable, matching this codebase's read-only-FK convention.
            disabled: true,
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

  if (loading) {
    return (
      <Page>
        <PageBody>
          <DataLoader isLoading loadingMessage={t('posting_rules.default_account_posting_rules.form.loading', 'Loading rule…')}>
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
            label={t('posting_rules.default_account_posting_rules.form.errors.notFound', 'Default account posting rule not found.')}
            backHref="/backend/default-account-posting-rules"
            backLabel={t('posting_rules.default_account_posting_rules.form.actions.backToList', 'Back to default account posting rules')}
          />
        </PageBody>
      </Page>
    )
  }

  if (error || !rule) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage
            label={error ?? t('posting_rules.default_account_posting_rules.form.errors.notFound', 'Default account posting rule not found.')}
          />
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageBody>
        <CrudForm
          title={t('posting_rules.default_account_posting_rules.edit.title', 'Edit default account posting rule')}
          titleHeadingLevel={1}
          backHref="/backend/default-account-posting-rules"
          fields={[]}
          groups={groups}
          optimisticLockUpdatedAt={rule.updatedAt}
          initialValues={{
            sourceAccountId: rule.sourceAccountId,
            targetAccountId: rule.targetAccountId,
            defaultCostCenterId: rule.defaultCostCenterId ?? '',
          }}
          submitLabel={t('posting_rules.default_account_posting_rules.form.action.save', 'Save changes')}
          cancelHref="/backend/default-account-posting-rules"
          onSubmit={async (values) => {
            const defaultCostCenterId = values.defaultCostCenterId ? String(values.defaultCostCenterId) : null
            const payload = {
              id: rule.id,
              targetAccountId: String(values.targetAccountId || ''),
              defaultCostCenterId,
            }

            await updateCrud('posting_rules/default-account-posting-rules', payload)

            flash(t('posting_rules.default_account_posting_rules.form.success.updated', 'Default account posting rule updated'), 'success')
            router.push('/backend/default-account-posting-rules')
          }}
        />
      </PageBody>
    </Page>
  )
}
