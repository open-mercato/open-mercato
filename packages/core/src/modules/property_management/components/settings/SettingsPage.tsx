"use client"

import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField, type CrudFieldOption, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type SettingsValues = {
  billingChannelId: string | null
  cancelledOrderStatusEntryId: string | null
  leaseEndingThresholdDays: number
  bookingReminderMinutes: number
  proposalExpiryDays: number
  updatedAt?: string | null
} & Record<string, unknown>

type SettingsFormValues = Omit<SettingsValues, 'billingChannelId' | 'cancelledOrderStatusEntryId'> & {
  billingChannelId: string
  cancelledOrderStatusEntryId: string
}

async function loadChannelOptions(): Promise<CrudFieldOption[]> {
  const call = await apiCall<{ items?: Array<{ id: string; name: string }> }>('/api/sales/channels?pageSize=100', undefined, { fallback: {} })
  const items = call.ok && Array.isArray(call.result?.items) ? call.result.items : []
  return items.map((item) => ({ value: item.id, label: item.name }))
}

async function loadStatusOptions(): Promise<CrudFieldOption[]> {
  const call = await apiCall<{ items?: Array<{ id: string; value: string; label: string | null }> }>('/api/sales/order-statuses?pageSize=100', undefined, { fallback: {} })
  const items = call.ok && Array.isArray(call.result?.items) ? call.result.items : []
  return items.map((item) => ({ value: item.id, label: item.label ?? item.value }))
}

function toNumber(value: unknown, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

export function SettingsPage() {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const [settings, setSettings] = React.useState<SettingsValues | null>(null)
  const [failed, setFailed] = React.useState(false)
  const [version, setVersion] = React.useState(0)

  React.useEffect(() => {
    let cancelled = false
    void apiCall<SettingsValues>('/api/property_management/settings').then((call) => {
      if (cancelled) return
      if (call.ok && call.result) {
        setSettings(call.result)
        setFailed(false)
      } else {
        setFailed(true)
      }
    })
    return () => {
      cancelled = true
    }
  }, [scopeVersion, version])

  const fields = React.useMemo<CrudField[]>(() => {
    const none = { value: '', label: t('property_management.settings.none', 'Not set') }
    return [
      {
        id: 'billingChannelId',
        label: t('property_management.settings.billingChannel', 'Sales channel'),
        type: 'select',
        loadOptions: async () => [none, ...(await loadChannelOptions())],
        description: t('property_management.settings.billingChannelHint', 'Every lease order, booking order and their invoices are created in this channel. Until one is chosen, leases cannot be created or proposed and units cannot be booked.'),
      },
      {
        id: 'cancelledOrderStatusEntryId',
        label: t('property_management.settings.cancelledStatus', 'Status for cancelled bookings'),
        type: 'select',
        loadOptions: async () => [none, ...(await loadStatusOptions())],
        description: t('property_management.settings.cancelledStatusHint', 'The sales order status a booking’s order moves to when the booking is cancelled — by the member, a manager, or a closure.'),
      },
      {
        id: 'leaseEndingThresholdDays',
        label: t('property_management.settings.leaseEnding', 'Lease ending warning (days before the end)'),
        type: 'number',
        required: true,
        description: t('property_management.settings.leaseEndingHint', 'A lease is “ending soon” this many days before its end date — on the floor plan, the lease detail, the Leases list and the tenant’s portal alike. 1–365.'),
      },
      {
        id: 'proposalExpiryDays',
        label: t('property_management.settings.proposalExpiry', 'Proposal expiry (days after sending)'),
        type: 'number',
        required: true,
        description: t('property_management.settings.proposalExpiryHint', 'How long a customer has to approve a lease or extension proposal, unless the manager sets another number on the proposal. 1–90.'),
      },
      {
        id: 'bookingReminderMinutes',
        label: t('property_management.settings.bookingReminder', 'Booking reminder (minutes before)'),
        type: 'number',
        required: true,
        description: t('property_management.settings.bookingReminderHint', 'Members get a notification this long before their booking starts. 5–1440.'),
      },
    ]
  }, [t])

  const groups = React.useMemo<CrudFormGroup[]>(() => [
    { id: 'billing', title: t('property_management.settings.groupBilling', 'Billing'), description: t('property_management.settings.groupBillingHint', 'The sales documents created for leases and bookings'), fields: ['billingChannelId', 'cancelledOrderStatusEntryId'] },
    { id: 'leases', title: t('property_management.settings.groupLeases', 'Leases'), description: t('property_management.settings.groupLeasesHint', 'When a lease counts as ending, and how long proposals stay open'), fields: ['leaseEndingThresholdDays', 'proposalExpiryDays'] },
    { id: 'bookings', title: t('property_management.settings.groupBookings', 'Bookings'), description: t('property_management.settings.groupBookingsHint', 'What members are told before a booking'), fields: ['bookingReminderMinutes'] },
  ], [t])

  if (failed) {
    return <Page><PageBody><ErrorMessage label={t('property_management.settings.loadError', 'Could not load the settings.')} /></PageBody></Page>
  }
  if (!settings) {
    return <Page><PageBody><LoadingMessage label={t('property_management.common.loading', 'Loading…')} /></PageBody></Page>
  }

  const initialValues: Partial<SettingsFormValues> = {
    billingChannelId: settings.billingChannelId ?? '',
    cancelledOrderStatusEntryId: settings.cancelledOrderStatusEntryId ?? '',
    leaseEndingThresholdDays: settings.leaseEndingThresholdDays,
    bookingReminderMinutes: settings.bookingReminderMinutes,
    proposalExpiryDays: settings.proposalExpiryDays,
    updatedAt: settings.updatedAt ?? null,
  }

  return (
    <Page>
      <PageBody>
        <CrudForm<SettingsFormValues>
          key={settings.updatedAt ?? 'new'}
          title={t('property_management.settings.title', 'Property management settings')}
          titleHeadingLevel={1}
          fields={fields}
          groups={groups}
          initialValues={initialValues}
          submitLabel={t('property_management.settings.save', 'Save settings')}
          onSubmit={async (values) => {
            await updateCrud('property_management/settings', {
              billingChannelId: values.billingChannelId || null,
              cancelledOrderStatusEntryId: values.cancelledOrderStatusEntryId || null,
              leaseEndingThresholdDays: toNumber(values.leaseEndingThresholdDays, 60),
              bookingReminderMinutes: toNumber(values.bookingReminderMinutes, 60),
              proposalExpiryDays: toNumber(values.proposalExpiryDays, 14),
            }, { errorMessage: t('property_management.settings.saveError', 'Could not save the settings.') })
            flash(t('property_management.settings.saved', 'Settings saved.'), 'success')
            setVersion((value) => value + 1)
          }}
        />
      </PageBody>
    </Page>
  )
}

export default SettingsPage
