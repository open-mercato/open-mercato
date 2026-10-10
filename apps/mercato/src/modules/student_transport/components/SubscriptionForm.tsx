"use client"

import * as React from 'react'
import { useQuery } from '@tanstack/react-query'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { createCrud, fetchCrudList, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { withFlash } from '@open-mercato/ui/backend/utils/flash'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import {
  SUBSCRIPTION_ACCOUNT_TYPE_FALLBACKS,
  SUBSCRIPTION_ACCOUNT_TYPE_VALUES,
  SUBSCRIPTION_DIRECTION_FALLBACKS,
  SUBSCRIPTION_DIRECTION_VALUES,
  SUBSCRIPTION_DURATION_FALLBACKS,
  SUBSCRIPTION_DURATION_VALUES,
} from '../lib/transportEnums'
import { useCustomerOptions, type StudentCustomerSnapshot } from './studentOptions'
import { RESOURCE, type StudentSubscriptionRow } from './SubscriptionTable'

const ENTITY_ID = 'student_transport:student_subscription'
const SUBSCRIPTIONS_HREF = '/backend/education/subscriptions'

export type SubscriptionFormValues = {
  id: string
  studentName: string
  studentGrade: string
  guardianName: string
  guardianPhone: string
  accountType: string
  direction: string
  duration: string
  planId: string
  customerId: string
  schoolCustomerId: string
  pickupPoint: string
  dropoffPoint: string
  startDate: string
  endDate: string
  periodPrice: string
  currencyCode: string
  taxRate: string
  notes: string
  updatedAt?: string | null
}

function textOf(value: unknown): string {
  return value === null || value === undefined ? '' : String(value)
}

function dateOnly(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : ''
}

export function toSubscriptionFormValues(row: StudentSubscriptionRow): SubscriptionFormValues {
  const raw = row as unknown as Record<string, unknown>
  return {
    id: row.id,
    studentName: textOf(row.student_name),
    studentGrade: textOf(row.student_grade),
    guardianName: textOf(raw.guardian_name),
    guardianPhone: textOf(row.guardian_phone),
    accountType: textOf(row.account_type) || 'b2c',
    direction: textOf(row.direction) || 'two_way',
    duration: textOf(row.duration) || 'monthly',
    planId: textOf(raw.plan_id),
    customerId: row.customer_id ?? '',
    schoolCustomerId: textOf(raw.school_customer_id),
    pickupPoint: textOf(row.pickup_point),
    dropoffPoint: textOf(row.dropoff_point),
    startDate: dateOnly(row.start_date),
    endDate: dateOnly(row.end_date),
    periodPrice: textOf(row.period_price),
    currencyCode: textOf(row.currency_code) || 'SAR',
    taxRate: textOf(raw.tax_rate) || '15',
    notes: textOf(raw.notes),
    updatedAt: row.updatedAt ?? row.updated_at ?? null,
  }
}

export function buildSubscriptionFormDefaults(id = ''): SubscriptionFormValues {
  return {
    id,
    studentName: '',
    studentGrade: '',
    guardianName: '',
    guardianPhone: '',
    accountType: 'b2c',
    direction: 'two_way',
    duration: 'monthly',
    planId: '',
    customerId: '',
    schoolCustomerId: '',
    pickupPoint: '',
    dropoffPoint: '',
    startDate: new Date().toISOString().slice(0, 10),
    endDate: '',
    periodPrice: '',
    currencyCode: 'SAR',
    taxRate: '15',
    notes: '',
    updatedAt: null,
  }
}

function optional(value: string): string | null {
  return value && value.trim().length ? value.trim() : null
}

/**
 * The payer is the parent for a B2C subscription and the school for a B2B one,
 * so the form sends the snapshot that matches the chosen account type — the
 * invoice keeps that snapshot if the CRM record changes later.
 */
export function toSubscriptionPayload(
  values: SubscriptionFormValues,
  payerSnapshot: StudentCustomerSnapshot | null,
  schoolSnapshot: StudentCustomerSnapshot | null,
  t: (key: string, fallback: string) => string,
): Record<string, unknown> {
  const isB2b = values.accountType === 'b2b'
  const effectivePayer = isB2b && schoolSnapshot ? schoolSnapshot : payerSnapshot
  if (!effectivePayer) {
    throw createCrudFormError(t('student_transport.subscriptions.form.error.customerMissing', 'Choose the paying party from the list.'))
  }
  return {
    studentName: values.studentName.trim(),
    studentGrade: optional(values.studentGrade),
    guardianName: optional(values.guardianName),
    guardianPhone: optional(values.guardianPhone),
    accountType: values.accountType || 'b2c',
    direction: values.direction || 'two_way',
    duration: values.duration || 'monthly',
    planId: optional(values.planId),
    customerId: effectivePayer.id,
    customerSnapshot: effectivePayer,
    schoolCustomerId: isB2b ? effectivePayer.id : optional(values.schoolCustomerId),
    schoolSnapshot: isB2b ? effectivePayer : schoolSnapshot,
    pickupPoint: optional(values.pickupPoint),
    dropoffPoint: optional(values.dropoffPoint),
    startDate: optional(values.startDate),
    endDate: optional(values.endDate),
    periodPrice: optional(values.periodPrice),
    currencyCode: optional(values.currencyCode) ?? 'SAR',
    taxRate: optional(values.taxRate) ?? '15',
    notes: optional(values.notes),
  }
}

type Translate = ReturnType<typeof useT>

function usePlanOptions() {
  const scopeVersion = useOrganizationScopeVersion()
  const query = useQuery({
    queryKey: ['student-plan-options', scopeVersion],
    queryFn: async () => {
      const call = await apiCall<{ items?: Array<Record<string, unknown>> }>('/api/student_transport/plans?isActive=true&pageSize=100')
      return (call.result?.items ?? []).flatMap((raw) => {
        const id = typeof raw.id === 'string' ? raw.id : null
        if (!id) return []
        const name = typeof raw.name === 'string' ? raw.name : id
        return [{ value: id, label: name }]
      })
    },
    staleTime: 60 * 1000,
  })
  return query.data ?? []
}

function useSubscriptionFields(
  t: Translate,
  customerOptions: Array<{ value: string; label: string }>,
  planOptions: Array<{ value: string; label: string }>,
): CrudField[] {
  return React.useMemo<CrudField[]>(() => [
    {
      id: 'studentName',
      label: t('student_transport.subscriptions.form.fields.studentName', 'Student name'),
      type: 'text',
      required: true,
      layout: 'half',
    },
    {
      id: 'studentGrade',
      label: t('student_transport.subscriptions.form.fields.studentGrade', 'Grade'),
      type: 'text',
      layout: 'half',
    },
    {
      id: 'guardianName',
      label: t('student_transport.subscriptions.form.fields.guardianName', 'Guardian'),
      type: 'text',
      layout: 'half',
    },
    {
      id: 'guardianPhone',
      label: t('student_transport.subscriptions.form.fields.guardianPhone', 'Guardian phone'),
      type: 'text',
      layout: 'half',
    },
    {
      id: 'accountType',
      label: t('student_transport.subscriptions.form.fields.accountType', 'Billed to'),
      type: 'select',
      layout: 'half',
      options: SUBSCRIPTION_ACCOUNT_TYPE_VALUES.map((value) => ({
        value,
        label: t(`student_transport.account_type.${value}`, SUBSCRIPTION_ACCOUNT_TYPE_FALLBACKS[value] ?? value),
      })),
    },
    {
      id: 'direction',
      label: t('student_transport.subscriptions.form.fields.direction', 'Direction'),
      type: 'select',
      layout: 'half',
      options: SUBSCRIPTION_DIRECTION_VALUES.map((value) => ({
        value,
        label: t(`student_transport.direction.${value}`, SUBSCRIPTION_DIRECTION_FALLBACKS[value] ?? value),
      })),
    },
    {
      id: 'duration',
      label: t('student_transport.subscriptions.form.fields.duration', 'Duration'),
      type: 'select',
      layout: 'half',
      options: SUBSCRIPTION_DURATION_VALUES.map((value) => ({
        value,
        label: t(`student_transport.duration.${value}`, SUBSCRIPTION_DURATION_FALLBACKS[value] ?? value),
      })),
    },
    {
      id: 'planId',
      label: t('student_transport.subscriptions.form.fields.plan', 'Plan'),
      type: 'select',
      layout: 'half',
      options: planOptions,
    },
    {
      id: 'customerId',
      label: t('student_transport.subscriptions.form.fields.payer', 'Paying party'),
      type: 'select',
      required: true,
      options: customerOptions,
      description: t('student_transport.subscriptions.form.fields.payerHint', 'The parent for a B2C subscription, the school for a B2B one.'),
    },
    {
      id: 'schoolCustomerId',
      label: t('student_transport.subscriptions.form.fields.school', 'School'),
      type: 'select',
      options: customerOptions,
      visibleWhen: { field: 'accountType', equals: 'b2c' },
    },
    {
      id: 'pickupPoint',
      label: t('student_transport.subscriptions.form.fields.pickupPoint', 'Pickup point'),
      type: 'text',
      layout: 'half',
    },
    {
      id: 'dropoffPoint',
      label: t('student_transport.subscriptions.form.fields.dropoffPoint', 'Drop-off point'),
      type: 'text',
      layout: 'half',
    },
    {
      id: 'startDate',
      label: t('student_transport.subscriptions.form.fields.startDate', 'Starts'),
      type: 'date',
      layout: 'half',
    },
    {
      id: 'endDate',
      label: t('student_transport.subscriptions.form.fields.endDate', 'Ends'),
      type: 'date',
      layout: 'half',
    },
    {
      id: 'periodPrice',
      label: t('student_transport.subscriptions.form.fields.periodPrice', 'Price per period (net)'),
      type: 'number',
      layout: 'third',
      description: t('student_transport.subscriptions.form.fields.periodPriceHint', 'Leave empty to take the plan’s price for the chosen direction.'),
    },
    {
      id: 'currencyCode',
      label: t('student_transport.subscriptions.form.fields.currency', 'Currency'),
      type: 'text',
      layout: 'third',
    },
    {
      id: 'taxRate',
      label: t('student_transport.subscriptions.form.fields.taxRate', 'VAT rate (%)'),
      type: 'number',
      layout: 'third',
    },
    {
      id: 'notes',
      label: t('student_transport.subscriptions.form.fields.notes', 'Notes'),
      type: 'textarea',
    },
  ], [customerOptions, planOptions, t])
}

function useSubscriptionGroups(t: Translate): CrudFormGroup[] {
  return React.useMemo<CrudFormGroup[]>(() => [
    {
      id: 'student',
      title: t('student_transport.subscriptions.form.groups.student', 'Student and guardian'),
      column: 1,
      fields: ['studentName', 'studentGrade', 'guardianName', 'guardianPhone'],
    },
    {
      id: 'billing',
      title: t('student_transport.subscriptions.form.groups.billing', 'Subscription and billing'),
      column: 2,
      fields: ['accountType', 'direction', 'duration', 'planId', 'customerId', 'schoolCustomerId', 'periodPrice', 'currencyCode', 'taxRate'],
    },
    {
      id: 'route',
      title: t('student_transport.subscriptions.form.groups.route', 'Route and window'),
      column: 1,
      fields: ['pickupPoint', 'dropoffPoint', 'startDate', 'endDate'],
    },
    {
      id: 'notes',
      title: t('student_transport.subscriptions.form.groups.notes', 'Notes'),
      column: 2,
      fields: ['notes'],
    },
  ], [t])
}

export function SubscriptionCreateForm() {
  const t = useT()
  const { options: customerOptions, toSnapshot } = useCustomerOptions()
  const planOptions = usePlanOptions()
  const fields = useSubscriptionFields(t, customerOptions, planOptions)
  const groups = useSubscriptionGroups(t)
  const successRedirect = React.useMemo(
    () => withFlash(SUBSCRIPTIONS_HREF, t('student_transport.subscriptions.form.flash.saved', 'Subscription saved.'), 'success'),
    [t],
  )

  return (
    <CrudForm<SubscriptionFormValues>
      title={t('student_transport.subscriptions.form.create.title', 'New student subscription')}
      titleHeadingLevel={1}
      backHref={SUBSCRIPTIONS_HREF}
      entityId={ENTITY_ID}
      fields={fields}
      groups={groups}
      initialValues={buildSubscriptionFormDefaults()}
      submitLabel={t('student_transport.subscriptions.form.create.submit', 'Create subscription')}
      cancelHref={SUBSCRIPTIONS_HREF}
      successRedirect={successRedirect}
      onSubmit={async (values) => {
        await createCrud(RESOURCE, toSubscriptionPayload(
          values,
          toSnapshot(values.customerId),
          values.accountType === 'b2c' && values.schoolCustomerId ? toSnapshot(values.schoolCustomerId) : null,
          t,
        ))
      }}
    />
  )
}

export function SubscriptionEditForm({ id }: { id: string }) {
  const t = useT()
  const { options: customerOptions, toSnapshot } = useCustomerOptions()
  const planOptions = usePlanOptions()
  const fields = useSubscriptionFields(t, customerOptions, planOptions)
  const groups = useSubscriptionGroups(t)
  const [initial, setInitial] = React.useState<SubscriptionFormValues | null>(null)
  const [lockedMessage, setLockedMessage] = React.useState<string | null>(null)
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
        const data = await fetchCrudList<StudentSubscriptionRow>(RESOURCE, { ids: String(id), pageSize: 1 })
        const item = data?.items?.[0]
        if (!item) {
          if (!cancelled) setNotFound(true)
          return
        }
        if (!cancelled) {
          if (item.status === 'ended') {
            setLockedMessage(t('student_transport.subscriptions.form.error.ended', 'An ended subscription cannot be edited.'))
          }
          setInitial(toSubscriptionFormValues(item))
        }
      } catch (caught: unknown) {
        if (!cancelled) {
          setError(caught instanceof Error && caught.message
            ? caught.message
            : t('student_transport.subscriptions.form.error.load', 'Could not load the subscription.'))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [id, t])

  const successRedirect = React.useMemo(
    () => withFlash(SUBSCRIPTIONS_HREF, t('student_transport.subscriptions.form.flash.saved', 'Subscription saved.'), 'success'),
    [t],
  )

  if (notFound) {
    return (
      <RecordNotFoundState
        label={t('student_transport.subscriptions.form.error.notFound', 'Subscription not found.')}
        backHref={SUBSCRIPTIONS_HREF}
        backLabel={t('student_transport.subscriptions.actions.backToList', 'Back to subscriptions')}
      />
    )
  }
  if (error) return <ErrorMessage label={error} />

  const locked = Boolean(lockedMessage)

  return (
    <CrudForm<SubscriptionFormValues>
      title={t('student_transport.subscriptions.form.edit.title', 'Edit student subscription')}
      titleHeadingLevel={1}
      backHref={SUBSCRIPTIONS_HREF}
      entityId={ENTITY_ID}
      fields={fields}
      groups={groups}
      initialValues={initial ?? buildSubscriptionFormDefaults(id)}
      submitLabel={t('student_transport.subscriptions.form.edit.submit', 'Save changes')}
      cancelHref={SUBSCRIPTIONS_HREF}
      successRedirect={successRedirect}
      isLoading={loading}
      loadingMessage={t('student_transport.subscriptions.form.loading', 'Loading subscription…')}
      readOnly={locked}
      readOnlyOverlay={lockedMessage ? (
        <div className="rounded-xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground shadow-sm">{lockedMessage}</div>
      ) : undefined}
      disableOptimisticLock={locked}
      onSubmit={async (values) => {
        await updateCrud(RESOURCE, {
          id,
          ...toSubscriptionPayload(
            values,
            toSnapshot(values.customerId),
            values.accountType === 'b2c' && values.schoolCustomerId ? toSnapshot(values.schoolCustomerId) : null,
            t,
          ),
        })
      }}
    />
  )
}
