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
import { Plus, ArrowLeft, Copy, Check, Users, Building2, Search } from 'lucide-react'

type VendorRow = {
  id: string
  name: string
  code?: string | null
  email?: string | null
  phone?: string | null
  currencyCode: string
  paymentTerms?: string | null
  taxId?: string | null
  address?: string | null
  notes?: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

type ListResponse = {
  items: VendorRow[]
  total: number
  page: number
  pageSize: number
  totalPages: number
  error?: string
}

export default function VendorsPage() {
  const [data, setData] = React.useState<VendorRow[]>([])
  const [loading, setLoading] = React.useState(true)
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(20)
  const [total, setTotal] = React.useState(0)
  const [search, setSearch] = React.useState('')
  const [copiedId, setCopiedId] = React.useState<string | null>(null)

  // Form state (add or edit)
  const [showForm, setShowForm] = React.useState(false)
  const [editingId, setEditingId] = React.useState<string | null>(null)
  const [editingUpdatedAt, setEditingUpdatedAt] = React.useState<string | null>(null)
  const [name, setName] = React.useState('')
  const [code, setCode] = React.useState('')
  const [email, setEmail] = React.useState('')
  const [phone, setPhone] = React.useState('')
  const [currencyCode, setCurrencyCode] = React.useState('PLN')
  const [paymentTerms, setPaymentTerms] = React.useState('Net 30')
  const [taxId, setTaxId] = React.useState('')
  const [address, setAddress] = React.useState('')
  const [notes, setNotes] = React.useState('')
  const [isActive, setIsActive] = React.useState(true)
  const [saving, setSaving] = React.useState(false)

  const loadData = React.useCallback(async () => {
    setLoading(true)
    try {
      const q = search.trim() ? `&search=${encodeURIComponent(search.trim())}` : ''
      const res = await apiCall<ListResponse>(
        `/api/purchases/vendors?page=${page}&pageSize=${pageSize}${q}`
      )
      if (res.ok && res.result) {
        setData(res.result.items)
        setTotal(res.result.total)
      } else {
        flash(res.result?.error || 'Failed to load vendors', 'error')
      }
    } catch (err: unknown) {
      flash((err as Error).message || 'Error loading vendors', 'error')
    } finally {
      setLoading(false)
    }
  }, [page, pageSize, search])

  React.useEffect(() => {
    loadData()
  }, [loadData])

  const resetForm = () => {
    setEditingId(null)
    setEditingUpdatedAt(null)
    setName('')
    setCode('')
    setEmail('')
    setPhone('')
    setCurrencyCode('PLN')
    setPaymentTerms('Net 30')
    setTaxId('')
    setAddress('')
    setNotes('')
    setIsActive(true)
    setShowForm(false)
  }

  const handleOpenEdit = (v: VendorRow) => {
    setEditingId(v.id)
    setEditingUpdatedAt(v.updatedAt)
    setName(v.name)
    setCode(v.code || '')
    setEmail(v.email || '')
    setPhone(v.phone || '')
    setCurrencyCode(v.currencyCode || 'PLN')
    setPaymentTerms(v.paymentTerms || 'Net 30')
    setTaxId(v.taxId || '')
    setAddress(v.address || '')
    setNotes(v.notes || '')
    setIsActive(v.isActive)
    setShowForm(true)
  }

  const handleSaveVendor = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      flash('Vendor name is required', 'error')
      return
    }

    setSaving(true)
    try {
      const payload = {
        name: name.trim(),
        code: code.trim() || undefined,
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        currencyCode,
        paymentTerms: paymentTerms.trim() || undefined,
        taxId: taxId.trim() || undefined,
        address: address.trim() || undefined,
        notes: notes.trim() || undefined,
        isActive,
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }
      if (editingId && editingUpdatedAt) {
        headers['x-om-updated-at'] = editingUpdatedAt
      }

      const res = await apiCall<{ id: string; error?: string }>(
        editingId ? `/api/purchases/vendors/${editingId}` : '/api/purchases/vendors',
        {
          method: editingId ? 'PUT' : 'POST',
          headers,
          body: JSON.stringify(payload),
        }
      )

      if (res.ok) {
        flash(
          editingId ? 'Vendor updated successfully' : 'Vendor registered successfully',
          'success'
        )
        resetForm()
        loadData()
      } else {
        flash(res.result?.error || 'Failed to save vendor', 'error')
      }
    } catch (err: unknown) {
      flash((err as Error).message || 'Error saving vendor', 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteVendor = React.useCallback(async (vendor: VendorRow) => {
    if (!confirm(`Are you sure you want to deactivate and remove vendor "${vendor.name}"?`)) {
      return
    }
    try {
      const res = await apiCall<{ error?: string }>(`/api/purchases/vendors/${vendor.id}`, {
        method: 'DELETE',
        headers: {
          'x-om-updated-at': vendor.updatedAt,
        },
      })
      if (res.ok) {
        flash('Vendor deleted', 'success')
        loadData()
      } else {
        flash(res.result?.error || 'Failed to delete vendor', 'error')
      }
    } catch (err: unknown) {
      flash((err as Error).message || 'Error deleting vendor', 'error')
    }
  }, [loadData])

  const copyToClipboard = (id: string) => {
    navigator.clipboard.writeText(id)
    setCopiedId(id)
    flash('Vendor UUID copied to clipboard', 'info')
    setTimeout(() => setCopiedId(null), 2000)
  }

  const columns = React.useMemo<ColumnDef<VendorRow>[]>(
    () => [
      {
        id: 'name',
        header: 'Vendor Name & Code',
        accessorKey: 'name',
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="font-semibold text-sm">{row.original.name}</span>
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
              {row.original.code ? (
                <span className="font-mono bg-muted px-1.5 py-0.5 rounded text-[11px]">
                  {row.original.code}
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => copyToClipboard(row.original.id)}
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground font-mono"
                title="Click to copy ID"
              >
                {copiedId === row.original.id ? (
                  <Check className="h-3 w-3 text-emerald-600" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
                {row.original.id.slice(0, 8)}...
              </button>
            </div>
          </div>
        ),
      },
      {
        id: 'contact',
        header: 'Contact Information',
        cell: ({ row }) => (
          <div className="text-xs space-y-0.5">
            {row.original.email && <div>{row.original.email}</div>}
            {row.original.phone && <div className="text-muted-foreground">{row.original.phone}</div>}
            {!row.original.email && !row.original.phone && (
              <span className="text-muted-foreground italic">No contact info</span>
            )}
          </div>
        ),
      },
      {
        id: 'taxId',
        header: 'Tax ID / NIP',
        accessorKey: 'taxId',
        cell: ({ row }) => (
          <span className="font-mono text-xs">{row.original.taxId || '—'}</span>
        ),
      },
      {
        id: 'currencyCode',
        header: 'Currency',
        accessorKey: 'currencyCode',
        cell: ({ row }) => (
          <span className="font-mono text-xs font-semibold">{row.original.currencyCode}</span>
        ),
      },
      {
        id: 'paymentTerms',
        header: 'Payment Terms',
        accessorKey: 'paymentTerms',
        cell: ({ row }) => (
          <span className="text-xs">{row.original.paymentTerms || 'Net 30'}</span>
        ),
      },
      {
        id: 'status',
        header: 'Status',
        accessorKey: 'isActive',
        cell: ({ row }) => (
          <StatusBadge variant={row.original.isActive ? 'success' : 'neutral'}>
            {row.original.isActive ? 'Active' : 'Inactive'}
          </StatusBadge>
        ),
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <RowActions
            items={[
              {
                id: 'copy-id',
                label: 'Copy Vendor UUID',
                onSelect: () => copyToClipboard(row.original.id),
              },
              {
                id: 'create-po',
                label: 'Create RFQ for this Vendor',
                href: `/backend/purchases/orders/create?vendorId=${row.original.id}`,
              },
              {
                id: 'edit',
                label: 'Edit Vendor',
                onSelect: () => handleOpenEdit(row.original),
              },
              {
                id: 'delete',
                label: 'Deactivate / Delete',
                destructive: true,
                onSelect: () => handleDeleteVendor(row.original),
              },
            ]}
          />
        ),
      },
    ],
    [copiedId, handleDeleteVendor]
  )

  return (
    <Page>
      <PageBody>
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-center gap-3">
              <Link href="/backend/purchases/orders">
                <Button variant="outline" size="sm" aria-label="Back to orders">
                  <ArrowLeft className="h-4 w-4" />
                </Button>
              </Link>
              <div>
                <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                  <Building2 className="h-6 w-6 text-primary" />
                  Vendors & Suppliers
                </h1>
                <p className="text-sm text-muted-foreground">
                  Map and manage external suppliers, contact information, default currencies, and payment terms.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={() => {
                  if (showForm) resetForm()
                  else setShowForm(true)
                }}
              >
                <Plus className="h-4 w-4 mr-1.5" />
                {showForm ? 'Close Form' : 'Add Vendor'}
              </Button>
            </div>
          </div>

          {/* Create or Edit Vendor Form Card */}
          {showForm && (
            <form
              onSubmit={handleSaveVendor}
              className="p-5 rounded-lg border bg-card text-card-foreground shadow-sm space-y-4"
            >
              <div className="flex items-center justify-between border-b pb-3">
                <h3 className="font-semibold text-base">
                  {editingId ? 'Edit Vendor Details' : 'Register New Vendor / Supplier'}
                </h3>
                <span className="text-xs text-muted-foreground">
                  {editingId ? `Editing: ${editingId}` : 'All fields can be updated later'}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <Label htmlFor="vName">Vendor / Company Name *</Label>
                  <Input
                    id="vName"
                    placeholder="e.g. Nordic Wholesale Supplier Ltd"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="vCode">Vendor Code</Label>
                  <Input
                    id="vCode"
                    placeholder="e.g. VEND-NORDIC"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="vCurrency">Default Currency</Label>
                  <select
                    id="vCurrency"
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    value={currencyCode}
                    onChange={(e) => setCurrencyCode(e.target.value)}
                  >
                    <option value="PLN">PLN - Polish Złoty</option>
                    <option value="EUR">EUR - Euro</option>
                    <option value="USD">USD - US Dollar</option>
                    <option value="GBP">GBP - British Pound</option>
                  </select>
                </div>
                <div>
                  <Label htmlFor="vEmail">Email Address</Label>
                  <Input
                    id="vEmail"
                    type="email"
                    placeholder="orders@supplier.example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="vPhone">Phone Number</Label>
                  <Input
                    id="vPhone"
                    placeholder="+48 22 100 2000"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="vTax">Tax ID / NIP</Label>
                  <Input
                    id="vTax"
                    placeholder="PL5250001234"
                    value={taxId}
                    onChange={(e) => setTaxId(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="vTerms">Payment Terms</Label>
                  <Input
                    id="vTerms"
                    placeholder="Net 30, Net 14, Immediate..."
                    value={paymentTerms}
                    onChange={(e) => setPaymentTerms(e.target.value)}
                  />
                </div>
                <div className="md:col-span-2">
                  <Label htmlFor="vAddress">Billing / Physical Address</Label>
                  <Input
                    id="vAddress"
                    placeholder="ul. Przykładowa 12, 00-001 Warszawa, Poland"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="vNotes">Internal Notes</Label>
                <textarea
                  id="vNotes"
                  className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  rows={2}
                  placeholder="Notes about supply reliability, discount tiers, account contacts..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </div>

              <div className="flex items-center justify-between pt-2">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isActive}
                    onChange={(e) => setIsActive(e.target.checked)}
                    className="rounded border-input text-primary focus:ring-primary"
                  />
                  <span>Vendor is active</span>
                </label>
                <div className="flex gap-2">
                  <Button type="button" variant="ghost" size="sm" onClick={resetForm}>
                    Cancel
                  </Button>
                  <Button type="submit" size="sm" disabled={saving}>
                    {saving ? 'Saving...' : editingId ? 'Update Vendor' : 'Create Vendor'}
                  </Button>
                </div>
              </div>
            </form>
          )}

          {/* Search bar */}
          <div className="flex items-center gap-2 max-w-sm">
            <div className="relative w-full">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search vendors by name, code, email, NIP..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>

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
