"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Plus, Trash2, ArrowLeft, Save, Building2, Package, ExternalLink, Sparkles } from 'lucide-react'

type LineDraft = {
  id: string
  productId?: string | null
  vendorProductCode?: string | null
  productDescription: string
  quantityOrdered: number
  unitPriceNet: number
  taxRatePercent: number
  pricelistNote?: string | null
}

type VendorItem = {
  id: string
  name: string
  code?: string | null
  currencyCode?: string | null
  paymentTerms?: string | null
}

type CatalogProductItem = {
  id: string
  title: string
  sku?: string | null
}

type CreateResponse = {
  id: string
  error?: string | Record<string, unknown>
}

export default function CreatePurchaseOrderPage() {
  const t = useT()
  const router = useRouter()
  const [submitting, setSubmitting] = React.useState(false)

  // Vendors list state
  const [vendors, setVendors] = React.useState<VendorItem[]>([])
  const [loadingVendors, setLoadingVendors] = React.useState(true)
  const [manualVendorMode, setManualVendorMode] = React.useState(false)

  // Products list state
  const [products, setProducts] = React.useState<CatalogProductItem[]>([])
  const [loadingProducts, setLoadingProducts] = React.useState(true)

  // Header state
  const [vendorId, setVendorId] = React.useState('')
  const [vendorName, setVendorName] = React.useState('')
  const [orderDate, setOrderDate] = React.useState(new Date().toISOString().split('T')[0])
  const [currencyCode, setCurrencyCode] = React.useState('PLN')
  const [incoterm, setIncoterm] = React.useState('FOB')
  const [notes, setNotes] = React.useState('')

  // Lines state
  const [lines, setLines] = React.useState<LineDraft[]>([
    {
      id: '1',
      productId: null,
      vendorProductCode: null,
      productDescription: '',
      quantityOrdered: 1,
      unitPriceNet: 0,
      taxRatePercent: 23,
    },
  ])

  // Helper to resolve vendor negotiated pricelist price
  const resolveLinePrice = React.useCallback(
    async (currentVendorId: string, prodId: string, qty: number, lineId: string) => {
      if (!currentVendorId || !prodId) return
      try {
        const res = await apiCall<{
          found: boolean
          unitPrice?: number
          vendorProductCode?: string
          currencyCode?: string
        }>(
          `/api/purchases/pricelists/resolve?vendorId=${encodeURIComponent(
            currentVendorId
          )}&productId=${encodeURIComponent(prodId)}&quantity=${qty}`
        )
        if (res.ok && res.result?.found && res.result.unitPrice !== undefined) {
          const negotiated = res.result.unitPrice
          const supplierSku = res.result.vendorProductCode ?? null
          const curr = res.result.currencyCode || ''
          setLines((prev) =>
            prev.map((l) =>
              l.id === lineId
                ? {
                    ...l,
                    unitPriceNet: negotiated,
                    vendorProductCode: supplierSku,
                    pricelistNote: `Vendor rate applied: ${negotiated.toFixed(2)} ${curr}`,
                  }
                : l
            )
          )
        }
      } catch {
        // Silently continue if no pricelist is configured
      }
    },
    []
  )

  // Fetch vendors on mount
  React.useEffect(() => {
    let active = true
    async function fetchVendors() {
      try {
        const res = await apiCall<{ items: VendorItem[] }>('/api/purchases/vendors?pageSize=100')
        if (active && res.ok && res.result?.items) {
          setVendors(res.result.items)

          // Check if vendorId is in URL query parameters
          const params = new URLSearchParams(window.location.search)
          const queryVendorId = params.get('vendorId')
          if (queryVendorId) {
            const found = res.result.items.find((v) => v.id === queryVendorId)
            if (found) {
              setVendorId(found.id)
              setVendorName(found.name)
              if (found.currencyCode) setCurrencyCode(found.currencyCode)
            } else {
              setVendorId(queryVendorId)
            }
          } else if (res.result.items.length > 0 && !vendorId) {
            const first = res.result.items[0]
            setVendorId(first.id)
            setVendorName(first.name)
            if (first.currencyCode) setCurrencyCode(first.currencyCode)
          }
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

  // Fetch catalog products on mount
  React.useEffect(() => {
    let active = true
    async function fetchProducts() {
      try {
        const res = await apiCall<{ items: CatalogProductItem[] }>('/api/catalog/products?pageSize=100')
        if (active && res.ok && res.result?.items) {
          setProducts(res.result.items)
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

  const handleVendorSelect = (selectedId: string) => {
    setVendorId(selectedId)
    const found = vendors.find((v) => v.id === selectedId)
    if (found) {
      setVendorName(found.name)
      if (found.currencyCode) {
        setCurrencyCode(found.currencyCode)
      }
    }

    // When vendor changes, re-resolve pricelist rates for all catalog-linked lines
    if (selectedId) {
      for (const line of lines) {
        if (line.productId) {
          resolveLinePrice(selectedId, line.productId, line.quantityOrdered, line.id)
        }
      }
    }
  }

  const handleProductSelect = (lineId: string, selectedProductId: string) => {
    if (!selectedProductId) {
      updateLine(lineId, {
        productId: null,
        vendorProductCode: null,
        pricelistNote: null,
      })
      return
    }

    const prod = products.find((p) => p.id === selectedProductId)
    if (prod) {
      const desc = `${prod.title}${prod.sku ? ` (${prod.sku})` : ''}`
      const targetLine = lines.find((l) => l.id === lineId)
      const qty = targetLine ? targetLine.quantityOrdered : 1

      updateLine(lineId, {
        productId: prod.id,
        productDescription: desc,
        pricelistNote: null,
      })

      if (vendorId) {
        resolveLinePrice(vendorId, prod.id, qty, lineId)
      }
    }
  }

  const handleQuantityChange = (lineId: string, qty: number) => {
    updateLine(lineId, { quantityOrdered: qty })
    const target = lines.find((l) => l.id === lineId)
    if (vendorId && target?.productId && qty > 0) {
      resolveLinePrice(vendorId, target.productId, qty, lineId)
    }
  }

  const addLine = () => {
    setLines((prev) => [
      ...prev,
      {
        id: String(Date.now()),
        productId: null,
        vendorProductCode: null,
        productDescription: '',
        quantityOrdered: 1,
        unitPriceNet: 0,
        taxRatePercent: 23,
      },
    ])
  }

  const removeLine = (id: string) => {
    setLines((prev) => (prev.length > 1 ? prev.filter((l) => l.id !== id) : prev))
  }

  const updateLine = (id: string, patch: Partial<LineDraft>) => {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)))
  }

  // Calculated totals
  const totals = React.useMemo(() => {
    let subtotal = 0
    let tax = 0
    for (const line of lines) {
      const lineSubtotal = line.quantityOrdered * line.unitPriceNet
      const lineTax = lineSubtotal * (line.taxRatePercent / 100)
      subtotal += lineSubtotal
      tax += lineTax
    }
    return {
      subtotalNet: subtotal,
      totalTax: tax,
      totalGross: subtotal + tax,
    }
  }, [lines])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!vendorId.trim()) {
      flash(t('purchases.orders.errors.vendor_required', 'Please select or enter a vendor'), 'error')
      return
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!uuidRegex.test(vendorId.trim())) {
      flash('Vendor ID must be a valid UUID. Please select a registered vendor from the dropdown.', 'error')
      return
    }

    const validLines = lines.filter((l) => l.productDescription.trim().length > 0)
    if (validLines.length === 0) {
      flash(t('purchases.orders.errors.lines_required', 'At least one line item with description is required'), 'error')
      return
    }

    setSubmitting(true)
    try {
      const call = await apiCall<CreateResponse>('/api/purchases/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vendorId: vendorId.trim(),
          vendorName: vendorName.trim() || undefined,
          orderDate: new Date(orderDate).toISOString(),
          currencyCode,
          incoterm,
          notes: notes.trim() || undefined,
          lines: validLines.map((l, idx) => ({
            productId: l.productId || undefined,
            vendorProductCode: l.vendorProductCode || undefined,
            productDescription: l.productDescription,
            quantityOrdered: l.quantityOrdered,
            unitPriceNet: l.unitPriceNet,
            taxRatePercent: l.taxRatePercent,
            sortOrder: idx,
          })),
        }),
      })

      if (!call.ok || !call.result?.id) {
        let errMessage = 'Failed to create purchase order'
        const rawErr = call.result?.error
        if (typeof rawErr === 'string') {
          errMessage = rawErr
        } else if (rawErr && typeof rawErr === 'object') {
          errMessage = Object.entries(rawErr)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            .map(([k, v]: [string, any]) => `${k}: ${Array.isArray(v?._errors) ? v._errors.join(', ') : JSON.stringify(v)}`)
            .join('; ')
        }
        throw new Error(errMessage)
      }

      flash(t('purchases.orders.created_success', 'Draft RFQ created successfully'), 'success')
      router.push(`/backend/purchases/orders/${call.result.id}`)
    } catch (err: unknown) {
      flash((err as Error).message, 'error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Page>
      <PageBody>
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link href="/backend/purchases/orders">
              <Button variant="outline" size="sm" aria-label="Back to orders">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold tracking-tight">
                {t('purchases.orders.create_title', 'New Request for Quotation (RFQ)')}
              </h1>
              <p className="text-sm text-muted-foreground">
                {t('purchases.orders.create_subtitle', 'Draft an RFQ to send to suppliers for pricing.')}
              </p>
            </div>
          </div>
          <Button onClick={handleSubmit} disabled={submitting} className="gap-2">
            <Save className="h-4 w-4" />
            {t('common.save', 'Save Draft RFQ')}
          </Button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Header 2-Column Section */}
          <div className="grid grid-cols-1 gap-6 rounded-lg border bg-card p-6 shadow-sm md:grid-cols-2">
            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-sm font-medium">
                    {t('purchases.orders.vendor_select', 'Vendor / Supplier')} *
                  </label>
                  <div className="flex items-center gap-3 text-xs">
                    <Link
                      href="/backend/purchases/vendors"
                      target="_blank"
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      <Building2 className="h-3 w-3" />
                      Manage Vendors
                      <ExternalLink className="h-2.5 w-2.5" />
                    </Link>
                    <button
                      type="button"
                      onClick={() => setManualVendorMode(!manualVendorMode)}
                      className="text-muted-foreground hover:text-foreground underline"
                    >
                      {manualVendorMode ? 'Choose from list' : 'Enter raw UUID'}
                    </button>
                  </div>
                </div>

                {!manualVendorMode ? (
                  <select
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    value={vendorId}
                    onChange={(e) => handleVendorSelect(e.target.value)}
                    disabled={loadingVendors}
                    required
                  >
                    <option value="" disabled>
                      {loadingVendors ? 'Loading vendors...' : '-- Select Vendor --'}
                    </option>
                    {vendors.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name} {v.code ? `(${v.code})` : ''} - {v.currencyCode || 'PLN'}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Input
                    value={vendorId}
                    onChange={(e) => setVendorId(e.target.value)}
                    placeholder="e.g. 9911d342-b946-45eb-a9bc-dad146547c38"
                    required
                  />
                )}
              </div>

              <div>
                <label className="text-sm font-medium">
                  {t('purchases.orders.vendor_name', 'Vendor Name')}
                </label>
                <Input
                  value={vendorName}
                  onChange={(e) => setVendorName(e.target.value)}
                  placeholder="Auto-filled from selected vendor"
                />
              </div>

              <div>
                <label className="text-sm font-medium">
                  {t('purchases.orders.order_date', 'Order Date')}
                </label>
                <Input
                  type="date"
                  value={orderDate}
                  onChange={(e) => setOrderDate(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium">
                    {t('purchases.orders.currency', 'Currency')}
                  </label>
                  <Input
                    value={currencyCode}
                    onChange={(e) => setCurrencyCode(e.target.value.toUpperCase())}
                    maxLength={3}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium">
                    {t('purchases.orders.incoterm', 'Incoterm')}
                  </label>
                  <Input
                    value={incoterm}
                    onChange={(e) => setIncoterm(e.target.value.toUpperCase())}
                    placeholder="FOB, CIF, EXW"
                  />
                </div>
              </div>

              <div>
                <label className="text-sm font-medium">
                  {t('purchases.orders.notes', 'Internal Notes / Instructions')}
                </label>
                <Input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Notes, shipping guidelines, or contact details..."
                />
              </div>
            </div>
          </div>

          {/* Line Items Table */}
          <div className="rounded-lg border bg-card p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold tracking-tight">
                  {t('purchases.orders.order_lines', 'Order Line Items')}
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Select a catalog product to auto-fill description and vendor-negotiated pricelist rates.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  href="/backend/catalog/products"
                  target="_blank"
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  <Package className="h-3.5 w-3.5" />
                  View Catalog
                  <ExternalLink className="h-2.5 w-2.5" />
                </Link>
                <Button type="button" variant="outline" size="sm" onClick={addLine} className="gap-1.5">
                  <Plus className="h-3.5 w-3.5" />
                  {t('purchases.orders.add_line', 'Add Product Line')}
                </Button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b bg-muted/50 text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="p-2.5 min-w-[280px]">
                      {t('purchases.orders.product_col', 'Product & Description')}
                    </th>
                    <th className="w-28 p-2.5">{t('purchases.orders.qty', 'Quantity')}</th>
                    <th className="w-32 p-2.5">{t('purchases.orders.unit_price', 'Net Price')}</th>
                    <th className="w-24 p-2.5">{t('purchases.orders.tax', 'Tax %')}</th>
                    <th className="w-32 p-2.5">{t('purchases.orders.subtotal', 'Subtotal Net')}</th>
                    <th className="w-12 p-2.5"></th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {lines.map((line) => {
                    const lineSubtotal = line.quantityOrdered * line.unitPriceNet
                    return (
                      <tr key={line.id} className="hover:bg-muted/30">
                        <td className="p-2.5">
                          <div className="space-y-1.5">
                            <select
                              className="flex h-8 w-full rounded-md border border-input bg-transparent px-2.5 py-1 text-xs shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                              value={line.productId || ''}
                              onChange={(e) => handleProductSelect(line.id, e.target.value)}
                              disabled={loadingProducts}
                            >
                              <option value="">
                                {loadingProducts
                                  ? 'Loading catalog products...'
                                  : '-- Select from Catalog (or custom below) --'}
                              </option>
                              {products.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.title} {p.sku ? `[SKU: ${p.sku}]` : ''}
                                </option>
                              ))}
                            </select>

                            <Input
                              value={line.productDescription}
                              onChange={(e) =>
                                updateLine(line.id, { productDescription: e.target.value })
                              }
                              placeholder="Line description or custom item..."
                              className="h-8 text-xs"
                              required
                            />

                            {line.pricelistNote && (
                              <div className="inline-flex items-center gap-1 text-[11px] text-emerald-600 font-medium">
                                <Sparkles className="h-3 w-3" />
                                {line.pricelistNote}
                                {line.vendorProductCode ? ` (Supplier SKU: ${line.vendorProductCode})` : ''}
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="p-2.5 align-top pt-3">
                          <Input
                            type="number"
                            min="0.0001"
                            step="any"
                            value={line.quantityOrdered}
                            onChange={(e) =>
                              handleQuantityChange(line.id, parseFloat(e.target.value) || 0)
                            }
                            className="h-8 text-xs"
                          />
                        </td>
                        <td className="p-2.5 align-top pt-3">
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            value={line.unitPriceNet}
                            onChange={(e) =>
                              updateLine(line.id, {
                                unitPriceNet: parseFloat(e.target.value) || 0,
                                pricelistNote: null,
                              })
                            }
                            className="h-8 text-xs"
                          />
                        </td>
                        <td className="p-2.5 align-top pt-3">
                          <Input
                            type="number"
                            min="0"
                            max="100"
                            value={line.taxRatePercent}
                            onChange={(e) =>
                              updateLine(line.id, {
                                taxRatePercent: parseFloat(e.target.value) || 0,
                              })
                            }
                            className="h-8 text-xs"
                          />
                        </td>
                        <td className="p-2.5 font-mono text-sm align-top pt-4">
                          {lineSubtotal.toFixed(2)} {currencyCode}
                        </td>
                        <td className="p-2.5 text-right align-top pt-3">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={lines.length === 1}
                            onClick={() => removeLine(line.id)}
                            className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Totals Summary */}
            <div className="mt-6 flex justify-end">
              <div className="w-72 space-y-2 rounded-lg bg-muted/40 p-4 text-sm">
                <div className="flex justify-between text-muted-foreground">
                  <span>{t('purchases.orders.total_net', 'Subtotal Net:')}</span>
                  <span className="font-mono font-medium">
                    {totals.subtotalNet.toFixed(2)} {currencyCode}
                  </span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>{t('purchases.orders.total_tax', 'Estimated Tax:')}</span>
                  <span className="font-mono font-medium">
                    {totals.totalTax.toFixed(2)} {currencyCode}
                  </span>
                </div>
                <div className="border-t pt-2 flex justify-between font-bold text-base">
                  <span>{t('purchases.orders.total_gross', 'Total Gross:')}</span>
                  <span className="font-mono text-primary">
                    {totals.totalGross.toFixed(2)} {currencyCode}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-3">
            <Link href="/backend/purchases/orders">
              <Button type="button" variant="outline">
                {t('common.cancel', 'Cancel')}
              </Button>
            </Link>
            <Button type="submit" disabled={submitting} className="gap-2">
              <Save className="h-4 w-4" />
              {t('common.save', 'Save Draft RFQ')}
            </Button>
          </div>
        </form>
      </PageBody>
    </Page>
  )
}
