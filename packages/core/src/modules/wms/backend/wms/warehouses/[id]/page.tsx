"use client"

import * as React from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Page, PageHeader, PageBody } from '@open-mercato/ui/backend/Page'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrud, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'

type WarehouseData = {
  id: string
  name: string
  code: string
  isActive: boolean
  address: Record<string, unknown> | null
  timezone: string | null
}
type WarehouseCreateResult = { id?: string | null }

export default function WmsWarehouseDetailPage() {
  const params = useParams()
  const router = useRouter()
  const t = useT()
  const id = params?.id as string
  const isNew = id === 'new'

  const [isLoading, setIsLoading] = React.useState(!isNew)
  const [isSaving, setIsSaving] = React.useState(false)
  const [name, setName] = React.useState('')
  const [code, setCode] = React.useState('')
  const [isActive, setIsActive] = React.useState(true)
  const [timezone, setTimezone] = React.useState('')
  const [addressLine1, setAddressLine1] = React.useState('')
  const [city, setCity] = React.useState('')
  const [postalCode, setPostalCode] = React.useState('')
  const [country, setCountry] = React.useState('')

  React.useEffect(() => {
    if (isNew) return
    let cancelled = false
    async function load() {
      setIsLoading(true)
      try {
        const call = await apiCall<WarehouseData>(`/api/wms/warehouses/${id}`)
        if (!cancelled && call.ok && call.result) {
          const d = call.result
          setName(d.name ?? '')
          setCode(d.code ?? '')
          setIsActive(d.isActive ?? true)
          setTimezone(d.timezone ?? '')
          if (d.address && typeof d.address === 'object') {
            setAddressLine1(typeof d.address.address_line1 === 'string' ? d.address.address_line1 : '')
            setCity(typeof d.address.city === 'string' ? d.address.city : '')
            setPostalCode(typeof d.address.postal_code === 'string' ? d.address.postal_code : '')
            setCountry(typeof d.address.country === 'string' ? d.address.country : '')
          }
        }
      } catch {
        if (!cancelled) flash(t('wms.warehouses.detail.error.load', 'Failed to load warehouse.'), 'error')
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [id, isNew, t])

  const handleSubmit = React.useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSaving(true)

    const address = (addressLine1 || city || postalCode || country)
      ? { address_line1: addressLine1, city, postal_code: postalCode, country }
      : null

    try {
      if (isNew) {
        const result = await createCrud<WarehouseCreateResult>('wms/warehouses', {
          name,
          code,
          is_active: isActive,
          address,
          timezone: timezone || null,
        })
        flash(t('wms.warehouses.detail.created', 'Warehouse created.'), 'success')
        const newId = result?.id
        if (newId) {
          router.push(`/backend/wms/warehouses/${newId}`)
        } else {
          router.push('/backend/wms/warehouses')
        }
      } else {
        await updateCrud('wms/warehouses', {
          id,
          name,
          code,
          is_active: isActive,
          address,
          timezone: timezone || null,
        })
        flash(t('wms.warehouses.detail.updated', 'Warehouse updated.'), 'success')
      }
    } catch {
      flash(t('wms.warehouses.detail.error.save', 'Failed to save warehouse.'), 'error')
    } finally {
      setIsSaving(false)
    }
  }, [isNew, id, name, code, isActive, timezone, addressLine1, city, postalCode, country, router, t])

  if (isLoading) {
    return (
      <Page>
        <PageHeader title={t('wms.warehouses.detail.loading', 'Loading…')} />
        <PageBody>
          <div className="animate-pulse space-y-4">
            <div className="h-10 w-1/3 rounded bg-gray-200" />
            <div className="h-10 w-1/3 rounded bg-gray-200" />
          </div>
        </PageBody>
      </Page>
    )
  }

  return (
    <Page>
      <PageHeader
        title={isNew
          ? t('wms.warehouses.detail.title.new', 'New Warehouse')
          : t('wms.warehouses.detail.title.edit', 'Edit Warehouse')
        }
      />
      <PageBody>
        <form onSubmit={handleSubmit} className="max-w-2xl space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium">{t('wms.warehouses.detail.name', 'Name')}</label>
              <input
                type="text"
                className="w-full rounded border px-3 py-2"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">{t('wms.warehouses.detail.code', 'Code')}</label>
              <input
                type="text"
                className="w-full rounded border px-3 py-2"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium">{t('wms.warehouses.detail.timezone', 'Timezone')}</label>
              <input
                type="text"
                className="w-full rounded border px-3 py-2"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                placeholder="e.g. Europe/Warsaw"
              />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                />
                <span className="text-sm font-medium">{t('wms.warehouses.detail.isActive', 'Active')}</span>
              </label>
            </div>
          </div>

          <fieldset className="rounded border p-4">
            <legend className="px-2 text-sm font-medium">{t('wms.warehouses.detail.address', 'Address')}</legend>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-sm">{t('wms.warehouses.detail.addressLine1', 'Address line')}</label>
                <input type="text" className="w-full rounded border px-3 py-2" value={addressLine1} onChange={(e) => setAddressLine1(e.target.value)} />
              </div>
              <div>
                <label className="mb-1 block text-sm">{t('wms.warehouses.detail.city', 'City')}</label>
                <input type="text" className="w-full rounded border px-3 py-2" value={city} onChange={(e) => setCity(e.target.value)} />
              </div>
              <div>
                <label className="mb-1 block text-sm">{t('wms.warehouses.detail.postalCode', 'Postal code')}</label>
                <input type="text" className="w-full rounded border px-3 py-2" value={postalCode} onChange={(e) => setPostalCode(e.target.value)} />
              </div>
              <div>
                <label className="mb-1 block text-sm">{t('wms.warehouses.detail.country', 'Country')}</label>
                <input type="text" className="w-full rounded border px-3 py-2" value={country} onChange={(e) => setCountry(e.target.value)} />
              </div>
            </div>
          </fieldset>

          <div className="flex gap-3">
            <button
              type="submit"
              disabled={isSaving}
              className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {isSaving
                ? t('common.saving', 'Saving…')
                : isNew
                  ? t('common.create', 'Create')
                  : t('common.save', 'Save')
              }
            </button>
            <button
              type="button"
              onClick={() => router.push('/backend/wms/warehouses')}
              className="rounded border px-4 py-2 text-sm font-medium hover:bg-gray-50"
            >
              {t('common.cancel', 'Cancel')}
            </button>
          </div>
        </form>
      </PageBody>
    </Page>
  )
}
