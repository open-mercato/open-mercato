"use client"

import * as React from 'react'
import Link from 'next/link'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Play, Plus, ArrowLeft, RefreshCw, Layers, ExternalLink, Package, Building2 } from 'lucide-react'

type RuleRow = {
  id: string
  productId: string
  warehouseId?: string | null
  minQuantity: string
  maxQuantity: string
  quantityMultiple: string
  preferredVendorId?: string | null
  isActive: boolean
  inboundStock?: number
  virtualStock?: number
  isBelowMin?: boolean
  suggestedOrderQty?: number
  createdAt: string
  updatedAt: string
}

type CatalogProductItem = {
  id: string
  title: string
  sku?: string | null
}

type VendorItem = {
  id: string
  name: string
  code?: string | null
}

type WarehouseItem = {
  id: string
  name: string
  code: string
}

type ListResponse = {
  items: RuleRow[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

type ReplenishResponse = {
  evaluatedCount: number
  triggeredCount: number
  ordersCreated: number
  ordersUpdated: number
  items: Array<{
    ruleId: string
    productId: string
    quantityToOrder: number
    orderNumber: string
    action: string
  }>
}

export default function ReorderingRulesPage() {
  const [data, setData] = React.useState<RuleRow[]>([])
  const [loading, setLoading] = React.useState(true)
  const [running, setRunning] = React.useState(false)
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(20)
  const [total, setTotal] = React.useState(0)

  // Catalog products and vendors state
  const [products, setProducts] = React.useState<CatalogProductItem[]>([])
  const [loadingProducts, setLoadingProducts] = React.useState(true)
  const [vendors, setVendors] = React.useState<VendorItem[]>([])
  const [loadingVendors, setLoadingVendors] = React.useState(true)
  const [warehouses, setWarehouses] = React.useState<WarehouseItem[]>([])
  const [loadingWarehouses, setLoadingWarehouses] = React.useState(true)

  // Creation form state
  const [showCreate, setShowCreate] = React.useState(false)
  const [productId, setProductId] = React.useState('')
  const [warehouseId, setWarehouseId] = React.useState('')
  const [minQty, setMinQty] = React.useState('10')
  const [maxQty, setMaxQty] = React.useState('50')
  const [multiple, setMultiple] = React.useState('1')
  const [vendorId, setVendorId] = React.useState('')
  const [saving, setSaving] = React.useState(false)

  // Maps for fast display lookup
  const productsMap = React.useMemo(() => {
    const map = new Map<string, CatalogProductItem>()
    for (const p of products) map.set(p.id, p)
    return map
  }, [products])

  const vendorsMap = React.useMemo(() => {
    const map = new Map<string, VendorItem>()
    for (const v of vendors) map.set(v.id, v)
    return map
  }, [vendors])

  const warehousesMap = React.useMemo(() => {
    const map = new Map<string, WarehouseItem>()
    for (const w of warehouses) map.set(w.id, w)
    return map
  }, [warehouses])

  const loadData = React.useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiCall<ListResponse>(
        `/api/purchases/reordering-rules?page=${page}&pageSize=${pageSize}`
      )
      if (res.ok && res.result) {
        setData(res.result.items)
        setTotal(res.result.total)
      } else {
        flash('Failed to load rules', 'error')
      }
    } catch {
      flash('Error loading rules', 'error')
    } finally {
      setLoading(false)
    }
  }, [page, pageSize])

  React.useEffect(() => {
    loadData()
  }, [loadData])

  // Fetch catalog products
  React.useEffect(() => {
    let active = true
    async function fetchProducts() {
      try {
        const res = await apiCall<{ items: CatalogProductItem[] }>('/api/catalog/products?pageSize=100')
        if (active && res.ok && res.result?.items) {
          setProducts(res.result.items)
          if (res.result.items.length > 0 && !productId) {
            setProductId(res.result.items[0].id)
          }
        }
      } catch {
        // Silently continue
      } finally {
        if (active) setLoadingProducts(false)
      }
    }
    fetchProducts()
    return () => {
      active = false
    }
  }, [])

  // Fetch vendors
  React.useEffect(() => {
    let active = true
    async function fetchVendors() {
      try {
        const res = await apiCall<{ items: VendorItem[] }>('/api/purchases/vendors?pageSize=100')
        if (active && res.ok && res.result?.items) {
          setVendors(res.result.items)
        }
      } catch {
        // Silently continue
      } finally {
        if (active) setLoadingVendors(false)
      }
    }
    fetchVendors()
    return () => {
      active = false
    }
  }, [])

  // Fetch warehouses
  React.useEffect(() => {
    let active = true
    async function fetchWarehouses() {
      try {
        const res = await apiCall<{ items: WarehouseItem[] }>('/api/wms/warehouses?pageSize=100')
        if (active && res.ok && res.result?.items) {
          setWarehouses(res.result.items)
        }
      } catch {
        // Silently continue
      } finally {
        if (active) setLoadingWarehouses(false)
      }
    }
    fetchWarehouses()
    return () => {
      active = false
    }
  }, [])

  const handleRunReplenishment = async () => {
    setRunning(true)
    try {
      const res = await apiCall<ReplenishResponse>(
        '/api/purchases/reordering-rules/run',
        { method: 'POST', body: JSON.stringify({}) }
      )
      if (res.ok && res.result) {
        const r = res.result
        flash(
          `Replenishment run complete: ${r.triggeredCount} triggered, ${r.ordersCreated} orders created, ${r.ordersUpdated} updated`,
          'success'
        )
        loadData()
      } else {
        flash('Replenishment evaluation failed', 'error')
      }
    } catch {
      flash('Error running replenishment engine', 'error')
    } finally {
      setRunning(false)
    }
  }

  const handleCreateRule = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!productId) {
      flash('Please select a catalog product', 'error')
      return
    }

    setSaving(true)
    try {
      const res = await apiCall('/api/purchases/reordering-rules', {
        method: 'POST',
        body: JSON.stringify({
          productId: productId.trim(),
          warehouseId: warehouseId.trim() || undefined,
          minQuantity: parseFloat(minQty),
          maxQuantity: parseFloat(maxQty),
          quantityMultiple: parseFloat(multiple) || 1,
          preferredVendorId: vendorId.trim() || undefined,
          isActive: true,
        }),
      })

      if (res.ok) {
        flash('Reordering rule registered', 'success')
        setShowCreate(false)
        loadData()
      } else {
        flash('Failed to create rule', 'error')
      }
    } catch {
      flash('Error creating rule', 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteRule = React.useCallback(async (id: string) => {
    try {
      const res = await apiCall(`/api/purchases/reordering-rules/${id}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        flash('Rule deleted', 'success')
        loadData()
      } else {
        flash('Failed to delete rule', 'error')
      }
    } catch {
      flash('Error deleting rule', 'error')
    }
  }, [loadData])

  const columns = React.useMemo<ColumnDef<RuleRow>[]>(
    () => [
      {
        id: 'productId',
        header: 'Product',
        accessorKey: 'productId',
        cell: ({ row }) => {
          const prod = productsMap.get(row.original.productId)
          return (
            <div className="flex flex-col">
              <span className="font-semibold text-sm">
                {prod ? prod.title : 'Catalog Product'}
              </span>
              <div className="flex items-center gap-1.5 mt-0.5">
                {prod?.sku ? (
                  <span className="font-mono text-[11px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
                    {prod.sku}
                  </span>
                ) : null}
                <Link
                  href={`/backend/catalog/products/${row.original.productId}`}
                  target="_blank"
                  className="text-[11px] text-primary hover:underline inline-flex items-center gap-0.5 font-mono"
                >
                  View in Catalog <ExternalLink className="h-2.5 w-2.5" />
                </Link>
              </div>
            </div>
          )
        },
      },
      {
        id: 'warehouse',
        header: 'Warehouse',
        accessorKey: 'warehouseId',
        cell: ({ row }) => {
          if (!row.original.warehouseId) {
            return (
              <span className="text-muted-foreground text-xs italic">
                All Warehouses (Global)
              </span>
            )
          }
          const wh = warehousesMap.get(row.original.warehouseId)
          return (
            <div className="flex flex-col">
              <span className="text-sm font-medium">
                {wh ? wh.name : 'Central Logistics Hub'}
              </span>
              {wh?.code ? (
                <span className="font-mono text-[11px] text-muted-foreground">
                  {wh.code}
                </span>
              ) : null}
            </div>
          )
        },
      },
      {
        id: 'minQuantity',
        header: 'Min Quantity (Trigger)',
        accessorKey: 'minQuantity',
        cell: ({ row }) => (
          <span className="font-mono text-sm font-medium">{Number(row.original.minQuantity).toFixed(2)}</span>
        ),
      },
      {
        id: 'maxQuantity',
        header: 'Max Quantity (Target)',
        accessorKey: 'maxQuantity',
        cell: ({ row }) => (
          <span className="font-mono text-sm font-semibold text-primary">
            {Number(row.original.maxQuantity).toFixed(2)}
          </span>
        ),
      },
      {
        id: 'stockStatus',
        header: 'Stock & Forecast',
        cell: ({ row }) => {
          const inbound = row.original.inboundStock ?? 0
          const virtual = row.original.virtualStock ?? 0
          const isBelow = row.original.isBelowMin ?? false
          const suggested = row.original.suggestedOrderQty ?? 0

          return (
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-1.5 text-xs font-mono">
                <span>Inbound: <span className="font-semibold text-foreground">+{inbound.toFixed(0)}</span></span>
                <span className="text-muted-foreground">|</span>
                <span>Virtual: <span className="font-semibold text-foreground">{virtual.toFixed(0)}</span></span>
              </div>
              <div>
                {isBelow ? (
                  <StatusBadge variant="warning">
                    ⚠️ REORDER (+{suggested.toFixed(0)})
                  </StatusBadge>
                ) : (
                  <StatusBadge variant="success">
                    ✓ STOCK HEALTHY
                  </StatusBadge>
                )}
              </div>
            </div>
          )
        },
      },
      {
        id: 'quantityMultiple',
        header: 'Batch Multiple',
        accessorKey: 'quantityMultiple',
        cell: ({ row }) => (
          <span className="font-mono text-sm">{Number(row.original.quantityMultiple).toFixed(0)}</span>
        ),
      },
      {
        id: 'preferredVendorId',
        header: 'Preferred Vendor',
        accessorKey: 'preferredVendorId',
        cell: ({ row }) => {
          const vend = row.original.preferredVendorId
            ? vendorsMap.get(row.original.preferredVendorId)
            : null
          if (!row.original.preferredVendorId) {
            return (
              <span className="text-muted-foreground text-xs italic">
                Auto (Best Pricelist Rate)
              </span>
            )
          }
          return (
            <div className="flex flex-col">
              <span className="text-sm font-medium">
                {vend ? vend.name : row.original.preferredVendorId}
              </span>
              {vend?.code ? (
                <span className="font-mono text-[11px] text-muted-foreground">
                  {vend.code}
                </span>
              ) : null}
            </div>
          )
        },
      },
      {
        id: 'isActive',
        header: 'Status',
        accessorKey: 'isActive',
        cell: ({ row }) => (
          <StatusBadge variant={row.original.isActive ? 'success' : 'neutral'}>
            {row.original.isActive ? 'ACTIVE' : 'INACTIVE'}
          </StatusBadge>
        ),
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <div className="flex justify-end">
            <RowActions
              items={[
                {
                  id: 'delete',
                  label: 'Delete rule',
                  destructive: true,
                  onSelect: () => handleDeleteRule(row.original.id),
                },
              ]}
            />
          </div>
        ),
      },
    ],
    [handleDeleteRule, productsMap, vendorsMap, warehousesMap]
  )

  return (
    <Page>
      <PageBody>
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Reordering Rules (Min-Max)</h1>
              <p className="text-sm text-muted-foreground">
                Automatic replenishment triggers: Stock + Inbound &lt; Min &rarr; Auto-order up to Max.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Link href="/backend/purchases/orders">
                <Button variant="outline" size="sm" aria-label="Back to orders">
                  <ArrowLeft className="h-4 w-4" />
                </Button>
              </Link>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRunReplenishment}
                disabled={running}
              >
                <Play className="h-4 w-4 mr-1.5" />
                {running ? 'Running...' : 'Run Replenishment'}
              </Button>
              <Button size="sm" onClick={() => setShowCreate(!showCreate)}>
                <Plus className="h-4 w-4 mr-1.5" />
                {showCreate ? 'Close Form' : 'Add Rule'}
              </Button>
            </div>
          </div>

          {/* Quick Create Card */}
          {showCreate && (
            <form
              onSubmit={handleCreateRule}
              className="p-5 rounded-lg border bg-card text-card-foreground shadow-sm space-y-4"
            >
              <h3 className="font-semibold text-sm">New Min-Max Reordering Rule</h3>
              <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
                <div className="md:col-span-2">
                  <Label htmlFor="productId">Product *</Label>
                  <select
                    id="productId"
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    value={productId}
                    onChange={(e) => setProductId(e.target.value)}
                    disabled={loadingProducts}
                    required
                  >
                    <option value="" disabled>
                      {loadingProducts ? 'Loading products...' : '-- Select Catalog Product --'}
                    </option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.title} {p.sku ? `[${p.sku}]` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="md:col-span-2">
                  <Label htmlFor="warehouseId">Warehouse</Label>
                  <select
                    id="warehouseId"
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    value={warehouseId}
                    onChange={(e) => setWarehouseId(e.target.value)}
                    disabled={loadingWarehouses}
                  >
                    <option value="">All Warehouses (Global)</option>
                    {warehouses.map((w) => (
                      <option key={w.id} value={w.id}>
                        {w.name} ({w.code})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="md:col-span-2">
                  <Label htmlFor="vendorId">Preferred Vendor</Label>
                  <select
                    id="vendorId"
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    value={vendorId}
                    onChange={(e) => setVendorId(e.target.value)}
                    disabled={loadingVendors}
                  >
                    <option value="">Auto (Resolve Best Pricelist Rate)</option>
                    {vendors.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name} {v.code ? `(${v.code})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="md:col-span-2">
                  <Label htmlFor="minQty">Min Quantity (Trigger) *</Label>
                  <Input
                    id="minQty"
                    type="number"
                    min="0"
                    step="any"
                    value={minQty}
                    onChange={(e) => setMinQty(e.target.value)}
                    required
                  />
                </div>
                <div className="md:col-span-2">
                  <Label htmlFor="maxQty">Max Quantity (Target) *</Label>
                  <Input
                    id="maxQty"
                    type="number"
                    min="0"
                    step="any"
                    value={maxQty}
                    onChange={(e) => setMaxQty(e.target.value)}
                    required
                  />
                </div>
                <div className="md:col-span-2">
                  <Label htmlFor="multiple">Batch Multiple</Label>
                  <Input
                    id="multiple"
                    type="number"
                    min="1"
                    step="1"
                    value={multiple}
                    onChange={(e) => setMultiple(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowCreate(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={saving}>
                  {saving ? 'Saving...' : 'Save Rule'}
                </Button>
              </div>
            </form>
          )}

          <DataTable
            columns={columns}
            data={data}
            isLoading={loading}
            pagination={{
              page,
              pageSize,
              total,
              totalPages: Math.ceil(total / pageSize) || 1,
              onPageChange: setPage,
              onPageSizeChange: setPageSize,
            }}
          />
        </div>
      </PageBody>
    </Page>
  )
}
