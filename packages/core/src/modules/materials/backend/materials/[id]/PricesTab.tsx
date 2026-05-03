'use client'

import * as React from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { CrudForm, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'

type PriceRow = {
  id: string
  material_supplier_link_id: string
  price_amount: string
  currency_id: string
  base_currency_amount: string | null
  base_currency_at: string | null
  valid_from: string | null
  valid_to: string | null
  is_active: boolean
}

type SupplierLinkOption = {
  id: string
  supplier_company_id: string
  preferred: boolean
}

type CurrencyOption = {
  id: string
  code: string
  name: string
  isBase: boolean
}

type CompanyOption = {
  id: string
  display_name: string
}

type PriceFormValues = {
  materialSupplierLinkId: string
  priceAmount: string
  currencyId: string
  validFrom?: string
  validTo?: string
}

type PricesTabProps = {
  materialId: string
  organizationId: string
  tenantId: string
}

const formatDate = (value: string | null | undefined): string => {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString()
}

/**
 * Phase 1 Step 8 — Prices for a material's supplier links.
 *
 * - Loads supplier links for this material first; prices are filtered against those link ids
 *   (one round-trip per supplier link to keep query simple — usually 1-3 links per material).
 * - Currency dropdown sourced from /api/currencies/currencies (top 100, sorted by code).
 * - base_currency_amount column shows the FX-cached value (Step 9 subscriber populates it);
 *   shows "pending FX" if NULL or a stale label if base_currency_at < the matching currency's
 *   most recent rate timestamp (Phase 1 simplification: just shows the value as-is).
 */
export function PricesTab({ materialId, organizationId, tenantId }: PricesTabProps) {
  const t = useT()
  const { confirm: confirmDialog, ConfirmDialogElement } = useConfirmDialog()

  const [supplierLinks, setSupplierLinks] = React.useState<SupplierLinkOption[]>([])
  const [supplierLinksLoading, setSupplierLinksLoading] = React.useState(true)
  const [companies, setCompanies] = React.useState<CompanyOption[]>([])
  const [currencies, setCurrencies] = React.useState<CurrencyOption[]>([])
  const [currenciesLoading, setCurrenciesLoading] = React.useState(true)
  const [prices, setPrices] = React.useState<PriceRow[]>([])
  const [pricesLoading, setPricesLoading] = React.useState(true)
  const [reloadToken, setReloadToken] = React.useState(0)
  const [editing, setEditing] = React.useState<PriceRow | null>(null)
  const [isCreating, setIsCreating] = React.useState(false)
  const [saving, setSaving] = React.useState(false)

  // Load supplier links for this material to populate the dropdown.
  React.useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        setSupplierLinksLoading(true)
        const fallback = { items: [] as SupplierLinkOption[] }
        const call = await apiCall<{ items: SupplierLinkOption[] }>(
          `/api/material-suppliers?materialId=${encodeURIComponent(materialId)}&pageSize=100`,
          undefined,
          { fallback },
        )
        if (cancelled) return
        if (call.ok && call.result) setSupplierLinks(call.result.items ?? [])
      } finally {
        if (!cancelled) setSupplierLinksLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [materialId])

  // Load companies (for human-readable supplier names in the price table).
  React.useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const call = await apiCall<{ items: CompanyOption[] }>(
          `/api/customers/companies?pageSize=100&sortField=name&sortDir=asc`,
        )
        if (cancelled) return
        if (call.ok && call.result?.items) {
          setCompanies(
            call.result.items.map((item) => ({ id: item.id, display_name: item.display_name ?? item.id })),
          )
        }
      } catch {
        // non-fatal — fall back to UUID display
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  // Load currencies for the org (active only, top 100).
  React.useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        setCurrenciesLoading(true)
        const fallback = { items: [] as CurrencyOption[] }
        const call = await apiCall<{ items: CurrencyOption[] }>(
          `/api/currencies/currencies?pageSize=100&isActive=true`,
          undefined,
          { fallback },
        )
        if (cancelled) return
        if (call.ok && call.result?.items) setCurrencies(call.result.items)
      } finally {
        if (!cancelled) setCurrenciesLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  // Load prices once we know which supplier links belong to this material.
  React.useEffect(() => {
    let cancelled = false
    async function load() {
      if (supplierLinks.length === 0) {
        setPrices([])
        setPricesLoading(false)
        return
      }
      try {
        setPricesLoading(true)
        // Fetch in parallel — typically 1-3 supplier links per material.
        const results = await Promise.all(
          supplierLinks.map((link) =>
            apiCall<{ items: PriceRow[] }>(
              `/api/material-prices?materialSupplierLinkId=${encodeURIComponent(link.id)}&pageSize=100`,
              undefined,
              { fallback: { items: [] } },
            ),
          ),
        )
        if (cancelled) return
        const flat: PriceRow[] = []
        for (const r of results) {
          if (r.ok && r.result?.items) flat.push(...r.result.items)
        }
        flat.sort((a, b) => {
          const aFrom = a.valid_from ? new Date(a.valid_from).getTime() : 0
          const bFrom = b.valid_from ? new Date(b.valid_from).getTime() : 0
          return bFrom - aFrom
        })
        setPrices(flat)
      } finally {
        if (!cancelled) setPricesLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [supplierLinks, reloadToken])

  const supplierName = React.useCallback(
    (linkId: string): string => {
      const link = supplierLinks.find((l) => l.id === linkId)
      if (!link) return linkId
      const company = companies.find((c) => c.id === link.supplier_company_id)
      return company?.display_name ?? link.supplier_company_id
    },
    [companies, supplierLinks],
  )

  const currencyCode = React.useCallback(
    (id: string): string => currencies.find((c) => c.id === id)?.code ?? id.substring(0, 8),
    [currencies],
  )

  const baseCurrencyCode = React.useMemo(
    () => currencies.find((c) => c.isBase)?.code ?? null,
    [currencies],
  )

  const formGroups = React.useMemo<CrudFormGroup[]>(
    () => [
      {
        id: 'price',
        column: 1,
        title: t('materials.detail.prices.section.price', 'Price'),
        fields: [
          {
            id: 'materialSupplierLinkId',
            type: 'select',
            label: t('materials.detail.prices.field.supplierLink', 'Supplier'),
            required: true,
            // Locked on edit — same identity argument as MaterialSupplierLink.
            disabled: editing !== null,
            options: supplierLinks.map((link) => ({
              value: link.id,
              label: `${supplierName(link.id)}${link.preferred ? ' ★' : ''}`,
            })),
            helpText: editing
              ? t(
                  'materials.detail.prices.field.supplierLink.locked',
                  'Cannot reassign price to a different supplier — delete and recreate instead.',
                )
              : t(
                  'materials.detail.prices.field.supplierLink.help',
                  'Pick the supplier this price applies to. Add suppliers from the Suppliers tab first.',
                ),
          },
          {
            id: 'priceAmount',
            type: 'text',
            label: t('materials.detail.prices.field.amount', 'Price (per base unit)'),
            placeholder: '12.500000',
            required: true,
            helpText: t(
              'materials.detail.prices.field.amount.help',
              'Decimal up to 6 places. Stored in the supplier currency; FX subscriber caches the base-currency equivalent (Step 9).',
            ),
          },
          {
            id: 'currencyId',
            type: 'select',
            label: t('materials.detail.prices.field.currency', 'Currency'),
            required: true,
            options: currencies.map((c) => ({
              value: c.id,
              label: `${c.code} — ${c.name}${c.isBase ? ` (${t('materials.detail.prices.field.currency.base', 'base')})` : ''}`,
            })),
          },
        ],
      },
      {
        id: 'validity',
        column: 2,
        title: t('materials.detail.prices.section.validity', 'Validity window'),
        description: t(
          'materials.detail.prices.section.validity.help',
          'Both dates are optional. Leave validTo empty for an open-ended (current) price. Validator rejects validTo before validFrom.',
        ),
        fields: [
          {
            id: 'validFrom',
            type: 'date',
            label: t('materials.detail.prices.field.validFrom', 'Valid from'),
          },
          {
            id: 'validTo',
            type: 'date',
            label: t('materials.detail.prices.field.validTo', 'Valid to'),
          },
        ],
      },
    ],
    [currencies, editing, supplierLinks, supplierName, t],
  )

  const startCreate = React.useCallback(() => {
    setEditing(null)
    setIsCreating(true)
  }, [])

  const startEdit = React.useCallback((price: PriceRow) => {
    setIsCreating(false)
    setEditing(price)
  }, [])

  const closeDialog = React.useCallback(() => {
    setEditing(null)
    setIsCreating(false)
  }, [])

  const submitForm = React.useCallback(
    async (values: PriceFormValues) => {
      setSaving(true)
      try {
        const body: Record<string, unknown> = {
          organizationId,
          tenantId,
          priceAmount: values.priceAmount?.trim() ?? '0',
          currencyId: values.currencyId,
          validFrom: values.validFrom?.trim() ? values.validFrom.trim() : null,
          validTo: values.validTo?.trim() ? values.validTo.trim() : null,
        }
        if (editing) {
          await apiCallOrThrow('/api/material-prices', {
            method: 'PUT',
            body: JSON.stringify({ ...body, id: editing.id }),
            headers: { 'content-type': 'application/json' },
          })
          flash(t('materials.detail.prices.update.success', 'Price updated'), 'success')
        } else {
          await apiCallOrThrow('/api/material-prices', {
            method: 'POST',
            body: JSON.stringify({
              ...body,
              materialSupplierLinkId: values.materialSupplierLinkId,
            }),
            headers: { 'content-type': 'application/json' },
          })
          flash(t('materials.detail.prices.create.success', 'Price added'), 'success')
        }
        closeDialog()
        setReloadToken((x) => x + 1)
      } catch {
        flash(
          editing
            ? t('materials.detail.prices.update.error', 'Failed to update price')
            : t('materials.detail.prices.create.error', 'Failed to add price'),
          'error',
        )
      } finally {
        setSaving(false)
      }
    },
    [closeDialog, editing, organizationId, t, tenantId],
  )

  const removePrice = React.useCallback(
    async (price: PriceRow) => {
      const confirmed = await confirmDialog({
        title: t('materials.detail.prices.delete.title', 'Delete price?'),
        description: t(
          'materials.detail.prices.delete.description',
          'Price record will be soft-deleted. The audit log preserves the prior amount and validity window — undo via that path.',
        ),
        confirmLabel: t('materials.detail.prices.delete.confirm', 'Delete'),
        cancelLabel: t('materials.detail.prices.delete.cancel', 'Cancel'),
        variant: 'destructive',
      })
      if (!confirmed) return
      const result = await apiCall<{ ok: boolean; error?: string }>(
        `/api/material-prices?id=${encodeURIComponent(price.id)}`,
        { method: 'DELETE' },
      )
      if (!result.ok) {
        const message = (result.result as any)?.error ?? t('materials.detail.prices.delete.error', 'Failed to delete price')
        flash(message, 'error')
        return
      }
      flash(t('materials.detail.prices.delete.success', 'Price deleted'), 'success')
      setReloadToken((x) => x + 1)
    },
    [confirmDialog, t],
  )

  const initialValues = React.useMemo<PriceFormValues>(
    () =>
      editing
        ? {
            materialSupplierLinkId: editing.material_supplier_link_id,
            priceAmount: editing.price_amount,
            currencyId: editing.currency_id,
            validFrom: editing.valid_from?.slice(0, 10) ?? '',
            validTo: editing.valid_to?.slice(0, 10) ?? '',
          }
        : {
            materialSupplierLinkId: supplierLinks[0]?.id ?? '',
            priceAmount: '',
            currencyId: currencies.find((c) => c.isBase)?.id ?? currencies[0]?.id ?? '',
            validFrom: '',
            validTo: '',
          },
    [currencies, editing, supplierLinks],
  )

  const isLoading = supplierLinksLoading || currenciesLoading || pricesLoading
  const noSuppliers = !supplierLinksLoading && supplierLinks.length === 0

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">{t('materials.detail.prices.title', 'Prices')}</h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            {t(
              'materials.detail.prices.description',
              'Per-supplier prices with optional validity windows. Prices in foreign currencies are converted to the tenant base currency by the FX subscriber (Step 9).',
            )}
          </p>
        </div>
        <Button size="sm" className="gap-1" onClick={startCreate} disabled={noSuppliers || currenciesLoading}>
          <Plus className="h-4 w-4" />
          {t('materials.detail.prices.add', 'Add price')}
        </Button>
      </div>

      {noSuppliers ? (
        <p className="rounded-md border bg-status-warning-bg/30 p-4 text-sm text-status-warning-text">
          {t(
            'materials.detail.prices.noSuppliers',
            'No suppliers linked yet. Add at least one supplier in the Suppliers tab before adding prices.',
          )}
        </p>
      ) : isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner size="sm" />
          {t('materials.detail.prices.loading', 'Loading prices…')}
        </div>
      ) : prices.length === 0 ? (
        <p className="rounded-md border bg-muted/30 p-4 text-sm text-muted-foreground">
          {t(
            'materials.detail.prices.empty',
            'No prices yet. Add the first price for one of the linked suppliers.',
          )}
        </p>
      ) : (
        <div className="overflow-hidden rounded-md border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2">{t('materials.detail.prices.column.supplier', 'Supplier')}</th>
                <th className="px-3 py-2 text-right">{t('materials.detail.prices.column.amount', 'Amount')}</th>
                <th className="px-3 py-2 text-right">
                  {t('materials.detail.prices.column.baseAmount', 'Base ({{base}})', {
                    base: baseCurrencyCode ?? '—',
                  } as any)}
                </th>
                <th className="px-3 py-2">{t('materials.detail.prices.column.validFrom', 'Valid from')}</th>
                <th className="px-3 py-2">{t('materials.detail.prices.column.validTo', 'Valid to')}</th>
                <th className="px-3 py-2 text-right" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {prices.map((price) => (
                <tr key={price.id} className="hover:bg-muted/20">
                  <td className="px-3 py-2 font-medium">
                    {supplierName(price.material_supplier_link_id)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-xs">
                    {price.price_amount} <Badge variant="outline" className="ml-1">{currencyCode(price.currency_id)}</Badge>
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-xs">
                    {price.base_currency_amount ? (
                      <span title={price.base_currency_at ?? undefined}>{price.base_currency_amount}</span>
                    ) : (
                      <Badge variant="secondary">
                        {t('materials.detail.prices.fxPending', 'pending FX')}
                      </Badge>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs">{formatDate(price.valid_from)}</td>
                  <td className="px-3 py-2 text-xs">{formatDate(price.valid_to)}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => startEdit(price)}>
                        {t('materials.detail.prices.actions.edit', 'Edit')}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => removePrice(price)}
                        aria-label={t('materials.detail.prices.actions.delete', 'Delete price')}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={isCreating || editing !== null} onOpenChange={(open) => (open ? null : closeDialog())}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editing
                ? t('materials.detail.prices.dialog.editTitle', 'Edit price')
                : t('materials.detail.prices.dialog.createTitle', 'Add price')}
            </DialogTitle>
          </DialogHeader>
          <CrudForm<PriceFormValues>
            groups={formGroups}
            initialValues={initialValues}
            submitLabel={
              editing
                ? t('materials.detail.prices.dialog.save', 'Save changes')
                : t('materials.detail.prices.dialog.create', 'Add price')
            }
            onSubmit={submitForm}
          />
          {saving ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Spinner size="sm" />
              {t('materials.detail.prices.dialog.saving', 'Saving…')}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {ConfirmDialogElement}
    </div>
  )
}

export default PricesTab
