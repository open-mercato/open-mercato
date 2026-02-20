"use client"

import * as React from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Page, PageHeader, PageBody } from '@open-mercato/ui/backend/Page'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { createCrud, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'

const LOCATION_TYPES = ['zone', 'aisle', 'rack', 'bin', 'slot', 'dock', 'staging'] as const

type LocationData = {
  id: string
  warehouseId: string
  code: string
  type: string
  parentId: string | null
  isActive: boolean
  capacityUnits: number | null
  capacityWeight: number | null
  constraints: Record<string, unknown> | null
}

type WarehouseOption = { id: string; name: string; code: string }
type LocationCreateResult = { id?: string | null }

export default function WmsLocationDetailPage() {
  const params = useParams()
  const router = useRouter()
  const t = useT()
  const id = params?.id as string
  const isNew = id === 'new'

  const [isLoading, setIsLoading] = React.useState(!isNew)
  const [isSaving, setIsSaving] = React.useState(false)
  const [warehouses, setWarehouses] = React.useState<WarehouseOption[]>([])
  const [warehouseId, setWarehouseId] = React.useState('')
  const [code, setCode] = React.useState('')
  const [type, setType] = React.useState<string>('bin')
  const [parentId, setParentId] = React.useState('')
  const [isActive, setIsActive] = React.useState(true)
  const [capacityUnits, setCapacityUnits] = React.useState('')
  const [capacityWeight, setCapacityWeight] = React.useState('')

  React.useEffect(() => {
    async function loadWarehouses() {
      try {
        const call = await apiCall<{ items: Array<Record<string, unknown>> }>(
          '/api/wms/warehouses?pageSize=100',
          undefined,
          { fallback: { items: [] } }
        )
        if (call.ok && call.result) {
          setWarehouses(
            (call.result.items ?? []).map((w) => ({
              id: typeof w.id === 'string' ? w.id : '',
              name: typeof w.name === 'string' ? w.name : '',
              code: typeof w.code === 'string' ? w.code : '',
            }))
          )
        }
      } catch { /* ignore */ }
    }
    loadWarehouses()
  }, [])

  React.useEffect(() => {
    if (isNew) return
    let cancelled = false
    async function load() {
      setIsLoading(true)
      try {
        const call = await apiCall<LocationData>(`/api/wms/locations/${id}`)
        if (!cancelled && call.ok && call.result) {
          const d = call.result
          setWarehouseId(d.warehouseId ?? '')
          setCode(d.code ?? '')
          setType(d.type ?? 'bin')
          setParentId(d.parentId ?? '')
          setIsActive(d.isActive ?? true)
          setCapacityUnits(d.capacityUnits != null ? String(d.capacityUnits) : '')
          setCapacityWeight(d.capacityWeight != null ? String(d.capacityWeight) : '')
        }
      } catch {
        if (!cancelled) flash(t('wms.locations.detail.error.load', 'Failed to load location.'), 'error')
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

    const payload: Record<string, unknown> = {
      warehouse_id: warehouseId,
      code,
      type,
      parent_id: parentId || null,
      is_active: isActive,
      capacity_units: capacityUnits ? Number(capacityUnits) : null,
      capacity_weight: capacityWeight ? Number(capacityWeight) : null,
    }

    try {
      if (isNew) {
        const result = await createCrud<LocationCreateResult>('wms/locations', payload)
        flash(t('wms.locations.detail.created', 'Location created.'), 'success')
        const newId = result?.id
        if (newId) {
          router.push(`/backend/wms/locations/${newId}`)
        } else {
          router.push('/backend/wms/locations')
        }
      } else {
        await updateCrud('wms/locations', { ...payload, id })
        flash(t('wms.locations.detail.updated', 'Location updated.'), 'success')
      }
    } catch {
      flash(t('wms.locations.detail.error.save', 'Failed to save location.'), 'error')
    } finally {
      setIsSaving(false)
    }
  }, [isNew, id, warehouseId, code, type, parentId, isActive, capacityUnits, capacityWeight, router, t])

  if (isLoading) {
    return (
      <Page>
        <PageHeader title={t('wms.locations.detail.loading', 'Loading…')} />
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
          ? t('wms.locations.detail.title.new', 'New Location')
          : t('wms.locations.detail.title.edit', 'Edit Location')
        }
      />
      <PageBody>
        <form onSubmit={handleSubmit} className="max-w-2xl space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium">{t('wms.locations.detail.warehouse', 'Warehouse')}</label>
              <select
                className="w-full rounded border px-3 py-2"
                value={warehouseId}
                onChange={(e) => setWarehouseId(e.target.value)}
                required
              >
                <option value="">{t('wms.locations.detail.selectWarehouse', 'Select warehouse…')}</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>{w.name} ({w.code})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">{t('wms.locations.detail.code', 'Code')}</label>
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
              <label className="mb-1 block text-sm font-medium">{t('wms.locations.detail.type', 'Type')}</label>
              <select
                className="w-full rounded border px-3 py-2"
                value={type}
                onChange={(e) => setType(e.target.value)}
                required
              >
                {LOCATION_TYPES.map((lt) => (
                  <option key={lt} value={lt}>{lt}</option>
                ))}
              </select>
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                />
                <span className="text-sm font-medium">{t('wms.locations.detail.isActive', 'Active')}</span>
              </label>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium">{t('wms.locations.detail.capacityUnits', 'Capacity (units)')}</label>
              <input
                type="number"
                className="w-full rounded border px-3 py-2"
                value={capacityUnits}
                onChange={(e) => setCapacityUnits(e.target.value)}
                step="any"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">{t('wms.locations.detail.capacityWeight', 'Capacity (weight)')}</label>
              <input
                type="number"
                className="w-full rounded border px-3 py-2"
                value={capacityWeight}
                onChange={(e) => setCapacityWeight(e.target.value)}
                step="any"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium">{t('wms.locations.detail.parentId', 'Parent location ID')}</label>
            <input
              type="text"
              className="w-full rounded border px-3 py-2"
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
              placeholder={t('wms.locations.detail.parentIdPlaceholder', 'UUID of parent location (optional)')}
            />
          </div>

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
              onClick={() => router.push('/backend/wms/locations')}
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
