"use client"

import * as React from 'react'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { createCrud, deleteCrud, fetchCrudList, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { withFlash } from '@open-mercato/ui/backend/utils/flash'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  ACCOUNT_CLASS_FALLBACKS,
  ACCOUNT_CLASS_VALUES,
  NORMAL_BALANCE_FALLBACKS,
  NORMAL_BALANCE_VALUES,
  type AccountClass,
  type AccountRow,
  type NormalBalance,
} from './FinancialAccountsTable'

// Literal on purpose: this is a client component, so importing the command module
// (entities, ORM decorators) would drag server-only code into the browser bundle.
const ENTITY_ID = 'financial:gl_account'
const LIST_HREF = '/backend/financial/accounts'
const RESOURCE = 'financial/accounts'

export type AccountFormValues = {
  id: string
  code: string
  name: string
  description: string
  accountClass: AccountClass
  normalBalance: NormalBalance
  currencyCode: string
  countryCode: string
  isActive: boolean
  isReconciliationRequired: boolean
  // Carries the optimistic-lock version into `CrudForm`, which derives the expected-version header
  // from `initialValues.updatedAt` for update AND delete.
  updatedAt?: string | null
}

export function toAccountFormValues(row: AccountRow): AccountFormValues {
  return {
    id: row.id,
    code: row.code ?? '',
    name: row.name ?? '',
    description: row.description ?? '',
    accountClass: row.account_class ?? 'asset',
    normalBalance: row.normal_balance ?? 'debit',
    currencyCode: row.currency_code ?? 'SAR',
    countryCode: row.country_code ?? '',
    isActive: row.is_active !== false,
    isReconciliationRequired: row.is_reconciliation_required === true,
    updatedAt: row.updatedAt ?? row.updated_at ?? null,
  }
}

export function buildAccountFormDefaults(id = ''): AccountFormValues {
  return {
    id,
    code: '',
    name: '',
    description: '',
    accountClass: 'asset',
    normalBalance: 'debit',
    currencyCode: 'SAR',
    countryCode: '',
    isActive: true,
    isReconciliationRequired: false,
    updatedAt: null,
  }
}

export function toAccountPayload(values: AccountFormValues): Record<string, unknown> {
  return {
    code: values.code.trim(),
    name: values.name.trim(),
    description: values.description.trim().length > 0 ? values.description.trim() : null,
    accountClass: values.accountClass,
    normalBalance: values.normalBalance,
    currencyCode: values.currencyCode.trim().toUpperCase(),
    countryCode: values.countryCode.trim().length > 0 ? values.countryCode.trim().toUpperCase() : null,
    isActive: values.isActive,
    isReconciliationRequired: values.isReconciliationRequired,
  }
}

type Translate = ReturnType<typeof useT>

function useAccountFields(t: Translate): CrudField[] {
  return React.useMemo<CrudField[]>(() => [
    { id: 'code', label: t('financial.accounts.form.fields.code', 'Code'), type: 'text', required: true, layout: 'half' },
    { id: 'name', label: t('financial.accounts.form.fields.name', 'Account name'), type: 'text', required: true, layout: 'half' },
    {
      id: 'accountClass',
      label: t('financial.accounts.form.fields.accountClass', 'Class'),
      type: 'select',
      required: true,
      layout: 'half',
      options: ACCOUNT_CLASS_VALUES.map((value) => ({
        value,
        label: t(`financial.accounts.class.${value}`, ACCOUNT_CLASS_FALLBACKS[value]),
      })),
    },
    {
      id: 'normalBalance',
      label: t('financial.accounts.form.fields.normalBalance', 'Normal balance'),
      type: 'select',
      required: true,
      layout: 'half',
      options: NORMAL_BALANCE_VALUES.map((value) => ({
        value,
        label: t(`financial.accounts.normalBalance.${value}`, NORMAL_BALANCE_FALLBACKS[value]),
      })),
    },
    { id: 'currencyCode', label: t('financial.accounts.form.fields.currencyCode', 'Currency (ISO 4217)'), type: 'text', required: true, layout: 'half' },
    { id: 'countryCode', label: t('financial.accounts.form.fields.countryCode', 'Country (ISO 3166-1, optional)'), type: 'text', layout: 'half' },
    { id: 'description', label: t('financial.accounts.form.fields.description', 'Description'), type: 'textarea', rows: 3 },
    { id: 'isActive', label: t('financial.accounts.form.fields.isActive', 'Active'), type: 'checkbox' },
    {
      id: 'isReconciliationRequired',
      label: t('financial.accounts.form.fields.isReconciliationRequired', 'Requires reconciliation'),
      type: 'checkbox',
    },
  ], [t])
}

function useAccountGroups(t: Translate): CrudFormGroup[] {
  return React.useMemo<CrudFormGroup[]>(() => [
    {
      id: 'identification',
      title: t('financial.accounts.form.groups.identification', 'Identification'),
      column: 1,
      fields: ['code', 'name', 'accountClass', 'normalBalance'],
    },
    {
      id: 'classification',
      title: t('financial.accounts.form.groups.classification', 'Classification'),
      column: 1,
      fields: ['currencyCode', 'countryCode', 'description', 'isActive', 'isReconciliationRequired'],
    },
  ], [t])
}

export function AccountCreateForm() {
  const t = useT()
  const fields = useAccountFields(t)
  const groups = useAccountGroups(t)
  const successRedirect = React.useMemo(
    () => withFlash(LIST_HREF, t('financial.accounts.form.flash.created', 'Account created.'), 'success'),
    [t],
  )

  return (
    <CrudForm<AccountFormValues>
      title={t('financial.accounts.form.create.title', 'New account')}
      titleHeadingLevel={1}
      backHref={LIST_HREF}
      entityId={ENTITY_ID}
      fields={fields}
      groups={groups}
      initialValues={buildAccountFormDefaults()}
      submitLabel={t('financial.accounts.form.create.submit', 'Create account')}
      cancelHref={LIST_HREF}
      successRedirect={successRedirect}
      onSubmit={async (values) => {
        await createCrud(RESOURCE, toAccountPayload(values))
      }}
    />
  )
}

export function AccountEditForm({ id }: { id: string }) {
  const t = useT()
  const fields = useAccountFields(t)
  const groups = useAccountGroups(t)
  const [initial, setInitial] = React.useState<AccountFormValues | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [notFound, setNotFound] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      setNotFound(false)
      try {
        const data = await fetchCrudList<AccountRow>(RESOURCE, { ids: String(id), pageSize: 1 })
        const item = data?.items?.[0]
        if (!item) {
          if (!cancelled) setNotFound(true)
          return
        }
        if (!cancelled) setInitial(toAccountFormValues(item))
      } catch (caught: unknown) {
        if (!cancelled) {
          if ((caught as { status?: number }).status === 404) {
            setNotFound(true)
          } else {
            setError(caught instanceof Error && caught.message
              ? caught.message
              : t('financial.accounts.form.error.load', 'Could not load the account.'))
          }
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [id, t])

  const successRedirect = React.useMemo(
    () => withFlash(LIST_HREF, t('financial.accounts.form.flash.saved', 'Account saved.'), 'success'),
    [t],
  )
  const deleteRedirect = React.useMemo(
    () => withFlash(LIST_HREF, t('financial.accounts.form.flash.deleted', 'Account archived.'), 'success'),
    [t],
  )

  if (notFound) {
    return (
      <RecordNotFoundState
        label={t('financial.accounts.form.error.notFound', 'Account not found.')}
        backHref={LIST_HREF}
        backLabel={t('financial.accounts.actions.backToList', 'Back to accounts')}
      />
    )
  }

  if (error) return <ErrorMessage label={error} />

  return (
    <CrudForm<AccountFormValues>
      title={t('financial.accounts.form.edit.title', 'Edit account')}
      titleHeadingLevel={1}
      backHref={LIST_HREF}
      entityId={ENTITY_ID}
      fields={fields}
      groups={groups}
      initialValues={initial ?? buildAccountFormDefaults(id)}
      submitLabel={t('financial.accounts.form.edit.submit', 'Save changes')}
      cancelHref={LIST_HREF}
      successRedirect={successRedirect}
      deleteRedirect={deleteRedirect}
      isLoading={loading}
      loadingMessage={t('financial.accounts.form.loading', 'Loading account…')}
      onSubmit={async (values) => {
        // `id` belongs in the body: the route has no id segment and the update schema requires it.
        await updateCrud(RESOURCE, { id, ...toAccountPayload(values) })
      }}
      onDelete={async () => {
        await deleteCrud(RESOURCE, id)
      }}
    />
  )
}

