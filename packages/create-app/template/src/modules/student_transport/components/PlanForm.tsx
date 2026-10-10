"use client"

import * as React from 'react'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { createCrud, fetchCrudList, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { withFlash } from '@open-mercato/ui/backend/utils/flash'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import {
  SUBSCRIPTION_ACCOUNT_TYPE_FALLBACKS,
  SUBSCRIPTION_ACCOUNT_TYPE_VALUES,
  SUBSCRIPTION_DURATION_FALLBACKS,
  SUBSCRIPTION_DURATION_VALUES,
} from '../lib/transportEnums'
import { RESOURCE, type SubscriptionPlanRow } from './PlanTable'

const ENTITY_ID = 'student_transport:subscription_plan'
const PLANS_HREF = '/backend/education/plans'

export type PlanFormValues = {
  id: string
  name: string
  code: string
  accountType: string
  duration: string
  priceTwoWay: string
  priceOneWay: string
  currencyCode: string
  taxRate: string
  isActive: boolean
  notes: string
  updatedAt?: string | null
}

function textOf(value: unknown): string {
  return value === null || value === undefined ? '' : String(value)
}

export function toPlanFormValues(row: SubscriptionPlanRow): PlanFormValues {
  return {
    id: row.id,
    name: textOf(row.name),
    code: textOf(row.code),
    accountType: textOf(row.account_type) || 'b2c',
    duration: textOf(row.duration) || 'monthly',
    priceTwoWay: textOf(row.price_two_way),
    priceOneWay: textOf(row.price_one_way),
    currencyCode: textOf(row.currency_code) || 'SAR',
    taxRate: textOf(row.tax_rate) || '15',
    isActive: row.is_active !== false,
    notes: textOf(row.notes),
    updatedAt: row.updatedAt ?? null,
  }
}

export function buildPlanFormDefaults(id = ''): PlanFormValues {
  return {
    id,
    name: '',
    code: '',
    accountType: 'b2c',
    duration: 'monthly',
    priceTwoWay: '',
    priceOneWay: '',
    currencyCode: 'SAR',
    taxRate: '15',
    isActive: true,
    notes: '',
    updatedAt: null,
  }
}

function optional(value: string): string | null {
  return value && value.trim().length ? value.trim() : null
}

export function toPlanPayload(values: PlanFormValues): Record<string, unknown> {
  return {
    name: values.name.trim(),
    code: optional(values.code),
    accountType: values.accountType || 'b2c',
    duration: values.duration || 'monthly',
    priceTwoWay: optional(values.priceTwoWay) ?? '0',
    priceOneWay: optional(values.priceOneWay) ?? '0',
    currencyCode: optional(values.currencyCode) ?? 'SAR',
    taxRate: optional(values.taxRate) ?? '15',
    isActive: values.isActive,
    notes: optional(values.notes),
  }
}

type Translate = ReturnType<typeof useT>

function usePlanFields(t: Translate): CrudField[] {
  return React.useMemo<CrudField[]>(() => [
    {
      id: 'name',
      label: t('student_transport.plans.form.fields.name', 'Plan name'),
      type: 'text',
      required: true,
    },
    {
      id: 'code',
      label: t('student_transport.plans.form.fields.code', 'Code'),
      type: 'text',
      layout: 'half',
    },
    {
      id: 'accountType',
      label: t('student_transport.plans.form.fields.accountType', 'Billed to'),
      type: 'select',
      layout: 'half',
      options: SUBSCRIPTION_ACCOUNT_TYPE_VALUES.map((value) => ({
        value,
        label: t(`student_transport.account_type.${value}`, SUBSCRIPTION_ACCOUNT_TYPE_FALLBACKS[value] ?? value),
      })),
    },
    {
      id: 'duration',
      label: t('student_transport.plans.form.fields.duration', 'Duration'),
      type: 'select',
      layout: 'half',
      options: SUBSCRIPTION_DURATION_VALUES.map((value) => ({
        value,
        label: t(`student_transport.duration.${value}`, SUBSCRIPTION_DURATION_FALLBACKS[value] ?? value),
      })),
    },
    {
      id: 'currencyCode',
      label: t('student_transport.plans.form.fields.currency', 'Currency'),
      type: 'text',
      layout: 'half',
    },
    {
      id: 'priceTwoWay',
      label: t('student_transport.plans.form.fields.priceTwoWay', 'Two-way price per period'),
      type: 'number',
      layout: 'half',
    },
    {
      id: 'priceOneWay',
      label: t('student_transport.plans.form.fields.priceOneWay', 'One-way price per period'),
      type: 'number',
      layout: 'half',
    },
    {
      id: 'taxRate',
      label: t('student_transport.plans.form.fields.taxRate', 'VAT rate (%)'),
      type: 'number',
      layout: 'half',
    },
    {
      id: 'isActive',
      label: t('student_transport.plans.form.fields.isActive', 'Active'),
      type: 'checkbox',
      layout: 'half',
    },
    {
      id: 'notes',
      label: t('student_transport.plans.form.fields.notes', 'Notes'),
      type: 'textarea',
    },
  ], [t])
}

function usePlanGroups(t: Translate): CrudFormGroup[] {
  return React.useMemo<CrudFormGroup[]>(() => [
    {
      id: 'plan',
      title: t('student_transport.plans.form.groups.plan', 'Plan'),
      column: 1,
      fields: ['name', 'code', 'accountType', 'duration'],
    },
    {
      id: 'pricing',
      title: t('student_transport.plans.form.groups.pricing', 'Pricing'),
      column: 2,
      fields: ['currencyCode', 'priceTwoWay', 'priceOneWay', 'taxRate', 'isActive'],
    },
    {
      id: 'notes',
      title: t('student_transport.plans.form.groups.notes', 'Notes'),
      column: 1,
      fields: ['notes'],
    },
  ], [t])
}

export function PlanCreateForm() {
  const t = useT()
  const fields = usePlanFields(t)
  const groups = usePlanGroups(t)
  const successRedirect = React.useMemo(
    () => withFlash(PLANS_HREF, t('student_transport.plans.form.flash.saved', 'Plan saved.'), 'success'),
    [t],
  )

  return (
    <CrudForm<PlanFormValues>
      title={t('student_transport.plans.form.create.title', 'New subscription plan')}
      titleHeadingLevel={1}
      backHref={PLANS_HREF}
      entityId={ENTITY_ID}
      fields={fields}
      groups={groups}
      initialValues={buildPlanFormDefaults()}
      submitLabel={t('student_transport.plans.form.create.submit', 'Create plan')}
      cancelHref={PLANS_HREF}
      successRedirect={successRedirect}
      onSubmit={async (values) => {
        await createCrud(RESOURCE, toPlanPayload(values))
      }}
    />
  )
}

export function PlanEditForm({ id }: { id: string }) {
  const t = useT()
  const fields = usePlanFields(t)
  const groups = usePlanGroups(t)
  const [initial, setInitial] = React.useState<PlanFormValues | null>(null)
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
        const data = await fetchCrudList<SubscriptionPlanRow>(RESOURCE, { ids: String(id), pageSize: 1 })
        const item = data?.items?.[0]
        if (!item) {
          if (!cancelled) setNotFound(true)
          return
        }
        if (!cancelled) setInitial(toPlanFormValues(item))
      } catch (caught: unknown) {
        if (!cancelled) {
          setError(caught instanceof Error && caught.message
            ? caught.message
            : t('student_transport.plans.form.error.load', 'Could not load the plan.'))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [id, t])

  const successRedirect = React.useMemo(
    () => withFlash(PLANS_HREF, t('student_transport.plans.form.flash.saved', 'Plan saved.'), 'success'),
    [t],
  )

  if (notFound) {
    return (
      <RecordNotFoundState
        label={t('student_transport.plans.form.error.notFound', 'Plan not found.')}
        backHref={PLANS_HREF}
        backLabel={t('student_transport.plans.actions.backToList', 'Back to plans')}
      />
    )
  }
  if (error) return <ErrorMessage label={error} />

  return (
    <CrudForm<PlanFormValues>
      title={t('student_transport.plans.form.edit.title', 'Edit subscription plan')}
      titleHeadingLevel={1}
      backHref={PLANS_HREF}
      entityId={ENTITY_ID}
      fields={fields}
      groups={groups}
      initialValues={initial ?? buildPlanFormDefaults(id)}
      submitLabel={t('student_transport.plans.form.edit.submit', 'Save changes')}
      cancelHref={PLANS_HREF}
      successRedirect={successRedirect}
      isLoading={loading}
      loadingMessage={t('student_transport.plans.form.loading', 'Loading plan…')}
      onSubmit={async (values) => {
        await updateCrud(RESOURCE, { id, ...toPlanPayload(values) })
      }}
    />
  )
}
