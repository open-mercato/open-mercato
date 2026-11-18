"use client"

import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Button } from '@open-mercato/ui/primitives/button'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useCanOpenLink } from '../featureLinks'
import { SalesOptionField } from './SalesOptionField'
import { loadSalesOptions, type SalesOptionSource } from './salesOptions'

type SettingsValues = {
  billingChannelId: string | null
  cancelledOrderStatusEntryId: string | null
  leaseEndingThresholdDays: number
  bookingReminderMinutes: number
  proposalExpiryDays: number
  updatedAt?: string | null
  canEdit?: boolean
} & Record<string, unknown>

type SettingsFormValues = Omit<SettingsValues, 'billingChannelId' | 'cancelledOrderStatusEntryId'> & {
  billingChannelId: string
  cancelledOrderStatusEntryId: string
}

const SALES_CHANNELS_HREF = '/backend/sales/channels'
const SALES_SETTINGS_HREF = '/backend/config/sales'

const CHANNEL_SOURCE: SalesOptionSource<{ id: string; name: string }> = {
  path: '/api/sales/channels',
  label: 'sales channels',
  toOption: (item) => ({ value: item.id, label: item.name }),
}

const STATUS_SOURCE: SalesOptionSource<{ id: string; value: string; label: string | null }> = {
  path: '/api/sales/order-statuses',
  label: 'sales order statuses',
  toOption: (item) => ({ value: item.id, label: item.label ?? item.value }),
}

function toNumber(value: unknown, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numeric) ? numeric : fallback
}

export function SettingsPage() {
  const t = useT()
  const scopeVersion = useOrganizationScopeVersion()
  const canOpenChannels = useCanOpenLink('salesChannels')
  const canOpenSalesSettings = useCanOpenLink('salesSettings')
  const [settings, setSettings] = React.useState<SettingsValues | null>(null)
  const [failed, setFailed] = React.useState(false)
  const [version, setVersion] = React.useState(0)
  const [settingsScope, setSettingsScope] = React.useState(scopeVersion)
  const loadedScope = React.useRef<number | null>(null)
  const loadError = t('property_management.settings.loadError', 'Could not load the settings.')

  if (settingsScope !== scopeVersion) {
    setSettingsScope(scopeVersion)
    setSettings(null)
    setFailed(false)
  }

  React.useEffect(() => {
    let cancelled = false
    const fail = () => {
      if (cancelled) return
      setFailed(true)
      if (loadedScope.current === scopeVersion) flash(loadError, 'error')
    }
    void apiCall<SettingsValues>('/api/property_management/settings').then((call) => {
      if (cancelled) return
      if (call.ok && call.result) {
        loadedScope.current = scopeVersion
        setSettings(call.result)
        setFailed(false)
      } else {
        fail()
      }
    }).catch(fail)
    return () => {
      cancelled = true
    }
  }, [scopeVersion, version, loadError])

  const retry = React.useCallback(() => {
    setFailed(false)
    setVersion((value) => value + 1)
  }, [])

  const savedChannelId = settings?.billingChannelId ?? null
  const savedStatusId = settings?.cancelledOrderStatusEntryId ?? null
  const loadChannelOptions = React.useCallback(() => loadSalesOptions(CHANNEL_SOURCE, savedChannelId), [savedChannelId])
  const loadStatusOptions = React.useCallback(() => loadSalesOptions(STATUS_SOURCE, savedStatusId), [savedStatusId])

  const fields = React.useMemo<CrudField[]>(() => {
    const channelLabel = t('property_management.settings.billingChannel', 'Sales channel')
    const statusLabel = t('property_management.settings.cancelledStatus', 'Status for cancelled bookings')
    return [
      {
        id: 'billingChannelId',
        label: channelLabel,
        type: 'custom',
        component: (props) => (
          <SalesOptionField
            {...props}
            label={channelLabel}
            loadOptions={loadChannelOptions}
            emptyMessage={t('property_management.settings.noChannels', 'No sales channel exists yet.')}
            emptyActionLabel={t('property_management.settings.noChannelsAction', 'Create a sales channel')}
            emptyHref={canOpenChannels ? SALES_CHANNELS_HREF : null}
          />
        ),
        description: t('property_management.settings.billingChannelHint', 'Every lease order, booking order and their invoices are created in this channel. Until one is chosen, leases cannot be created or proposed and units cannot be booked.'),
      },
      {
        id: 'cancelledOrderStatusEntryId',
        label: statusLabel,
        type: 'custom',
        component: (props) => (
          <SalesOptionField
            {...props}
            label={statusLabel}
            loadOptions={loadStatusOptions}
            emptyMessage={t('property_management.settings.noStatuses', 'No sales order statuses exist yet.')}
            emptyActionLabel={t('property_management.settings.noStatusesAction', 'Set up order statuses')}
            emptyHref={canOpenSalesSettings ? SALES_SETTINGS_HREF : null}
          />
        ),
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
  }, [canOpenChannels, canOpenSalesSettings, loadChannelOptions, loadStatusOptions, t])

  const groups = React.useMemo<CrudFormGroup[]>(() => [
    { id: 'billing', title: t('property_management.settings.groupBilling', 'Billing'), description: t('property_management.settings.groupBillingHint', 'The sales documents created for leases and bookings'), fields: ['billingChannelId', 'cancelledOrderStatusEntryId'] },
    { id: 'leases', title: t('property_management.settings.groupLeases', 'Leases'), description: t('property_management.settings.groupLeasesHint', 'When a lease counts as ending, and how long proposals stay open'), fields: ['leaseEndingThresholdDays', 'proposalExpiryDays'] },
    { id: 'bookings', title: t('property_management.settings.groupBookings', 'Bookings'), description: t('property_management.settings.groupBookingsHint', 'What members are told before a booking'), fields: ['bookingReminderMinutes'] },
  ], [t])

  if (failed && !settings) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage
            label={loadError}
            action={<Button type="button" variant="outline" onClick={retry}>{t('property_management.common.retry', 'Try again')}</Button>}
          />
        </PageBody>
      </Page>
    )
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
          readOnly={settings.canEdit !== true}
          readOnlyOverlay={(
            <div className="rounded-xl border border-border/70 bg-background/95 px-4 py-3 text-sm text-muted-foreground shadow-sm" data-testid="pm-settings-read-only">
              {t('property_management.settings.readOnly', 'View only. Changing these settings needs the permission to manage every building.')}
            </div>
          )}
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
