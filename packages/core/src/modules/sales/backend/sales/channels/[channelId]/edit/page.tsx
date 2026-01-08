"use client"

import * as React from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm } from '@open-mercato/ui/backend/CrudForm'
import { collectCustomFieldValues } from '@open-mercato/ui/backend/utils/customFieldValues'
import { updateCrud, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useChannelFields, buildChannelPayload, type ChannelFormValues } from '@open-mercato/core/modules/sales/components/channels/channelFormFields'
import { E } from '@open-mercato/core/generated/entities.ids.generated'
import { SalesChannelOffersPanel } from '@open-mercato/core/modules/sales/components/channels/SalesChannelOffersPanel'

type ChannelApiResponse = {
  items?: Array<Record<string, unknown>>
}

export default function EditChannelPage({ params }: { params?: { channelId?: string } }) {
  const channelId = params?.channelId ?? ''
  const router = useRouter()
  const searchParams = useSearchParams()
  const t = useT()
  const { fields, groups } = useChannelFields()
  const [initialValues, setInitialValues] = React.useState<ChannelFormValues | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [activeTab, setActiveTab] = React.useState<'settings' | 'offers'>('settings')

  React.useEffect(() => {
    const tabParam = (searchParams?.get('tab') ?? '').toLowerCase()
    if (tabParam === 'offers') {
      setActiveTab('offers')
    } else if (tabParam === 'settings') {
      setActiveTab('settings')
    }
  }, [searchParams])

  React.useEffect(() => {
    if (!channelId) return
    let cancelled = false
    async function loadChannel() {
      setLoading(true)
      setError(null)
      try {
        const payload = await readApiResultOrThrow<ChannelApiResponse>(
          `/api/sales/channels?id=${encodeURIComponent(channelId)}&pageSize=1`,
          undefined,
          { errorMessage: t('sales.channels.form.errors.load', 'Failed to load channel.') },
        )
        const item = Array.isArray(payload.items) ? payload.items[0] : null
        if (!item) {
          throw new Error('not_found')
        }
        if (!cancelled) {
          setInitialValues(mapChannelToFormValues(item))
        }
      } catch (err) {
        console.error('sales.channels.load', err)
        if (!cancelled) setError(t('sales.channels.form.errors.load', 'Failed to load channel.'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void loadChannel()
    return () => { cancelled = true }
  }, [channelId, t])

  const handleSubmit = React.useCallback(async (values: ChannelFormValues) => {
    if (!channelId) return
    const payload: Record<string, unknown> = { id: channelId, ...buildChannelPayload(values) }
    const customFields = collectCustomFieldValues(values)
    if (Object.keys(customFields).length) payload.customFields = customFields
    await updateCrud('sales/channels', payload, {
      errorMessage: t('sales.channels.form.errors.update', 'Failed to save channel.'),
    })
    flash(t('sales.channels.form.messages.updated', 'Channel updated.'), 'success')
    router.push('/backend/sales/channels')
  }, [channelId, router, t])

  const handleDelete = React.useCallback(async () => {
    if (!channelId) return
    await deleteCrud('sales/channels', channelId, {
      errorMessage: t('sales.channels.form.errors.delete', 'Failed to delete channel.'),
    })
    flash(t('sales.channels.form.messages.deleted', 'Channel deleted.'), 'success')
    router.push('/backend/sales/channels')
  }, [channelId, router, t])

  const handleTabSelect = React.useCallback((value: 'settings' | 'offers') => {
    setActiveTab(value)
    if (!channelId) return
    const basePath = `/backend/sales/channels/${channelId}/edit`
    const nextUrl = value === 'offers' ? `${basePath}?tab=offers` : basePath
    router.replace(nextUrl)
  }, [channelId, router])

  const tabButton = React.useCallback((value: 'settings' | 'offers', label: string) => (
    <button
      key={value}
      type="button"
      className={`px-4 py-2 text-sm font-medium border-b-2 ${activeTab === value ? 'border-primary text-primary' : 'border-transparent text-muted-foreground'}`}
      onClick={() => handleTabSelect(value)}
    >
      {label}
    </button>
  ), [activeTab, handleTabSelect])

  const renderTabs = React.useCallback(() => (
    <div className="flex items-center gap-2 border-b mb-6">
      {tabButton('settings', t('sales.channels.form.tabs.settings', 'Settings'))}
      {tabButton('offers', t('sales.channels.form.tabs.offers', 'Offers'))}
    </div>
  ), [tabButton, t])

  return (
    <Page>
      <PageBody>
        {error ? (
          <div className="mb-4 rounded border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        ) : null}
        {activeTab === 'settings' ? (
          <CrudForm<ChannelFormValues>
            title={t('sales.channels.form.editTitle', 'Edit channel')}
            entityId={E.sales.sales_channel}
            fields={fields}
            groups={[
              ...groups,
              { id: 'custom', title: t('entities.customFields.title', 'Custom Attributes'), column: 2, kind: 'customFields' },
            ]}
            initialValues={initialValues ?? undefined}
            isLoading={loading}
            loadingMessage={t('sales.channels.form.loading', 'Loading channel…')}
            submitLabel={t('sales.channels.form.updateSubmit', 'Save changes')}
            cancelHref="/backend/sales/channels"
            backHref="/backend/sales/channels"
            contentHeader={renderTabs()}
            onSubmit={handleSubmit}
            onDelete={handleDelete}
            deleteVisible
            deleteRedirect="/backend/sales/channels"
          />
        ) : (
          <>
            {renderTabs()}
            <SalesChannelOffersPanel channelId={channelId} channelName={initialValues?.name ?? ''} />
          </>
        )}
      </PageBody>
    </Page>
  )
}

function mapChannelToFormValues(item: Record<string, unknown>): ChannelFormValues {
  const values: ChannelFormValues = {
    name: typeof item.name === 'string' ? item.name : '',
    code: typeof item.code === 'string' ? item.code : null,
    description: typeof item.description === 'string' ? item.description : null,
    websiteUrl: typeof item.websiteUrl === 'string' ? item.websiteUrl : typeof item.website_url === 'string' ? item.website_url : null,
    contactEmail: typeof item.contactEmail === 'string' ? item.contactEmail : typeof item.contact_email === 'string' ? item.contact_email : null,
    contactPhone: typeof item.contactPhone === 'string' ? item.contactPhone : typeof item.contact_phone === 'string' ? item.contact_phone : null,
    addressLine1: typeof item.addressLine1 === 'string' ? item.addressLine1 : typeof item.address_line1 === 'string' ? item.address_line1 : null,
    addressLine2: typeof item.addressLine2 === 'string' ? item.addressLine2 : typeof item.address_line2 === 'string' ? item.address_line2 : null,
    city: typeof item.city === 'string' ? item.city : null,
    region: typeof item.region === 'string' ? item.region : null,
    postalCode: typeof item.postalCode === 'string' ? item.postalCode : typeof item.postal_code === 'string' ? item.postal_code : null,
    country: typeof item.country === 'string' ? item.country : null,
    latitude: typeof item.latitude === 'number' ? item.latitude : typeof item.latitude === 'string' ? item.latitude : null,
    longitude: typeof item.longitude === 'number' ? item.longitude : typeof item.longitude === 'string' ? item.longitude : null,
    statusEntryId: typeof item.statusEntryId === 'string'
      ? item.statusEntryId
      : typeof item.status_entry_id === 'string'
        ? item.status_entry_id
        : null,
    isActive: item.isActive === true || item.is_active === true,
  }
  const mergeCustomObject = (source: unknown) => {
    if (!source || typeof source !== 'object' || Array.isArray(source)) return
    for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
      if (!key) continue
      values[`cf_${key}`] = value
    }
  }
  const mergeCustomArray = (source: unknown) => {
    if (!Array.isArray(source)) return
    source.forEach((entry) => {
      if (!entry || typeof entry !== 'object') return
      const key = typeof (entry as Record<string, unknown>).key === 'string'
        ? (entry as Record<string, unknown>).key
        : null
      if (!key) return
      values[`cf_${key}`] = (entry as Record<string, unknown>).value
    })
  }
  mergeCustomObject(item.customValues)
  mergeCustomObject((item as Record<string, unknown>).custom_values)
  mergeCustomObject(item.customFields)
  mergeCustomObject((item as Record<string, unknown>).custom_fields)
  mergeCustomArray(item.customFields)
  mergeCustomArray((item as Record<string, unknown>).custom_fields)
  mergeCustomArray((item as Record<string, unknown>).customFieldEntries)
  mergeCustomArray((item as Record<string, unknown>).custom_field_entries)
  return values
}
