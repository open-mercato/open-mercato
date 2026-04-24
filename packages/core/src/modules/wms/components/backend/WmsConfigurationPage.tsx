"use client"

import * as React from 'react'
import { z } from 'zod'
import type { ColumnDef } from '@tanstack/react-table'
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { EmptyState } from '@open-mercato/ui/backend/EmptyState'
import { CrudForm, type CrudField, type CrudFieldOption } from '@open-mercato/ui/backend/CrudForm'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { raiseCrudError } from '@open-mercato/ui/backend/utils/serverErrors'
import { Button } from '@open-mercato/ui/primitives/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Boxes, Layers, MapPinned, Warehouse } from 'lucide-react'

type PagedResponse<T> = {
  items: T[]
  total: number
  totalPages: number
  page?: number
  pageSize?: number
}

type WarehouseRow = {
  id: string
  name?: string | null
  code?: string | null
  city?: string | null
  country?: string | null
  timezone?: string | null
  is_active?: boolean | null
}

type LocationRow = {
  id: string
  warehouse_id?: string | null
  code?: string | null
  type?: string | null
  capacity_units?: string | number | null
  capacity_weight?: string | number | null
  is_active?: boolean | null
}

type ZoneRow = {
  id: string
  warehouse_id?: string | null
  code?: string | null
  name?: string | null
  priority?: number | null
}

type InventoryProfileRow = {
  id: string
  catalog_product_id?: string | null
  catalog_variant_id?: string | null
  default_uom?: string | null
  default_strategy?: string | null
  track_lot?: boolean | null
  track_serial?: boolean | null
  track_expiration?: boolean | null
  reorder_point?: string | number | null
  safety_stock?: string | number | null
}

type WarehouseFormValues = {
  name: string
  code: string
  city?: string
  country?: string
  timezone?: string
  isActive: boolean
}

type LocationFormValues = {
  warehouseId: string
  code: string
  type: 'zone' | 'aisle' | 'rack' | 'bin' | 'slot' | 'dock' | 'staging'
  capacityUnits?: number
  capacityWeight?: number
  isActive: boolean
}

type ZoneFormValues = {
  warehouseId: string
  code: string
  name: string
  priority?: number
}

type InventoryProfileFormValues = {
  catalogProductId: string
  catalogVariantId?: string
  defaultUom: string
  defaultStrategy: 'fifo' | 'lifo' | 'fefo'
  trackLot: boolean
  trackSerial: boolean
  trackExpiration: boolean
  reorderPoint?: number
  safetyStock?: number
}

type DialogMode<T> =
  | { mode: 'create' }
  | { mode: 'edit'; row: T }

const warehouseFormSchema = z.object({
  name: z.string().trim().min(1),
  code: z.string().trim().min(1),
  city: z.string().trim().optional(),
  country: z.string().trim().optional(),
  timezone: z.string().trim().optional(),
  isActive: z.boolean().default(true),
})

const locationFormSchema = z.object({
  warehouseId: z.string().uuid(),
  code: z.string().trim().min(1),
  type: z.enum(['zone', 'aisle', 'rack', 'bin', 'slot', 'dock', 'staging']),
  capacityUnits: z.coerce.number().min(0).optional(),
  capacityWeight: z.coerce.number().min(0).optional(),
  isActive: z.boolean().default(true),
})

const zoneFormSchema = z.object({
  warehouseId: z.string().uuid(),
  code: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(200),
  priority: z.coerce.number().int().min(0).optional(),
})

const inventoryProfileFormSchema = z.object({
  catalogProductId: z.string().uuid(),
  catalogVariantId: z.string().uuid().optional().or(z.literal('')),
  defaultUom: z.string().trim().min(1),
  defaultStrategy: z.enum(['fifo', 'lifo', 'fefo']),
  trackLot: z.boolean().default(false),
  trackSerial: z.boolean().default(false),
  trackExpiration: z.boolean().default(false),
  reorderPoint: z.coerce.number().min(0).optional(),
  safetyStock: z.coerce.number().min(0).optional(),
}).superRefine((payload, ctx) => {
  if (payload.trackExpiration && payload.defaultStrategy !== 'fefo') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['defaultStrategy'],
      message: 'FEFO is required when expiration tracking is enabled.',
    })
  }
})

const LOCATION_TYPE_OPTIONS: CrudFieldOption[] = [
  { value: 'zone', label: 'Zone' },
  { value: 'aisle', label: 'Aisle' },
  { value: 'rack', label: 'Rack' },
  { value: 'bin', label: 'Bin' },
  { value: 'slot', label: 'Slot' },
  { value: 'dock', label: 'Dock' },
  { value: 'staging', label: 'Staging' },
]

const STRATEGY_OPTIONS: CrudFieldOption[] = [
  { value: 'fifo', label: 'FIFO' },
  { value: 'lifo', label: 'LIFO' },
  { value: 'fefo', label: 'FEFO' },
]

function buildQuery(params: Record<string, string | number | undefined>) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue
    search.set(key, String(value))
  }
  return search.toString()
}

/** Merge a newly created row into all cached warehouse list queries so the table updates immediately (refetch can lag or match stale HTTP cache). */
function mergeCreatedWarehouseIntoWarehousesCaches(
  queryClient: QueryClient,
  newId: string,
  values: WarehouseFormValues,
) {
  const row: WarehouseRow = {
    id: newId,
    name: values.name,
    code: values.code,
    city: values.city || null,
    country: values.country || null,
    timezone: values.timezone || null,
    is_active: values.isActive,
  }
  const haystack = `${values.name}\n${values.code}`.toLowerCase()

  const entries = queryClient.getQueriesData<PagedResponse<WarehouseRow>>({
    queryKey: ['wms-config', 'warehouses'],
    exact: false,
  })
  for (const [key, old] of entries) {
    if (!old || !Array.isArray(old.items)) continue
    if (old.items.some((r: WarehouseRow) => r.id === newId)) continue

    const paramStr = Array.isArray(key) && typeof key[2] === 'string' ? key[2] : ''
    const sp = new URLSearchParams(paramStr)
    const searchTerm = (sp.get('search') || '').trim().toLowerCase()
    if (searchTerm && !haystack.includes(searchTerm)) continue

    const pageSize = typeof old.pageSize === 'number' && old.pageSize > 0 ? old.pageSize : 10
    const nextTotal = (old.total ?? 0) + 1
    queryClient.setQueryData<PagedResponse<WarehouseRow>>(key, {
      ...old,
      items: [row, ...old.items.filter((r: WarehouseRow) => r.id !== newId)].slice(0, pageSize),
      total: nextTotal,
      totalPages: Math.max(1, Math.ceil(nextTotal / pageSize)),
    })
  }
}

async function loadWarehouseOptions(query?: string): Promise<CrudFieldOption[]> {
  const params = buildQuery({ page: 1, pageSize: 50, search: query?.trim() || undefined })
  const call = await apiCall<PagedResponse<{ id?: string | null; name?: string | null; code?: string | null }>>(`/api/wms/warehouses?${params}`)
  if (!call.ok) return []
  return (call.result?.items ?? [])
    .map((item) => {
      const value = typeof item.id === 'string' ? item.id : null
      if (!value) return null
      const label = item.name || item.code || value
      return { value, label }
    })
    .filter((option): option is CrudFieldOption => option !== null)
}

async function loadCatalogProductOptions(query?: string): Promise<CrudFieldOption[]> {
  const params = buildQuery({ page: 1, pageSize: 25, search: query?.trim() || undefined })
  const call = await apiCall<PagedResponse<{ id?: string | null; title?: string | null; sku?: string | null }>>(`/api/catalog/products?${params}`)
  if (!call.ok) return []
  return (call.result?.items ?? [])
    .map((item) => {
      const value = typeof item.id === 'string' ? item.id : null
      if (!value) return null
      const label = item.title || item.sku || value
      return { value, label }
    })
    .filter((option): option is CrudFieldOption => option !== null)
}

async function loadCatalogVariantOptions(query?: string): Promise<CrudFieldOption[]> {
  const params = buildQuery({ page: 1, pageSize: 25, search: query?.trim() || undefined })
  const call = await apiCall<PagedResponse<{ id?: string | null; name?: string | null; sku?: string | null }>>(`/api/catalog/variants?${params}`)
  if (!call.ok) return []
  return (call.result?.items ?? [])
    .map((item) => {
      const value = typeof item.id === 'string' ? item.id : null
      if (!value) return null
      const label = item.name || item.sku || value
      return { value, label }
    })
    .filter((option): option is CrudFieldOption => option !== null)
}

function SectionCard({
  title,
  description,
  icon,
  children,
}: {
  title: string
  description: string
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="rounded-lg border bg-card p-5 text-card-foreground shadow-sm">
      <div className="mb-4 flex items-start gap-3">
        <div className="rounded-md border bg-muted/40 p-2 text-muted-foreground">{icon}</div>
        <div className="space-y-1">
          <h2 className="text-xl font-semibold">{title}</h2>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      {children}
    </section>
  )
}

export function WarehouseSection() {
  const t = useT()
  const queryClient = useQueryClient()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const { runMutation } = useGuardedMutation<Record<string, unknown>>({ contextId: 'wms-config-warehouses' })
  const [page, setPage] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)
  const [dialog, setDialog] = React.useState<DialogMode<WarehouseRow> | null>(null)

  const params = React.useMemo(
    () => buildQuery({ page, pageSize: 10, search: search.trim() || undefined, sortField: 'updatedAt', sortDir: 'desc' }),
    [page, search],
  )

  const query = useQuery({
    queryKey: ['wms-config', 'warehouses', params],
    queryFn: async () => {
      const call = await apiCall<PagedResponse<WarehouseRow>>(`/api/wms/warehouses?${params}`, {
        cache: 'no-store',
      })
      if (!call.ok) {
        await raiseCrudError(call.response, t('wms.backend.config.warehouses.errors.load', 'Failed to load warehouses.'))
      }
      return call.result ?? { items: [], total: 0, totalPages: 1 }
    },
  })

  const fields = React.useMemo<CrudField[]>(() => [
    { id: 'name', type: 'text', label: t('wms.backend.config.warehouses.form.name', 'Name'), required: true },
    { id: 'code', type: 'text', label: t('wms.backend.config.warehouses.form.code', 'Code'), required: true },
    { id: 'city', type: 'text', label: t('wms.backend.config.warehouses.form.city', 'City') },
    { id: 'country', type: 'text', label: t('wms.backend.config.warehouses.form.country', 'Country') },
    { id: 'timezone', type: 'text', label: t('wms.backend.config.warehouses.form.timezone', 'Timezone') },
    { id: 'isActive', type: 'checkbox', label: t('wms.backend.config.warehouses.form.active', 'Active') },
  ], [t])

  const columns = React.useMemo<ColumnDef<WarehouseRow>[]>(() => [
    {
      accessorKey: 'name',
      header: t('wms.backend.config.warehouses.columns.name', 'Warehouse'),
      cell: ({ row }) => row.original.name || row.original.code || row.original.id,
    },
    { accessorKey: 'code', header: t('wms.backend.config.warehouses.columns.code', 'Code') },
    { accessorKey: 'city', header: t('wms.backend.config.warehouses.columns.city', 'City'), cell: ({ row }) => row.original.city || '—' },
    { accessorKey: 'country', header: t('wms.backend.config.warehouses.columns.country', 'Country'), cell: ({ row }) => row.original.country || '—' },
    {
      accessorKey: 'is_active',
      header: t('wms.backend.config.warehouses.columns.status', 'Status'),
      cell: ({ row }) =>
        row.original.is_active === false
          ? t('wms.common.inactive', 'Inactive')
          : t('wms.common.active', 'Active'),
    },
  ], [t])

  const initialValues = React.useMemo<WarehouseFormValues>(() => {
    if (dialog?.mode === 'edit') {
      return {
        name: dialog.row.name || '',
        code: dialog.row.code || '',
        city: dialog.row.city || '',
        country: dialog.row.country || '',
        timezone: dialog.row.timezone || '',
        isActive: dialog.row.is_active !== false,
      }
    }
    return {
      name: '',
      code: '',
      city: '',
      country: '',
      timezone: '',
      isActive: true,
    }
  }, [dialog])

  const closeDialog = React.useCallback(() => {
    setDialog(null)
    setSubmitting(false)
  }, [])

  const refresh = React.useCallback(async () => {
    await queryClient.cancelQueries({ queryKey: ['wms-config', 'warehouses'] })
    await queryClient.invalidateQueries({ queryKey: ['wms-config', 'warehouses'] })
    await queryClient.refetchQueries({ queryKey: ['wms-config', 'warehouses'], type: 'all' })
  }, [queryClient])

  const handleSubmit = React.useCallback(async (values: WarehouseFormValues) => {
    if (!dialog) return
    const submitMode = dialog.mode
    setSubmitting(true)
    try {
      const call = await runMutation({
        operation: async () => {
          const result = await apiCall<{ id?: string | null }>(
            '/api/wms/warehouses',
            {
              method: submitMode === 'edit' ? 'PUT' : 'POST',
              body: JSON.stringify(
                submitMode === 'edit'
                  ? { id: dialog.row.id, ...values }
                  : values,
              ),
            },
          )
          if (!result.ok) {
            await raiseCrudError(result.response, t('wms.backend.config.warehouses.errors.save', 'Failed to save warehouse.'))
          }
          return result
        },
        context: {},
        mutationPayload: submitMode === 'edit' ? { id: dialog.row.id, ...values } : values,
      })
      flash(
        submitMode === 'edit'
          ? t('wms.backend.config.warehouses.flash.updated', 'Warehouse updated')
          : t('wms.backend.config.warehouses.flash.created', 'Warehouse created'),
        'success',
      )

      const createdId =
        submitMode === 'create' &&
        call?.result &&
        typeof call.result === 'object' &&
        typeof (call.result as { id?: unknown }).id === 'string'
          ? (call.result as { id: string }).id.trim()
          : null

      closeDialog()

      if (submitMode === 'create' && createdId) {
        mergeCreatedWarehouseIntoWarehousesCaches(queryClient, createdId, values)
        setSearch('')
        setPage(1)
      }

      await refresh()
    } catch (error) {
      flash(error instanceof Error ? error.message : t('wms.backend.config.warehouses.errors.save', 'Failed to save warehouse.'), 'error')
      setSubmitting(false)
    }
  }, [closeDialog, dialog, queryClient, refresh, runMutation, t])

  const handleDelete = React.useCallback(async (row: WarehouseRow) => {
    const confirmed = await confirm({
      title: t('wms.backend.config.warehouses.confirmDelete', 'Archive warehouse "{name}"?', {
        name: row.name || row.code || row.id,
      }),
      variant: 'destructive',
    })
    if (!confirmed) return

    try {
      await runMutation({
        operation: async () => {
          const call = await apiCall(`/api/wms/warehouses?id=${encodeURIComponent(row.id)}`, { method: 'DELETE' })
          if (!call.ok) {
            await raiseCrudError(call.response, t('wms.backend.config.warehouses.errors.delete', 'Failed to archive warehouse.'))
          }
          return call
        },
        context: {},
        mutationPayload: { id: row.id },
      })
      flash(t('wms.backend.config.warehouses.flash.deleted', 'Warehouse archived'), 'success')
      await refresh()
    } catch (error) {
      flash(error instanceof Error ? error.message : t('wms.backend.config.warehouses.errors.delete', 'Failed to archive warehouse.'), 'error')
    }
  }, [confirm, refresh, runMutation, t])

  return (
    <>
      <SectionCard
        title={t('wms.backend.config.warehouses.title', 'Warehouses')}
        description={t('wms.backend.config.warehouses.description', 'Manage the high-level warehouse nodes used by WMS reservations and inventory movements.')}
        icon={<Warehouse className="size-5" />}
      >
        <DataTable
          embedded
          title={t('wms.backend.config.warehouses.title', 'Warehouses')}
          columns={columns}
          data={query.data?.items ?? []}
          isLoading={query.isLoading}
          error={query.isError ? t('wms.backend.config.warehouses.errors.load', 'Failed to load warehouses.') : null}
          searchValue={search}
          onSearchChange={(value) => {
            setSearch(value)
            setPage(1)
          }}
          searchPlaceholder={t('wms.backend.config.warehouses.search', 'Search warehouses')}
          actions={(
            <Button type="button" size="sm" onClick={() => setDialog({ mode: 'create' })}>
              {t('wms.backend.config.actions.addWarehouse', 'Add warehouse')}
            </Button>
          )}
          rowActions={(row) => (
            <RowActions
              items={[
                { id: 'edit', label: t('common.edit', 'Edit'), onSelect: () => setDialog({ mode: 'edit', row }) },
                { id: 'delete', label: t('common.delete', 'Delete'), destructive: true, onSelect: () => { void handleDelete(row) } },
              ]}
            />
          )}
          pagination={{
            page,
            pageSize: 10,
            total: query.data?.total ?? 0,
            totalPages: query.data?.totalPages ?? 1,
            onPageChange: setPage,
          }}
          perspective={{ tableId: 'wms.config.warehouses' }}
          emptyState={(
            <EmptyState
              title={t('wms.backend.config.warehouses.empty.title', 'No warehouses')}
              description={t('wms.backend.config.warehouses.empty.description', 'Create the first warehouse to expose topology and inventory assignment in WMS.')}
              action={{ label: t('wms.backend.config.actions.addWarehouse', 'Add warehouse'), onClick: () => setDialog({ mode: 'create' }) }}
            />
          )}
        />
      </SectionCard>

      <Dialog open={dialog !== null} onOpenChange={(next) => !next && closeDialog()}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {dialog?.mode === 'edit'
                ? t('wms.backend.config.warehouses.dialog.edit', 'Edit warehouse')
                : t('wms.backend.config.warehouses.dialog.create', 'Create warehouse')}
            </DialogTitle>
          </DialogHeader>
          <CrudForm<WarehouseFormValues>
            schema={warehouseFormSchema}
            fields={fields}
            initialValues={initialValues}
            submitLabel={t('common.save', 'Save')}
            onSubmit={handleSubmit}
            embedded
            isLoading={submitting}
            twoColumn
            extraActions={(
              <Button type="button" variant="ghost" onClick={closeDialog}>
                {t('common.cancel', 'Cancel')}
              </Button>
            )}
          />
        </DialogContent>
      </Dialog>
      {ConfirmDialogElement}
    </>
  )
}

export function ZoneSection() {
  const t = useT()
  const queryClient = useQueryClient()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const { runMutation } = useGuardedMutation<Record<string, unknown>>({ contextId: 'wms-config-zones' })
  const [page, setPage] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)
  const [dialog, setDialog] = React.useState<DialogMode<ZoneRow> | null>(null)

  const params = React.useMemo(
    () => buildQuery({ page, pageSize: 10, search: search.trim() || undefined, sortField: 'priority', sortDir: 'asc' }),
    [page, search],
  )

  const query = useQuery({
    queryKey: ['wms-config', 'zones', params],
    queryFn: async () => {
      const call = await apiCall<PagedResponse<ZoneRow>>(`/api/wms/zones?${params}`, {
        cache: 'no-store',
      })
      if (!call.ok) {
        await raiseCrudError(call.response, t('wms.backend.config.zones.errors.load', 'Failed to load zones.'))
      }
      return call.result ?? { items: [], total: 0, totalPages: 1 }
    },
  })

  const fields = React.useMemo<CrudField[]>(() => [
    {
      id: 'warehouseId',
      type: 'combobox',
      label: t('wms.backend.config.zones.form.warehouse', 'Warehouse'),
      required: true,
      loadOptions: loadWarehouseOptions,
      allowCustomValues: false,
    },
    { id: 'code', type: 'text', label: t('wms.backend.config.zones.form.code', 'Code'), required: true },
    { id: 'name', type: 'text', label: t('wms.backend.config.zones.form.name', 'Name'), required: true },
    { id: 'priority', type: 'number', label: t('wms.backend.config.zones.form.priority', 'Priority') },
  ], [t])

  const columns = React.useMemo<ColumnDef<ZoneRow>[]>(() => [
    {
      accessorKey: 'name',
      header: t('wms.backend.config.zones.columns.name', 'Zone'),
      cell: ({ row }) => row.original.name || row.original.code || row.original.id,
    },
    { accessorKey: 'code', header: t('wms.backend.config.zones.columns.code', 'Code') },
    {
      accessorKey: 'warehouse_id',
      header: t('wms.backend.config.zones.columns.warehouse', 'Warehouse'),
      cell: ({ row }) => row.original.warehouse_id || '—',
    },
    {
      accessorKey: 'priority',
      header: t('wms.backend.config.zones.columns.priority', 'Priority'),
      cell: ({ row }) => (row.original.priority == null ? '—' : String(row.original.priority)),
    },
  ], [t])

  const initialValues = React.useMemo<ZoneFormValues>(() => {
    if (dialog?.mode === 'edit') {
      return {
        warehouseId: dialog.row.warehouse_id || '',
        code: dialog.row.code || '',
        name: dialog.row.name || '',
        priority: dialog.row.priority == null ? undefined : Number(dialog.row.priority),
      }
    }
    return {
      warehouseId: '',
      code: '',
      name: '',
      priority: undefined,
    }
  }, [dialog])

  const closeDialog = React.useCallback(() => {
    setDialog(null)
    setSubmitting(false)
  }, [])

  const refresh = React.useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['wms-config', 'zones'] })
  }, [queryClient])

  const handleSubmit = React.useCallback(async (values: ZoneFormValues) => {
    if (!dialog) return
    const submitMode = dialog.mode
    setSubmitting(true)
    try {
      const payload = {
        ...values,
        priority: values.priority === undefined || Number.isNaN(values.priority) ? undefined : Number(values.priority),
      }
      await runMutation({
        operation: async () => {
          const call = await apiCall(
            '/api/wms/zones',
            {
              method: submitMode === 'edit' ? 'PUT' : 'POST',
              body: JSON.stringify(submitMode === 'edit' ? { id: dialog.row.id, ...payload } : payload),
            },
          )
          if (!call.ok) {
            await raiseCrudError(call.response, t('wms.backend.config.zones.errors.save', 'Failed to save zone.'))
          }
          return call
        },
        context: {},
        mutationPayload: submitMode === 'edit' ? { id: dialog.row.id, ...payload } : payload,
      })
      flash(
        submitMode === 'edit'
          ? t('wms.backend.config.zones.flash.updated', 'Zone updated')
          : t('wms.backend.config.zones.flash.created', 'Zone created'),
        'success',
      )
      closeDialog()
      await refresh()
    } catch (error) {
      flash(error instanceof Error ? error.message : t('wms.backend.config.zones.errors.save', 'Failed to save zone.'), 'error')
      setSubmitting(false)
    }
  }, [closeDialog, dialog, refresh, runMutation, t])

  const handleDelete = React.useCallback(async (row: ZoneRow) => {
    const confirmed = await confirm({
      title: t('wms.backend.config.zones.confirmDelete', 'Archive zone "{name}"?', {
        name: row.name || row.code || row.id,
      }),
      variant: 'destructive',
    })
    if (!confirmed) return

    try {
      await runMutation({
        operation: async () => {
          const call = await apiCall(`/api/wms/zones?id=${encodeURIComponent(row.id)}`, { method: 'DELETE' })
          if (!call.ok) {
            await raiseCrudError(call.response, t('wms.backend.config.zones.errors.delete', 'Failed to archive zone.'))
          }
          return call
        },
        context: {},
        mutationPayload: { id: row.id },
      })
      flash(t('wms.backend.config.zones.flash.deleted', 'Zone archived'), 'success')
      await refresh()
    } catch (error) {
      flash(error instanceof Error ? error.message : t('wms.backend.config.zones.errors.delete', 'Failed to archive zone.'), 'error')
    }
  }, [confirm, refresh, runMutation, t])

  return (
    <>
      <SectionCard
        title={t('wms.backend.config.zones.title', 'Zones')}
        description={t('wms.backend.config.zones.description', 'Group locations into functional zones (e.g. receiving, pick face, bulk) to drive routing and priority.')}
        icon={<Layers className="size-5" />}
      >
        <DataTable
          embedded
          title={t('wms.backend.config.zones.title', 'Zones')}
          columns={columns}
          data={query.data?.items ?? []}
          isLoading={query.isLoading}
          error={query.isError ? t('wms.backend.config.zones.errors.load', 'Failed to load zones.') : null}
          searchValue={search}
          onSearchChange={(value) => {
            setSearch(value)
            setPage(1)
          }}
          searchPlaceholder={t('wms.backend.config.zones.search', 'Search zones')}
          actions={(
            <Button type="button" size="sm" onClick={() => setDialog({ mode: 'create' })}>
              {t('wms.backend.config.actions.addZone', 'Add zone')}
            </Button>
          )}
          rowActions={(row) => (
            <RowActions
              items={[
                { id: 'edit', label: t('common.edit', 'Edit'), onSelect: () => setDialog({ mode: 'edit', row }) },
                { id: 'delete', label: t('common.delete', 'Delete'), destructive: true, onSelect: () => { void handleDelete(row) } },
              ]}
            />
          )}
          pagination={{
            page,
            pageSize: 10,
            total: query.data?.total ?? 0,
            totalPages: query.data?.totalPages ?? 1,
            onPageChange: setPage,
          }}
          perspective={{ tableId: 'wms.config.zones' }}
          emptyState={(
            <EmptyState
              title={t('wms.backend.config.zones.empty.title', 'No zones')}
              description={t('wms.backend.config.zones.empty.description', 'Zones group locations into functional areas to drive picking priority and routing rules.')}
              action={{ label: t('wms.backend.config.actions.addZone', 'Add zone'), onClick: () => setDialog({ mode: 'create' }) }}
            />
          )}
        />
      </SectionCard>

      <Dialog open={dialog !== null} onOpenChange={(next) => !next && closeDialog()}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {dialog?.mode === 'edit'
                ? t('wms.backend.config.zones.dialog.edit', 'Edit zone')
                : t('wms.backend.config.zones.dialog.create', 'Create zone')}
            </DialogTitle>
          </DialogHeader>
          <CrudForm<ZoneFormValues>
            schema={zoneFormSchema}
            fields={fields}
            initialValues={initialValues}
            submitLabel={t('common.save', 'Save')}
            onSubmit={handleSubmit}
            embedded
            isLoading={submitting}
            twoColumn
            extraActions={(
              <Button type="button" variant="ghost" onClick={closeDialog}>
                {t('common.cancel', 'Cancel')}
              </Button>
            )}
          />
        </DialogContent>
      </Dialog>
      {ConfirmDialogElement}
    </>
  )
}

export function LocationSection() {
  const t = useT()
  const queryClient = useQueryClient()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const { runMutation } = useGuardedMutation<Record<string, unknown>>({ contextId: 'wms-config-locations' })
  const [page, setPage] = React.useState(1)
  const [search, setSearch] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)
  const [dialog, setDialog] = React.useState<DialogMode<LocationRow> | null>(null)

  const params = React.useMemo(
    () => buildQuery({ page, pageSize: 10, search: search.trim() || undefined, sortField: 'updatedAt', sortDir: 'desc' }),
    [page, search],
  )

  const query = useQuery({
    queryKey: ['wms-config', 'locations', params],
    queryFn: async () => {
      const call = await apiCall<PagedResponse<LocationRow>>(`/api/wms/locations?${params}`)
      if (!call.ok) {
        await raiseCrudError(call.response, t('wms.backend.config.locations.errors.load', 'Failed to load locations.'))
      }
      return call.result ?? { items: [], total: 0, totalPages: 1 }
    },
  })

  const fields = React.useMemo<CrudField[]>(() => [
    {
      id: 'warehouseId',
      type: 'combobox',
      label: t('wms.backend.config.locations.form.warehouse', 'Warehouse'),
      required: true,
      loadOptions: loadWarehouseOptions,
      allowCustomValues: false,
    },
    { id: 'code', type: 'text', label: t('wms.backend.config.locations.form.code', 'Code'), required: true },
    {
      id: 'type',
      type: 'select',
      label: t('wms.backend.config.locations.form.type', 'Type'),
      required: true,
      options: LOCATION_TYPE_OPTIONS,
    },
    { id: 'capacityUnits', type: 'number', label: t('wms.backend.config.locations.form.capacityUnits', 'Capacity units') },
    { id: 'capacityWeight', type: 'number', label: t('wms.backend.config.locations.form.capacityWeight', 'Capacity weight') },
    { id: 'isActive', type: 'checkbox', label: t('wms.backend.config.locations.form.active', 'Active') },
  ], [t])

  const columns = React.useMemo<ColumnDef<LocationRow>[]>(() => [
    { accessorKey: 'code', header: t('wms.backend.config.locations.columns.code', 'Location') },
    { accessorKey: 'type', header: t('wms.backend.config.locations.columns.type', 'Type'), cell: ({ row }) => row.original.type || '—' },
    { accessorKey: 'warehouse_id', header: t('wms.backend.config.locations.columns.warehouse', 'Warehouse'), cell: ({ row }) => row.original.warehouse_id || '—' },
    { accessorKey: 'capacity_units', header: t('wms.backend.config.locations.columns.capacityUnits', 'Capacity units'), cell: ({ row }) => String(row.original.capacity_units ?? '—') },
    {
      accessorKey: 'is_active',
      header: t('wms.backend.config.locations.columns.status', 'Status'),
      cell: ({ row }) =>
        row.original.is_active === false
          ? t('wms.common.inactive', 'Inactive')
          : t('wms.common.active', 'Active'),
    },
  ], [t])

  const initialValues = React.useMemo<LocationFormValues>(() => {
    if (dialog?.mode === 'edit') {
      return {
        warehouseId: dialog.row.warehouse_id || '',
        code: dialog.row.code || '',
        type: (dialog.row.type as LocationFormValues['type']) || 'bin',
        capacityUnits: dialog.row.capacity_units == null ? undefined : Number(dialog.row.capacity_units),
        capacityWeight: dialog.row.capacity_weight == null ? undefined : Number(dialog.row.capacity_weight),
        isActive: dialog.row.is_active !== false,
      }
    }
    return {
      warehouseId: '',
      code: '',
      type: 'bin',
      capacityUnits: undefined,
      capacityWeight: undefined,
      isActive: true,
    }
  }, [dialog])

  const closeDialog = React.useCallback(() => {
    setDialog(null)
    setSubmitting(false)
  }, [])

  const refresh = React.useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['wms-config', 'locations'] })
  }, [queryClient])

  const handleSubmit = React.useCallback(async (values: LocationFormValues) => {
    setSubmitting(true)
    try {
      await runMutation({
        operation: async () => {
          const call = await apiCall(
            '/api/wms/locations',
            {
              method: dialog?.mode === 'edit' ? 'PUT' : 'POST',
              body: JSON.stringify(dialog?.mode === 'edit' ? { id: dialog.row.id, ...values } : values),
            },
          )
          if (!call.ok) {
            await raiseCrudError(call.response, t('wms.backend.config.locations.errors.save', 'Failed to save location.'))
          }
          return call
        },
        context: {},
        mutationPayload: dialog?.mode === 'edit' ? { id: dialog.row.id, ...values } : values,
      })
      flash(
        dialog?.mode === 'edit'
          ? t('wms.backend.config.locations.flash.updated', 'Location updated')
          : t('wms.backend.config.locations.flash.created', 'Location created'),
        'success',
      )
      closeDialog()
      await refresh()
    } catch (error) {
      flash(error instanceof Error ? error.message : t('wms.backend.config.locations.errors.save', 'Failed to save location.'), 'error')
      setSubmitting(false)
    }
  }, [closeDialog, dialog, refresh, runMutation, t])

  const handleDelete = React.useCallback(async (row: LocationRow) => {
    const confirmed = await confirm({
      title: t('wms.backend.config.locations.confirmDelete', 'Archive location "{code}"?', {
        code: row.code || row.id,
      }),
      variant: 'destructive',
    })
    if (!confirmed) return

    try {
      await runMutation({
        operation: async () => {
          const call = await apiCall(`/api/wms/locations?id=${encodeURIComponent(row.id)}`, { method: 'DELETE' })
          if (!call.ok) {
            await raiseCrudError(call.response, t('wms.backend.config.locations.errors.delete', 'Failed to archive location.'))
          }
          return call
        },
        context: {},
        mutationPayload: { id: row.id },
      })
      flash(t('wms.backend.config.locations.flash.deleted', 'Location archived'), 'success')
      await refresh()
    } catch (error) {
      flash(error instanceof Error ? error.message : t('wms.backend.config.locations.errors.delete', 'Failed to archive location.'), 'error')
    }
  }, [confirm, refresh, runMutation, t])

  return (
    <>
      <SectionCard
        title={t('wms.backend.config.locations.title', 'Locations')}
        description={t('wms.backend.config.locations.description', 'Maintain aisle/bin/dock level topology buckets that hold operational inventory.')}
        icon={<MapPinned className="size-5" />}
      >
        <DataTable
          embedded
          title={t('wms.backend.config.locations.title', 'Locations')}
          columns={columns}
          data={query.data?.items ?? []}
          isLoading={query.isLoading}
          error={query.isError ? t('wms.backend.config.locations.errors.load', 'Failed to load locations.') : null}
          searchValue={search}
          onSearchChange={(value) => {
            setSearch(value)
            setPage(1)
          }}
          searchPlaceholder={t('wms.backend.config.locations.search', 'Search locations')}
          actions={(
            <Button type="button" size="sm" onClick={() => setDialog({ mode: 'create' })}>
              {t('wms.backend.config.actions.addLocation', 'Add location')}
            </Button>
          )}
          rowActions={(row) => (
            <RowActions
              items={[
                { id: 'edit', label: t('common.edit', 'Edit'), onSelect: () => setDialog({ mode: 'edit', row }) },
                { id: 'delete', label: t('common.delete', 'Delete'), destructive: true, onSelect: () => { void handleDelete(row) } },
              ]}
            />
          )}
          pagination={{
            page,
            pageSize: 10,
            total: query.data?.total ?? 0,
            totalPages: query.data?.totalPages ?? 1,
            onPageChange: setPage,
          }}
          perspective={{ tableId: 'wms.config.locations' }}
          emptyState={(
            <EmptyState
              title={t('wms.backend.config.locations.empty.title', 'No locations')}
              description={t('wms.backend.config.locations.empty.description', 'Create locations to define the buckets used by balances, reservations, and movement ledger rows.')}
              action={{ label: t('wms.backend.config.actions.addLocation', 'Add location'), onClick: () => setDialog({ mode: 'create' }) }}
            />
          )}
        />
      </SectionCard>

      <Dialog open={dialog !== null} onOpenChange={(next) => !next && closeDialog()}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {dialog?.mode === 'edit'
                ? t('wms.backend.config.locations.dialog.edit', 'Edit location')
                : t('wms.backend.config.locations.dialog.create', 'Create location')}
            </DialogTitle>
          </DialogHeader>
          <CrudForm<LocationFormValues>
            schema={locationFormSchema}
            fields={fields}
            initialValues={initialValues}
            submitLabel={t('common.save', 'Save')}
            onSubmit={handleSubmit}
            embedded
            isLoading={submitting}
            twoColumn
            extraActions={(
              <Button type="button" variant="ghost" onClick={closeDialog}>
                {t('common.cancel', 'Cancel')}
              </Button>
            )}
          />
        </DialogContent>
      </Dialog>
      {ConfirmDialogElement}
    </>
  )
}

export function InventoryProfilesSection() {
  const t = useT()
  const queryClient = useQueryClient()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const { runMutation } = useGuardedMutation<Record<string, unknown>>({ contextId: 'wms-config-profiles' })
  const [page, setPage] = React.useState(1)
  const [submitting, setSubmitting] = React.useState(false)
  const [dialog, setDialog] = React.useState<DialogMode<InventoryProfileRow> | null>(null)

  const params = React.useMemo(
    () => buildQuery({ page, pageSize: 10, sortField: 'updatedAt', sortDir: 'desc' }),
    [page],
  )

  const query = useQuery({
    queryKey: ['wms-config', 'inventory-profiles', params],
    queryFn: async () => {
      const call = await apiCall<PagedResponse<InventoryProfileRow>>(`/api/wms/inventory-profiles?${params}`)
      if (!call.ok) {
        await raiseCrudError(call.response, t('wms.backend.config.profiles.errors.load', 'Failed to load inventory profiles.'))
      }
      return call.result ?? { items: [], total: 0, totalPages: 1 }
    },
  })

  const fields = React.useMemo<CrudField[]>(() => [
    {
      id: 'catalogProductId',
      type: 'combobox',
      label: t('wms.backend.config.profiles.form.product', 'Product'),
      required: true,
      loadOptions: loadCatalogProductOptions,
      allowCustomValues: false,
    },
    {
      id: 'catalogVariantId',
      type: 'combobox',
      label: t('wms.backend.config.profiles.form.variant', 'Variant'),
      loadOptions: loadCatalogVariantOptions,
      allowCustomValues: false,
    },
    { id: 'defaultUom', type: 'text', label: t('wms.backend.config.profiles.form.uom', 'Default UOM'), required: true },
    {
      id: 'defaultStrategy',
      type: 'select',
      label: t('wms.backend.config.profiles.form.strategy', 'Rotation strategy'),
      required: true,
      options: STRATEGY_OPTIONS,
    },
    { id: 'reorderPoint', type: 'number', label: t('wms.backend.config.profiles.form.reorderPoint', 'Reorder point') },
    { id: 'safetyStock', type: 'number', label: t('wms.backend.config.profiles.form.safetyStock', 'Safety stock') },
    { id: 'trackLot', type: 'checkbox', label: t('wms.backend.config.profiles.form.trackLot', 'Track lots') },
    { id: 'trackSerial', type: 'checkbox', label: t('wms.backend.config.profiles.form.trackSerial', 'Track serials') },
    { id: 'trackExpiration', type: 'checkbox', label: t('wms.backend.config.profiles.form.trackExpiration', 'Track expiration') },
  ], [t])

  const columns = React.useMemo<ColumnDef<InventoryProfileRow>[]>(() => [
    { accessorKey: 'catalog_product_id', header: t('wms.backend.config.profiles.columns.product', 'Product'), cell: ({ row }) => row.original.catalog_product_id || '—' },
    { accessorKey: 'catalog_variant_id', header: t('wms.backend.config.profiles.columns.variant', 'Variant'), cell: ({ row }) => row.original.catalog_variant_id || '—' },
    { accessorKey: 'default_uom', header: t('wms.backend.config.profiles.columns.uom', 'UOM'), cell: ({ row }) => row.original.default_uom || '—' },
    { accessorKey: 'default_strategy', header: t('wms.backend.config.profiles.columns.strategy', 'Strategy'), cell: ({ row }) => row.original.default_strategy || '—' },
    { accessorKey: 'reorder_point', header: t('wms.backend.config.profiles.columns.reorderPoint', 'Reorder point'), cell: ({ row }) => String(row.original.reorder_point ?? 0) },
    { accessorKey: 'safety_stock', header: t('wms.backend.config.profiles.columns.safetyStock', 'Safety stock'), cell: ({ row }) => String(row.original.safety_stock ?? 0) },
  ], [t])

  const initialValues = React.useMemo<InventoryProfileFormValues>(() => {
    if (dialog?.mode === 'edit') {
      return {
        catalogProductId: dialog.row.catalog_product_id || '',
        catalogVariantId: dialog.row.catalog_variant_id || '',
        defaultUom: dialog.row.default_uom || '',
        defaultStrategy: (dialog.row.default_strategy as InventoryProfileFormValues['defaultStrategy']) || 'fifo',
        trackLot: dialog.row.track_lot === true,
        trackSerial: dialog.row.track_serial === true,
        trackExpiration: dialog.row.track_expiration === true,
        reorderPoint: dialog.row.reorder_point == null ? undefined : Number(dialog.row.reorder_point),
        safetyStock: dialog.row.safety_stock == null ? undefined : Number(dialog.row.safety_stock),
      }
    }
    return {
      catalogProductId: '',
      catalogVariantId: '',
      defaultUom: 'pcs',
      defaultStrategy: 'fifo',
      trackLot: false,
      trackSerial: false,
      trackExpiration: false,
      reorderPoint: 0,
      safetyStock: 0,
    }
  }, [dialog])

  const closeDialog = React.useCallback(() => {
    setDialog(null)
    setSubmitting(false)
  }, [])

  const refresh = React.useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['wms-config', 'inventory-profiles'] })
  }, [queryClient])

  const handleSubmit = React.useCallback(async (values: InventoryProfileFormValues) => {
    setSubmitting(true)
    try {
      const payload = {
        ...values,
        catalogVariantId: values.catalogVariantId?.trim() ? values.catalogVariantId : null,
      }
      await runMutation({
        operation: async () => {
          const call = await apiCall(
            '/api/wms/inventory-profiles',
            {
              method: dialog?.mode === 'edit' ? 'PUT' : 'POST',
              body: JSON.stringify(dialog?.mode === 'edit' ? { id: dialog.row.id, ...payload } : payload),
            },
          )
          if (!call.ok) {
            await raiseCrudError(call.response, t('wms.backend.config.profiles.errors.save', 'Failed to save inventory profile.'))
          }
          return call
        },
        context: {},
        mutationPayload: dialog?.mode === 'edit' ? { id: dialog.row.id, ...payload } : payload,
      })
      flash(
        dialog?.mode === 'edit'
          ? t('wms.backend.config.profiles.flash.updated', 'Inventory profile updated')
          : t('wms.backend.config.profiles.flash.created', 'Inventory profile created'),
        'success',
      )
      closeDialog()
      await refresh()
    } catch (error) {
      flash(error instanceof Error ? error.message : t('wms.backend.config.profiles.errors.save', 'Failed to save inventory profile.'), 'error')
      setSubmitting(false)
    }
  }, [closeDialog, dialog, refresh, runMutation, t])

  const handleDelete = React.useCallback(async (row: InventoryProfileRow) => {
    const confirmed = await confirm({
      title: t('wms.backend.config.profiles.confirmDelete', 'Archive inventory profile "{id}"?', {
        id: row.id,
      }),
      variant: 'destructive',
    })
    if (!confirmed) return

    try {
      await runMutation({
        operation: async () => {
          const call = await apiCall(`/api/wms/inventory-profiles?id=${encodeURIComponent(row.id)}`, { method: 'DELETE' })
          if (!call.ok) {
            await raiseCrudError(call.response, t('wms.backend.config.profiles.errors.delete', 'Failed to archive inventory profile.'))
          }
          return call
        },
        context: {},
        mutationPayload: { id: row.id },
      })
      flash(t('wms.backend.config.profiles.flash.deleted', 'Inventory profile archived'), 'success')
      await refresh()
    } catch (error) {
      flash(error instanceof Error ? error.message : t('wms.backend.config.profiles.errors.delete', 'Failed to archive inventory profile.'), 'error')
    }
  }, [confirm, refresh, runMutation, t])

  return (
    <>
      <SectionCard
        title={t('wms.backend.config.profiles.title', 'Inventory profiles')}
        description={t('wms.backend.config.profiles.description', 'Configure tracking strategy, reorder thresholds, and lot/serial behavior per product scope.')}
        icon={<Boxes className="size-5" />}
      >
        <DataTable
          embedded
          title={t('wms.backend.config.profiles.title', 'Inventory profiles')}
          columns={columns}
          data={query.data?.items ?? []}
          isLoading={query.isLoading}
          error={query.isError ? t('wms.backend.config.profiles.errors.load', 'Failed to load inventory profiles.') : null}
          actions={(
            <Button type="button" size="sm" onClick={() => setDialog({ mode: 'create' })}>
              {t('wms.backend.config.actions.addProfile', 'Add profile')}
            </Button>
          )}
          rowActions={(row) => (
            <RowActions
              items={[
                { id: 'edit', label: t('common.edit', 'Edit'), onSelect: () => setDialog({ mode: 'edit', row }) },
                { id: 'delete', label: t('common.delete', 'Delete'), destructive: true, onSelect: () => { void handleDelete(row) } },
              ]}
            />
          )}
          pagination={{
            page,
            pageSize: 10,
            total: query.data?.total ?? 0,
            totalPages: query.data?.totalPages ?? 1,
            onPageChange: setPage,
          }}
          perspective={{ tableId: 'wms.config.inventoryProfiles' }}
          emptyState={(
            <EmptyState
              title={t('wms.backend.config.profiles.empty.title', 'No inventory profiles')}
              description={t('wms.backend.config.profiles.empty.description', 'Create profiles to control reservation strategy, lot/serial tracking, and low-stock thresholds.')}
              action={{ label: t('wms.backend.config.actions.addProfile', 'Add profile'), onClick: () => setDialog({ mode: 'create' }) }}
            />
          )}
        />
      </SectionCard>

      <Dialog open={dialog !== null} onOpenChange={(next) => !next && closeDialog()}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {dialog?.mode === 'edit'
                ? t('wms.backend.config.profiles.dialog.edit', 'Edit inventory profile')
                : t('wms.backend.config.profiles.dialog.create', 'Create inventory profile')}
            </DialogTitle>
          </DialogHeader>
          <CrudForm<InventoryProfileFormValues>
            schema={inventoryProfileFormSchema}
            fields={fields}
            initialValues={initialValues}
            submitLabel={t('common.save', 'Save')}
            onSubmit={handleSubmit}
            embedded
            isLoading={submitting}
            twoColumn
            extraActions={(
              <Button type="button" variant="ghost" onClick={closeDialog}>
                {t('common.cancel', 'Cancel')}
              </Button>
            )}
          />
        </DialogContent>
      </Dialog>
      {ConfirmDialogElement}
    </>
  )
}

export default function WmsConfigurationPage() {
  const t = useT()

  return (
    <Page>
      <PageBody>
        <div className="space-y-6">
          <section className="rounded-lg border bg-card p-5 text-card-foreground shadow-sm">
            <div className="space-y-1">
              <h1 className="text-2xl font-bold tracking-tight">{t('wms.backend.config.title', 'WMS configuration')}</h1>
              <p className="text-sm text-muted-foreground">
                {t('wms.backend.config.description', 'Phase-1 operational configuration for warehouses, storage locations, and inventory tracking policies.')}
              </p>
            </div>
          </section>
          <WarehouseSection />
          <ZoneSection />
          <LocationSection />
          <InventoryProfilesSection />
        </div>
      </PageBody>
    </Page>
  )
}
