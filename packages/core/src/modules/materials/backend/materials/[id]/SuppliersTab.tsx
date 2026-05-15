'use client'

import * as React from 'react'
import { Plus, Star, Trash2 } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { CrudForm, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'

type SupplierLinkRow = {
  id: string
  material_id: string
  supplier_company_id: string
  supplier_sku: string | null
  min_order_qty: string | null
  lead_time_days: number | null
  preferred: boolean
  notes: string | null
  is_active: boolean
}

type CompanyOption = {
  id: string
  display_name: string
}

type SupplierLinkFormValues = {
  supplierCompanyId: string
  supplierSku?: string
  minOrderQty?: string
  leadTimeDays?: string
  preferred?: boolean
  notes?: string
}

type SuppliersTabProps = {
  materialId: string
  organizationId: string
  tenantId: string
}

/**
 * Phase 1 Step 7 — Supplier links management for a single material.
 *
 * - Dropdown of all CustomerCompanyProfile rows in the org (Phase 1 deliberately doesn't
 *   filter by 'supplier' role yet — that's a CRM-specific tag we don't want to couple to.
 *   The server enforces same-org existence; assignment beyond that is a UX concern).
 * - Inline create/edit dialog. Server enforces (material, supplier) uniqueness and
 *   single-preferred via partial unique indexes plus command-level rebalance.
 * - Star icon highlights the preferred supplier; click toggles via update PUT.
 */
export function SuppliersTab({ materialId, organizationId, tenantId }: SuppliersTabProps) {
  const t = useT()
  const { confirm: confirmDialog, ConfirmDialogElement } = useConfirmDialog()
  const [links, setLinks] = React.useState<SupplierLinkRow[]>([])
  const [loading, setLoading] = React.useState(true)
  const [reloadToken, setReloadToken] = React.useState(0)
  const [companies, setCompanies] = React.useState<CompanyOption[]>([])
  const [companiesLoading, setCompaniesLoading] = React.useState(true)
  const [editing, setEditing] = React.useState<SupplierLinkRow | null>(null)
  const [isCreating, setIsCreating] = React.useState(false)
  const [saving, setSaving] = React.useState(false)

  // Load supplier links for this material.
  React.useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        setLoading(true)
        const fallback = { items: [] as SupplierLinkRow[], total: 0, page: 1, totalPages: 1 }
        const call = await apiCall<{ items: SupplierLinkRow[] }>(
          `/api/material-suppliers?materialId=${encodeURIComponent(materialId)}&pageSize=100`,
          undefined,
          { fallback },
        )
        if (cancelled) return
        if (call.ok && call.result) setLinks(call.result.items ?? [])
        else setLinks([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [materialId, reloadToken])

  // Load all companies in the org for the dropdown. Phase 1: top 100 sorted by display_name.
  // Future: filter by supplier role tag, paginate, add typeahead search.
  React.useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        setCompaniesLoading(true)
        const call = await apiCall<{ items: CompanyOption[] }>(
          `/api/customers/companies?pageSize=100&sortField=name&sortDir=asc`,
        )
        if (cancelled) return
        if (call.ok && call.result?.items) {
          setCompanies(
            call.result.items.map((item) => ({
              id: item.id,
              display_name: item.display_name ?? item.id,
            })),
          )
        } else {
          setCompanies([])
        }
      } finally {
        if (!cancelled) setCompaniesLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  const companyName = React.useCallback(
    (id: string): string => {
      const company = companies.find((c) => c.id === id)
      return company?.display_name ?? id
    },
    [companies],
  )

  const formGroups = React.useMemo<CrudFormGroup[]>(
    () => [
      {
        id: 'supplier',
        column: 1,
        title: t('materials.detail.suppliers.section.supplier', 'Supplier'),
        fields: [
          {
            id: 'supplierCompanyId',
            type: 'select',
            label: t('materials.detail.suppliers.field.supplierCompanyId', 'Supplier company'),
            required: true,
            // For edit we lock the supplier — the (material, supplier) pair is the identity
            // and can't be reassigned without delete/create. The form just renders the value.
            disabled: editing !== null,
            options: companies.map((c) => ({ value: c.id, label: c.display_name })),
            helpText: editing
              ? t(
                  'materials.detail.suppliers.field.supplierCompanyId.locked',
                  'Cannot change supplier on an existing link — delete this link and create a new one if you need to switch suppliers.',
                )
              : t(
                  'materials.detail.suppliers.field.supplierCompanyId.help',
                  'Pick a company from your CRM. Companies need to exist in your organization. Phase 1 lists all companies, not only those tagged as suppliers.',
                ),
          },
          {
            id: 'supplierSku',
            type: 'text',
            label: t('materials.detail.suppliers.field.supplierSku', "Supplier's SKU"),
            placeholder: 'SUP-12345',
            maxLength: 64,
            helpText: t(
              'materials.detail.suppliers.field.supplierSku.help',
              "Optional. The code this supplier uses for this material in their catalog.",
            ),
          },
        ],
      },
      {
        id: 'terms',
        column: 2,
        title: t('materials.detail.suppliers.section.terms', 'Terms'),
        fields: [
          {
            id: 'minOrderQty',
            type: 'text',
            label: t('materials.detail.suppliers.field.minOrderQty', 'Minimum order quantity'),
            placeholder: '100',
            helpText: t(
              'materials.detail.suppliers.field.minOrderQty.help',
              'Decimal (up to 6 places). Stored without a unit — assumed to be in the material base unit.',
            ),
          },
          {
            id: 'leadTimeDays',
            type: 'text',
            label: t('materials.detail.suppliers.field.leadTimeDays', 'Lead time (days)'),
            placeholder: '14',
            helpText: t(
              'materials.detail.suppliers.field.leadTimeDays.help',
              'Whole number ≥ 0. Used by procurement to plan replenishment.',
            ),
          },
          {
            id: 'preferred',
            type: 'checkbox',
            label: t(
              'materials.detail.suppliers.field.preferred',
              'Preferred supplier (max one per material)',
            ),
          },
          {
            id: 'notes',
            type: 'textarea',
            label: t('materials.detail.suppliers.field.notes', 'Notes'),
            rows: 3,
            maxLength: 2000,
          },
        ],
      },
    ],
    [companies, editing, t],
  )

  const startCreate = React.useCallback(() => {
    setEditing(null)
    setIsCreating(true)
  }, [])

  const startEdit = React.useCallback((link: SupplierLinkRow) => {
    setIsCreating(false)
    setEditing(link)
  }, [])

  const closeDialog = React.useCallback(() => {
    setEditing(null)
    setIsCreating(false)
  }, [])

  const submitForm = React.useCallback(
    async (values: SupplierLinkFormValues) => {
      setSaving(true)
      try {
        const body: Record<string, unknown> = {
          organizationId,
          tenantId,
          supplierSku: values.supplierSku?.trim() ? values.supplierSku.trim() : null,
          minOrderQty: values.minOrderQty?.trim() ? values.minOrderQty.trim() : null,
          leadTimeDays: values.leadTimeDays?.trim() ? parseInt(values.leadTimeDays.trim(), 10) : null,
          preferred: !!values.preferred,
          notes: values.notes?.trim() ? values.notes.trim() : null,
        }
        if (editing) {
          await apiCallOrThrow('/api/material-suppliers', {
            method: 'PUT',
            body: JSON.stringify({ ...body, id: editing.id }),
            headers: { 'content-type': 'application/json' },
          })
          flash(t('materials.detail.suppliers.update.success', 'Supplier link updated'), 'success')
        } else {
          await apiCallOrThrow('/api/material-suppliers', {
            method: 'POST',
            body: JSON.stringify({
              ...body,
              materialId,
              supplierCompanyId: values.supplierCompanyId,
            }),
            headers: { 'content-type': 'application/json' },
          })
          flash(t('materials.detail.suppliers.create.success', 'Supplier linked'), 'success')
        }
        closeDialog()
        setReloadToken((x) => x + 1)
      } catch {
        flash(
          editing
            ? t('materials.detail.suppliers.update.error', 'Failed to update supplier link')
            : t('materials.detail.suppliers.create.error', 'Failed to link supplier'),
          'error',
        )
      } finally {
        setSaving(false)
      }
    },
    [closeDialog, editing, materialId, organizationId, t, tenantId],
  )

  const togglePreferred = React.useCallback(
    async (link: SupplierLinkRow) => {
      try {
        await apiCallOrThrow('/api/material-suppliers', {
          method: 'PUT',
          body: JSON.stringify({
            id: link.id,
            organizationId,
            tenantId,
            preferred: !link.preferred,
          }),
          headers: { 'content-type': 'application/json' },
        })
        flash(
          link.preferred
            ? t('materials.detail.suppliers.preferred.unset', 'Preferred flag removed')
            : t('materials.detail.suppliers.preferred.set', 'Marked as preferred supplier'),
          'success',
        )
        setReloadToken((x) => x + 1)
      } catch {
        flash(t('materials.detail.suppliers.preferred.error', 'Failed to toggle preferred'), 'error')
      }
    },
    [organizationId, t, tenantId],
  )

  const removeLink = React.useCallback(
    async (link: SupplierLinkRow) => {
      const supplierName = companyName(link.supplier_company_id)
      const confirmed = await confirmDialog({
        title: t('materials.detail.suppliers.delete.title', 'Remove supplier link?'),
        description: t(
          'materials.detail.suppliers.delete.description',
          'The link to "{{supplier}}" will be soft-deleted. Price history attached to this link is preserved.',
        ).replace('{{supplier}}', supplierName),
        confirmText: t('materials.detail.suppliers.delete.confirm', 'Remove'),
        cancelText: t('materials.detail.suppliers.delete.cancel', 'Cancel'),
        variant: 'destructive',
      })
      if (!confirmed) return
      const result = await apiCall<{ ok: boolean; error?: string }>(
        `/api/material-suppliers?id=${encodeURIComponent(link.id)}`,
        { method: 'DELETE' },
      )
      if (!result.ok) {
        const message =
          (result.result as any)?.error ?? t('materials.detail.suppliers.delete.error', 'Failed to remove supplier link')
        flash(message, 'error')
        return
      }
      flash(t('materials.detail.suppliers.delete.success', 'Supplier link removed'), 'success')
      setReloadToken((x) => x + 1)
    },
    [companyName, confirmDialog, t],
  )

  const initialValues = React.useMemo<SupplierLinkFormValues>(
    () =>
      editing
        ? {
            supplierCompanyId: editing.supplier_company_id,
            supplierSku: editing.supplier_sku ?? '',
            minOrderQty: editing.min_order_qty ?? '',
            leadTimeDays: editing.lead_time_days != null ? String(editing.lead_time_days) : '',
            preferred: editing.preferred,
            notes: editing.notes ?? '',
          }
        : {
            supplierCompanyId: companies[0]?.id ?? '',
            supplierSku: '',
            minOrderQty: '',
            leadTimeDays: '',
            preferred: false,
            notes: '',
          },
    [companies, editing],
  )

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">{t('materials.detail.suppliers.title', 'Suppliers')}</h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            {t(
              'materials.detail.suppliers.description',
              'Companies that supply this material. Each material may have one preferred supplier. Prices are attached to the supplier link in Step 8.',
            )}
          </p>
        </div>
        <Button size="sm" className="gap-1" onClick={startCreate} disabled={companiesLoading}>
          <Plus className="h-4 w-4" />
          {t('materials.detail.suppliers.add', 'Link supplier')}
        </Button>
      </div>

      {loading || companiesLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner size="sm" />
          {t('materials.detail.suppliers.loading', 'Loading suppliers…')}
        </div>
      ) : links.length === 0 ? (
        <p className="rounded-md border bg-muted/30 p-4 text-sm text-muted-foreground">
          {t(
            'materials.detail.suppliers.empty',
            'No suppliers linked yet. Add at least one to enable price tracking and procurement.',
          )}
        </p>
      ) : (
        <div className="overflow-hidden rounded-md border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 w-8">
                  <span className="sr-only">{t('materials.detail.suppliers.column.preferred', 'Preferred')}</span>
                </th>
                <th className="px-3 py-2">{t('materials.detail.suppliers.column.company', 'Company')}</th>
                <th className="px-3 py-2">{t('materials.detail.suppliers.column.supplierSku', 'Supplier SKU')}</th>
                <th className="px-3 py-2 text-right">
                  {t('materials.detail.suppliers.column.moq', 'MOQ')}
                </th>
                <th className="px-3 py-2 text-right">
                  {t('materials.detail.suppliers.column.leadTime', 'Lead time')}
                </th>
                <th className="px-3 py-2 text-right" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {links.map((link) => (
                <tr key={link.id} className="hover:bg-muted/20">
                  <td className="px-3 py-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => togglePreferred(link)}
                      aria-label={
                        link.preferred
                          ? t('materials.detail.suppliers.preferred.unsetTitle', 'Unset preferred')
                          : t('materials.detail.suppliers.preferred.setTitle', 'Set as preferred')
                      }
                      title={link.preferred ? 'Preferred supplier' : 'Set as preferred'}
                      className="px-1"
                    >
                      <Star
                        className={`h-4 w-4 ${link.preferred ? 'fill-current text-yellow-500' : 'text-muted-foreground'}`}
                      />
                    </Button>
                  </td>
                  <td className="px-3 py-2 font-medium">
                    {companyName(link.supplier_company_id)}
                    {link.preferred ? (
                      <Badge variant="secondary" className="ml-2">
                        {t('materials.detail.suppliers.flag.preferred', 'Preferred')}
                      </Badge>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{link.supplier_sku ?? '—'}</td>
                  <td className="px-3 py-2 text-right font-mono text-xs">{link.min_order_qty ?? '—'}</td>
                  <td className="px-3 py-2 text-right">
                    {link.lead_time_days != null
                      ? `${link.lead_time_days} ${t('materials.detail.suppliers.column.leadTime.unit', 'days')}`
                      : '—'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => startEdit(link)}>
                        {t('materials.detail.suppliers.actions.edit', 'Edit')}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => removeLink(link)}
                        aria-label={t('materials.detail.suppliers.actions.delete', 'Remove supplier link')}
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
                ? t('materials.detail.suppliers.dialog.editTitle', 'Edit supplier link')
                : t('materials.detail.suppliers.dialog.createTitle', 'Link supplier to material')}
            </DialogTitle>
          </DialogHeader>
          <CrudForm<SupplierLinkFormValues>
            fields={[]}
            groups={formGroups}
            initialValues={initialValues}
            submitLabel={
              editing
                ? t('materials.detail.suppliers.dialog.save', 'Save changes')
                : t('materials.detail.suppliers.dialog.create', 'Link supplier')
            }
            onSubmit={submitForm}
          />
          {saving ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Spinner size="sm" />
              {t('materials.detail.suppliers.dialog.saving', 'Saving…')}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      {ConfirmDialogElement}
    </div>
  )
}

export default SuppliersTab
