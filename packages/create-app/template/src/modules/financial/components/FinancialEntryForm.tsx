"use client"

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { createCrud, fetchCrudList, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { withFlash } from '@open-mercato/ui/backend/utils/flash'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  ENTRY_TYPE_FALLBACKS,
  ENTRY_TYPE_VALUES,
  type JournalEntryRow,
  type JournalEntryType,
} from './FinancialEntriesTable'
import EntryLinesEditor, { emptyEntryLine, type EntryLineValue } from './EntryLinesEditor'

const ENTITY_ID = 'financial:gl_journal_entry'
const LIST_HREF = '/backend/financial/journal-entries'
const RESOURCE = 'financial/journal-entries'
export const ENTRY_LINES_RESOURCE = 'financial/journal-entries/lines'

export type EntryFormValues = {
  id: string
  entryNumber: string
  entryDate: string
  postingDate: string
  periodId: string
  entryType: JournalEntryType
  description: string
  reference: string
  currencyCode: string
  exchangeRate: string
  lines: EntryLineValue[]
  updatedAt?: string | null
}

type PeriodOptionRow = {
  id: string
  fiscal_year: number
  period_name: string
}

type EntryLineRow = {
  id: string
  account_id: string
  debit_amount: string
  credit_amount: string
}

export function toEntryLineValues(rows: readonly EntryLineRow[]): EntryLineValue[] {
  return rows.map((row) => ({
    accountId: row.account_id,
    debitAmount: String(row.debit_amount ?? '0'),
    creditAmount: String(row.credit_amount ?? '0'),
  }))
}

export function toEntryFormValues(row: JournalEntryRow, lines: EntryLineValue[]): EntryFormValues {
  return {
    id: row.id,
    entryNumber: row.entry_number ?? '',
    entryDate: (row.entry_date ?? '').slice(0, 10),
    postingDate: (row.posting_date ?? '').slice(0, 10),
    periodId: row.period_id ?? '',
    entryType: row.entry_type ?? 'standard',
    description: row.description ?? '',
    reference: row.reference ?? '',
    currencyCode: row.currency_code ?? 'SAR',
    exchangeRate: '1',
    lines: lines.length > 0 ? lines : [emptyEntryLine(), emptyEntryLine()],
    updatedAt: row.updatedAt ?? row.updated_at ?? null,
  }
}

export function buildEntryFormDefaults(id = ''): EntryFormValues {
  const today = new Date().toISOString().slice(0, 10)
  return {
    id,
    entryNumber: '',
    entryDate: today,
    postingDate: today,
    periodId: '',
    entryType: 'standard',
    description: '',
    reference: '',
    currencyCode: 'SAR',
    exchangeRate: '1',
    lines: [emptyEntryLine(), emptyEntryLine()],
    updatedAt: null,
  }
}

export function toEntryPayload(values: EntryFormValues): Record<string, unknown> {
  return {
    entryNumber: values.entryNumber.trim(),
    entryDate: values.entryDate,
    postingDate: values.postingDate,
    periodId: values.periodId,
    entryType: values.entryType,
    description: values.description.trim(),
    reference: values.reference.trim().length > 0 ? values.reference.trim() : null,
    currencyCode: values.currencyCode.trim().toUpperCase(),
    exchangeRate: values.exchangeRate.trim().length > 0 ? values.exchangeRate.trim() : '1',
    lines: values.lines
      .filter((line) => line.accountId.length > 0)
      .map((line) => ({
        accountId: line.accountId,
        debitAmount: line.debitAmount,
        creditAmount: line.creditAmount,
      })),
  }
}

type Translate = ReturnType<typeof useT>

function usePeriodOptions() {
  const query = useQuery({
    queryKey: ['financial-period-options'],
    queryFn: () => fetchCrudList<PeriodOptionRow>('financial/periods', {
      pageSize: 100,
      sortField: 'fiscal_year',
      sortDir: 'desc',
    }),
  })
  return React.useMemo(
    () => (query.data?.items ?? []).map((period) => ({
      value: period.id,
      label: `${period.fiscal_year} · ${period.period_name}`,
    })),
    [query.data],
  )
}

function useEntryFields(t: Translate, periodOptions: Array<{ value: string; label: string }>): CrudField[] {
  return React.useMemo<CrudField[]>(() => [
    { id: 'entryNumber', label: t('financial.entries.form.fields.entryNumber', 'Entry number'), type: 'text', required: true, layout: 'half' },
    { id: 'entryDate', label: t('financial.entries.form.fields.entryDate', 'Entry date'), type: 'date', required: true, layout: 'half' },
    { id: 'postingDate', label: t('financial.entries.form.fields.postingDate', 'Posting date'), type: 'date', required: true, layout: 'half' },
    {
      id: 'periodId',
      label: t('financial.entries.form.fields.period', 'Accounting period'),
      type: 'select',
      required: true,
      layout: 'half',
      options: periodOptions,
    },
    { id: 'currencyCode', label: t('financial.entries.form.fields.currencyCode', 'Currency (ISO 4217)'), type: 'text', required: true, layout: 'half' },
    { id: 'exchangeRate', label: t('financial.entries.form.fields.exchangeRate', 'Exchange rate'), type: 'text', layout: 'half' },
    {
      id: 'entryType',
      label: t('financial.entries.form.fields.entryType', 'Entry type'),
      type: 'select',
      layout: 'half',
      options: ENTRY_TYPE_VALUES.map((value) => ({
        value,
        label: t(`financial.entries.type.${value}`, ENTRY_TYPE_FALLBACKS[value]),
      })),
    },
    { id: 'description', label: t('financial.entries.form.fields.description', 'Description'), type: 'text', required: true, layout: 'half' },
    { id: 'reference', label: t('financial.entries.form.fields.reference', 'Reference'), type: 'text', layout: 'half' },
    {
      id: 'lines',
      label: t('financial.entries.form.fields.lines', 'Lines'),
      type: 'custom',
      component: EntryLinesEditor,
      rendersOwnError: true,
    },
  ], [periodOptions, t])
}

function useEntryGroups(t: Translate): CrudFormGroup[] {
  return React.useMemo<CrudFormGroup[]>(() => [
    {
      id: 'header',
      title: t('financial.entries.form.groups.header', 'Entry'),
      column: 1,
      fields: [
        'entryNumber',
        'entryDate',
        'postingDate',
        'periodId',
        'currencyCode',
        'exchangeRate',
        'entryType',
        'description',
        'reference',
      ],
    },
    {
      id: 'postings',
      title: t('financial.entries.form.groups.lines', 'Postings'),
      column: 1,
      fields: ['lines'],
    },
  ], [t])
}

export function EntryCreateForm() {
  const t = useT()
  const periodOptions = usePeriodOptions()
  const fields = useEntryFields(t, periodOptions)
  const groups = useEntryGroups(t)
  const successRedirect = React.useMemo(
    () => withFlash(LIST_HREF, t('financial.entries.form.flash.created', 'Entry created.'), 'success'),
    [t],
  )

  return (
    <CrudForm<EntryFormValues>
      title={t('financial.entries.form.create.title', 'New journal entry')}
      titleHeadingLevel={1}
      backHref={LIST_HREF}
      entityId={ENTITY_ID}
      fields={fields}
      groups={groups}
      initialValues={buildEntryFormDefaults()}
      submitLabel={t('financial.entries.form.create.submit', 'Create draft')}
      cancelHref={LIST_HREF}
      successRedirect={successRedirect}
      onSubmit={async (values) => {
        await createCrud(RESOURCE, toEntryPayload(values))
      }}
    />
  )
}

export function EntryEditForm({ id }: { id: string }) {
  const t = useT()
  const periodOptions = usePeriodOptions()
  const fields = useEntryFields(t, periodOptions)
  const groups = useEntryGroups(t)
  const [initial, setInitial] = React.useState<EntryFormValues | null>(null)
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
        const [header, lines] = await Promise.all([
          fetchCrudList<JournalEntryRow>(RESOURCE, { ids: String(id), pageSize: 1 }),
          fetchCrudList<EntryLineRow>(ENTRY_LINES_RESOURCE, { id: String(id), pageSize: 100 }),
        ])
        const item = header?.items?.[0]
        if (!item) {
          if (!cancelled) setNotFound(true)
          return
        }
        if (!cancelled) setInitial(toEntryFormValues(item, toEntryLineValues(lines?.items ?? [])))
      } catch (caught: unknown) {
        if (!cancelled) {
          if ((caught as { status?: number }).status === 404) {
            setNotFound(true)
          } else {
            setError(caught instanceof Error && caught.message
              ? caught.message
              : t('financial.entries.form.error.load', 'Could not load the journal entry.'))
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
    () => withFlash(LIST_HREF, t('financial.entries.form.flash.saved', 'Entry saved.'), 'success'),
    [t],
  )

  if (notFound) {
    return (
      <RecordNotFoundState
        label={t('financial.entries.form.error.notFound', 'Journal entry not found.')}
        backHref={LIST_HREF}
        backLabel={t('financial.entries.actions.backToList', 'Back to entries')}
      />
    )
  }

  if (error) return <ErrorMessage label={error} />

  return (
    <CrudForm<EntryFormValues>
      title={t('financial.entries.form.edit.title', 'Edit journal entry')}
      titleHeadingLevel={1}
      backHref={LIST_HREF}
      entityId={ENTITY_ID}
      fields={fields}
      groups={groups}
      initialValues={initial ?? buildEntryFormDefaults(id)}
      submitLabel={t('financial.entries.form.edit.submit', 'Save draft')}
      cancelHref={LIST_HREF}
      successRedirect={successRedirect}
      isLoading={loading}
      loadingMessage={t('financial.entries.form.loading', 'Loading entry…')}
      onSubmit={async (values) => {
        await updateCrud(RESOURCE, { id, ...toEntryPayload(values) })
      }}
    />
  )
}


