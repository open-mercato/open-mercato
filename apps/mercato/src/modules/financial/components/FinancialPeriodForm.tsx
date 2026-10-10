"use client"

import * as React from 'react'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { createCrud, fetchCrudList, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { withFlash } from '@open-mercato/ui/backend/utils/flash'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { PeriodRow } from './FinancialPeriodsTable'

const ENTITY_ID = 'financial:gl_period'
const LIST_HREF = '/backend/financial/periods'
const RESOURCE = 'financial/periods'

export type PeriodFormValues = {
  id: string
  fiscalYear: number
  periodNumber: number
  periodName: string
  startDate: string
  endDate: string
  updatedAt?: string | null
}

export function toPeriodFormValues(row: PeriodRow): PeriodFormValues {
  return {
    id: row.id,
    fiscalYear: Number(row.fiscal_year ?? new Date().getUTCFullYear()),
    periodNumber: Number(row.period_number ?? 1),
    periodName: row.period_name ?? '',
    startDate: (row.start_date ?? '').slice(0, 10),
    endDate: (row.end_date ?? '').slice(0, 10),
    updatedAt: row.updatedAt ?? row.updated_at ?? null,
  }
}

export function buildPeriodFormDefaults(id = ''): PeriodFormValues {
  const year = new Date().getUTCFullYear()
  return {
    id,
    fiscalYear: year,
    periodNumber: 1,
    periodName: `P1-${year}`,
    startDate: `${year}-01-01`,
    endDate: `${year}-01-31`,
    updatedAt: null,
  }
}

export function toPeriodPayload(values: PeriodFormValues): Record<string, unknown> {
  return {
    fiscalYear: Number(values.fiscalYear),
    periodNumber: Number(values.periodNumber),
    periodName: values.periodName.trim(),
    startDate: values.startDate,
    endDate: values.endDate,
  }
}

type Translate = ReturnType<typeof useT>

function usePeriodFields(t: Translate): CrudField[] {
  return React.useMemo<CrudField[]>(() => [
    { id: 'fiscalYear', label: t('financial.periods.form.fields.fiscalYear', 'Fiscal year'), type: 'number', required: true, layout: 'half' },
    { id: 'periodNumber', label: t('financial.periods.form.fields.periodNumber', 'Period number'), type: 'number', required: true, layout: 'half' },
    { id: 'periodName', label: t('financial.periods.form.fields.periodName', 'Period name'), type: 'text', required: true, layout: 'half' },
    { id: 'startDate', label: t('financial.periods.form.fields.startDate', 'Start date'), type: 'date', required: true, layout: 'half' },
    { id: 'endDate', label: t('financial.periods.form.fields.endDate', 'End date'), type: 'date', required: true, layout: 'half' },
  ], [t])
}

function usePeriodGroups(t: Translate): CrudFormGroup[] {
  return React.useMemo<CrudFormGroup[]>(() => [
    {
      id: 'identity',
      title: t('financial.periods.form.groups.identity', 'Period'),
      column: 1,
      fields: ['fiscalYear', 'periodNumber', 'periodName'],
    },
    {
      id: 'range',
      title: t('financial.periods.form.groups.range', 'Date range'),
      column: 1,
      fields: ['startDate', 'endDate'],
    },
  ], [t])
}

export function PeriodCreateForm() {
  const t = useT()
  const fields = usePeriodFields(t)
  const groups = usePeriodGroups(t)
  const successRedirect = React.useMemo(
    () => withFlash(LIST_HREF, t('financial.periods.form.flash.created', 'Period created.'), 'success'),
    [t],
  )

  return (
    <CrudForm<PeriodFormValues>
      title={t('financial.periods.form.create.title', 'New accounting period')}
      titleHeadingLevel={1}
      backHref={LIST_HREF}
      entityId={ENTITY_ID}
      fields={fields}
      groups={groups}
      initialValues={buildPeriodFormDefaults()}
      submitLabel={t('financial.periods.form.create.submit', 'Create period')}
      cancelHref={LIST_HREF}
      successRedirect={successRedirect}
      onSubmit={async (values) => {
        await createCrud(RESOURCE, toPeriodPayload(values))
      }}
    />
  )
}

export function PeriodEditForm({ id }: { id: string }) {
  const t = useT()
  const fields = usePeriodFields(t)
  const groups = usePeriodGroups(t)
  const [initial, setInitial] = React.useState<PeriodFormValues | null>(null)
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
        const data = await fetchCrudList<PeriodRow>(RESOURCE, { ids: String(id), pageSize: 1 })
        const item = data?.items?.[0]
        if (!item) {
          if (!cancelled) setNotFound(true)
          return
        }
        if (!cancelled) setInitial(toPeriodFormValues(item))
      } catch (caught: unknown) {
        if (!cancelled) {
          if ((caught as { status?: number }).status === 404) {
            setNotFound(true)
          } else {
            setError(caught instanceof Error && caught.message
              ? caught.message
              : t('financial.periods.form.error.load', 'Could not load the period.'))
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
    () => withFlash(LIST_HREF, t('financial.periods.form.flash.saved', 'Period saved.'), 'success'),
    [t],
  )

  if (notFound) {
    return (
      <RecordNotFoundState
        label={t('financial.periods.form.error.notFound', 'Period not found.')}
        backHref={LIST_HREF}
        backLabel={t('financial.periods.actions.backToList', 'Back to periods')}
      />
    )
  }

  if (error) return <ErrorMessage label={error} />

  return (
    <CrudForm<PeriodFormValues>
      title={t('financial.periods.form.edit.title', 'Edit accounting period')}
      titleHeadingLevel={1}
      backHref={LIST_HREF}
      entityId={ENTITY_ID}
      fields={fields}
      groups={groups}
      initialValues={initial ?? buildPeriodFormDefaults(id)}
      submitLabel={t('financial.periods.form.edit.submit', 'Save changes')}
      cancelHref={LIST_HREF}
      successRedirect={successRedirect}
      isLoading={loading}
      loadingMessage={t('financial.periods.form.loading', 'Loading period…')}
      onSubmit={async (values) => {
        await updateCrud(RESOURCE, { id, ...toPeriodPayload(values) })
      }}
    />
  )
}

