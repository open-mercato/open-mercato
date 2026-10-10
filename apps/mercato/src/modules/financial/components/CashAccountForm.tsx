"use client"

import * as React from 'react'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { createCrud, fetchCrudList, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { withFlash } from '@open-mercato/ui/backend/utils/flash'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  CASH_ACCOUNT_KIND_FALLBACKS,
  CASH_ACCOUNT_KINDS,
  type CashAccountKind,
  type CashAccountRow,
} from './CashAccountsTable'
import { loadAssetAccountOptions, resolveAccountLabel } from './PaymentMethodsTable'

// Literal on purpose: this is a client component, so importing the command module
// (entities, ORM decorators) would drag server-only code into the browser bundle.
const ENTITY_ID = 'financial:gl_cash_account'
const LIST_HREF = '/backend/financial/cash-accounts'
const RESOURCE = 'financial/cash-accounts'

export type CashAccountFormValues = {
  id: string
  code: string
  name: string
  kind: CashAccountKind
  accountId: string
  currencyCode: string
  bankName: string
  iban: string
  accountNumber: string
  isDefault: boolean
  isActive: boolean
  // Carries the optimistic-lock version into `CrudForm`, which derives the expected-version header
  // from `initialValues.updatedAt` for update.
  updatedAt?: string | null
}

export function toCashAccountFormValues(row: CashAccountRow): CashAccountFormValues {
  return {
    id: row.id,
    code: row.code ?? '',
    name: row.name ?? '',
    kind: row.kind ?? 'cash',
    accountId: row.account_id ?? '',
    currencyCode: row.currency_code ?? 'SAR',
    bankName: row.bank_name ?? '',
    iban: row.iban ?? '',
    accountNumber: row.account_number ?? '',
    isDefault: row.is_default === true,
    isActive: row.is_active !== false,
    updatedAt: row.updatedAt ?? row.updated_at ?? null,
  }
}

export function buildCashAccountFormDefaults(id = ''): CashAccountFormValues {
  return {
    id,
    code: '',
    name: '',
    kind: 'cash',
    accountId: '',
    currencyCode: 'SAR',
    bankName: '',
    iban: '',
    accountNumber: '',
    isDefault: false,
    isActive: true,
    updatedAt: null,
  }
}

function optionalText(value: string): string | null {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function toCashAccountPayload(values: CashAccountFormValues): Record<string, unknown> {
  return {
    code: values.code.trim(),
    name: values.name.trim(),
    kind: values.kind ? values.kind : 'cash',
    accountId: values.accountId.trim(),
    currencyCode: values.currencyCode.trim().toUpperCase(),
    // The bank details are sent whatever the kind is: the fields hide for a cash account but their
    // values must survive, or switching the kind would erase a stored IBAN on the next save.
    bankName: optionalText(values.bankName),
    // Banks print IBANs in groups of four; the server's pattern only accepts the unspaced form.
    iban: optionalText(values.iban.replace(/\s+/g, ''))?.toUpperCase() ?? null,
    accountNumber: optionalText(values.accountNumber),
    isDefault: values.isDefault === true,
    isActive: values.isActive !== false,
  }
}

type Translate = ReturnType<typeof useT>

const BANK_ONLY = { field: 'kind', equals: 'bank' } as const

function useCashAccountFields(t: Translate): CrudField[] {
  return React.useMemo<CrudField[]>(() => [
    { id: 'code', label: t('financial.cashAccounts.form.fields.code', 'Code'), type: 'text', required: true, layout: 'half' },
    { id: 'name', label: t('financial.cashAccounts.form.fields.name', 'Name'), type: 'text', required: true, layout: 'half' },
    {
      id: 'kind',
      label: t('financial.cashAccounts.form.fields.kind', 'Kind'),
      type: 'select',
      layout: 'half',
      options: CASH_ACCOUNT_KINDS.map((value) => ({
        value,
        label: t(`financial.cashAccounts.kind.${value}`, CASH_ACCOUNT_KIND_FALLBACKS[value]),
      })),
    },
    {
      id: 'currencyCode',
      label: t('financial.cashAccounts.form.fields.currencyCode', 'Currency (ISO 4217)'),
      type: 'text',
      required: true,
      layout: 'half',
    },
    {
      id: 'accountId',
      label: t('financial.cashAccounts.form.fields.account', 'GL account'),
      type: 'combobox',
      required: true,
      layout: 'half',
      placeholder: t('financial.cashAccounts.form.fields.accountPlaceholder', 'Search asset accounts'),
      description: t('financial.cashAccounts.form.fields.accountHint', 'The ledger account this till or bank account is counted against.'),
      loadOptions: loadAssetAccountOptions,
      resolveLabel: resolveAccountLabel,
      allowCustomValues: false,
    },
    {
      id: 'bankName',
      label: t('financial.cashAccounts.form.fields.bankName', 'Bank name'),
      type: 'text',
      layout: 'half',
      visibleWhen: BANK_ONLY,
    },
    {
      id: 'iban',
      label: t('financial.cashAccounts.form.fields.iban', 'IBAN'),
      type: 'text',
      layout: 'half',
      visibleWhen: BANK_ONLY,
    },
    {
      id: 'accountNumber',
      label: t('financial.cashAccounts.form.fields.accountNumber', 'Account number'),
      type: 'text',
      layout: 'half',
      visibleWhen: BANK_ONLY,
    },
    { id: 'isDefault', label: t('financial.cashAccounts.form.fields.isDefault', 'Default account'), type: 'checkbox' },
    { id: 'isActive', label: t('financial.cashAccounts.form.fields.isActive', 'Active'), type: 'checkbox' },
  ], [t])
}

function useCashAccountGroups(t: Translate): CrudFormGroup[] {
  return React.useMemo<CrudFormGroup[]>(() => [
    {
      id: 'identification',
      title: t('financial.cashAccounts.form.groups.identification', 'Identification'),
      column: 1,
      fields: ['code', 'name', 'kind', 'currencyCode', 'accountId', 'bankName', 'iban', 'accountNumber'],
    },
    {
      id: 'settings',
      title: t('financial.cashAccounts.form.groups.settings', 'Settings'),
      column: 1,
      fields: ['isDefault', 'isActive'],
    },
  ], [t])
}

export function CashAccountCreateForm() {
  const t = useT()
  const fields = useCashAccountFields(t)
  const groups = useCashAccountGroups(t)
  const successRedirect = React.useMemo(
    () => withFlash(LIST_HREF, t('financial.cashAccounts.form.flash.created', 'Account created.'), 'success'),
    [t],
  )

  return (
    <CrudForm<CashAccountFormValues>
      title={t('financial.cashAccounts.form.create.title', 'New cash or bank account')}
      titleHeadingLevel={1}
      backHref={LIST_HREF}
      entityId={ENTITY_ID}
      fields={fields}
      groups={groups}
      initialValues={buildCashAccountFormDefaults()}
      submitLabel={t('financial.cashAccounts.form.create.submit', 'Create account')}
      cancelHref={LIST_HREF}
      successRedirect={successRedirect}
      onSubmit={async (values) => {
        await createCrud(RESOURCE, toCashAccountPayload(values))
      }}
    />
  )
}

export function CashAccountEditForm({ id }: { id: string }) {
  const t = useT()
  const fields = useCashAccountFields(t)
  const groups = useCashAccountGroups(t)
  const [initial, setInitial] = React.useState<CashAccountFormValues | null>(null)
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
        const data = await fetchCrudList<CashAccountRow>(RESOURCE, { ids: String(id), pageSize: 1 })
        const item = data?.items?.[0]
        if (!item) {
          if (!cancelled) setNotFound(true)
          return
        }
        if (!cancelled) setInitial(toCashAccountFormValues(item))
      } catch (caught: unknown) {
        if (!cancelled) {
          if ((caught as { status?: number }).status === 404) {
            setNotFound(true)
          } else {
            setError(caught instanceof Error && caught.message
              ? caught.message
              : t('financial.cashAccounts.form.error.load', 'Could not load the account.'))
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
    () => withFlash(LIST_HREF, t('financial.cashAccounts.form.flash.saved', 'Account saved.'), 'success'),
    [t],
  )

  if (notFound) {
    return (
      <RecordNotFoundState
        label={t('financial.cashAccounts.form.error.notFound', 'Account not found.')}
        backHref={LIST_HREF}
        backLabel={t('financial.cashAccounts.actions.backToList', 'Back to cash accounts')}
      />
    )
  }

  if (error) return <ErrorMessage label={error} />

  return (
    <CrudForm<CashAccountFormValues>
      title={t('financial.cashAccounts.form.edit.title', 'Edit account')}
      titleHeadingLevel={1}
      backHref={LIST_HREF}
      entityId={ENTITY_ID}
      fields={fields}
      groups={groups}
      initialValues={initial ?? buildCashAccountFormDefaults(id)}
      submitLabel={t('financial.cashAccounts.form.edit.submit', 'Save changes')}
      cancelHref={LIST_HREF}
      successRedirect={successRedirect}
      isLoading={loading}
      loadingMessage={t('financial.cashAccounts.form.loading', 'Loading account…')}
      onSubmit={async (values) => {
        // `id` belongs in the body: the route has no id segment and the update schema requires it.
        await updateCrud(RESOURCE, { id, ...toCashAccountPayload(values) })
      }}
    />
  )
}
