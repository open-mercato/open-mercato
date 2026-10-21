'use client'

import * as React from 'react'
import { CrudForm, type CrudField, type CrudFormGroup } from '@open-mercato/ui/backend/CrudForm'
import { ErrorMessage, LoadingMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { createCrud, fetchCrudList, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { withFlash } from '@open-mercato/ui/backend/utils/flash'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useVendorOptions } from './apOptions'
import VendorInvoiceLinesEditor, { emptyVendorInvoiceLine, type VendorInvoiceLineValue } from './VendorInvoiceLinesEditor'

const ENTITY_ID = 'financial:ap_vendor_invoice'
const LIST_HREF = '/backend/financial/payables/invoices'
const RESOURCE = 'financial/ap/invoices'

export type VendorInvoiceFormValues = {
  id: string
  vendorId: string
  internalNumber: string
  vendorInvoiceNumber: string
  issueDate: string
  dueDate: string
  currencyCode: string
  withholdingCode: string
  notes: string
  lines: VendorInvoiceLineValue[]
  updatedAt?: string | null
}

export function emptyVendorInvoiceForm(): VendorInvoiceFormValues {
  return {
    id: '',
    vendorId: '',
    internalNumber: '',
    vendorInvoiceNumber: '',
    issueDate: new Date().toISOString().slice(0, 10),
    dueDate: '',
    currencyCode: 'SAR',
    withholdingCode: '',
    notes: '',
    lines: [emptyVendorInvoiceLine()],
    updatedAt: null,
  }
}

export function toVendorInvoicePayload(values: VendorInvoiceFormValues): Record<string, unknown> {
  const optional = (value: string) => (value.trim().length > 0 ? value.trim() : null)
  return {
    vendorId: values.vendorId,
    internalNumber: optional(values.internalNumber),
    vendorInvoiceNumber: optional(values.vendorInvoiceNumber),
    issueDate: values.issueDate,
    dueDate: optional(values.dueDate),
    currencyCode: values.currencyCode.trim().toUpperCase(),
    withholdingCode: optional(values.withholdingCode),
    notes: optional(values.notes),
    lines: values.lines.map((line) => ({
      description: line.description.trim(),
      expenseAccountId: line.expenseAccountId,
      quantity: line.quantity,
      unitPriceNet: line.unitPriceNet,
      taxRate: line.taxRate,
      taxCode: optional(line.taxCode),
    })),
  }
}

type LineRow = {
  description: string
  expense_account_id: string
  quantity: string
  unit_price_net: string
  tax_rate: string
  tax_code: string | null
}

function useInvoiceFields(
  t: ReturnType<typeof useT>,
  vendorOptions: Array<{ value: string; label: string }>,
): CrudField[] {
  return React.useMemo(() => [
    {
      id: 'vendorId',
      label: t('financial.ap.invoices.form.vendor', 'Vendor'),
      type: 'select',
      required: true,
      options: vendorOptions,
    },
    { id: 'internalNumber', label: t('financial.ap.invoices.form.internalNumber', 'Internal number'), type: 'text' },
    { id: 'vendorInvoiceNumber', label: t('financial.ap.invoices.form.vendorInvoiceNumber', 'Vendor invoice number'), type: 'text' },
    { id: 'issueDate', label: t('financial.ap.invoices.form.issueDate', 'Issue date'), type: 'date', required: true },
    { id: 'dueDate', label: t('financial.ap.invoices.form.dueDate', 'Due date'), type: 'date' },
    { id: 'currencyCode', label: t('financial.ap.invoices.form.currency', 'Currency'), type: 'text', required: true },
    { id: 'withholdingCode', label: t('financial.ap.invoices.form.withholdingCode', 'Withholding category'), type: 'text' },
    { id: 'notes', label: t('financial.ap.invoices.form.notes', 'Notes'), type: 'textarea' },
    {
      id: 'lines',
      label: t('financial.ap.invoices.form.lines.label', 'Invoice lines'),
      type: 'custom',
      component: VendorInvoiceLinesEditor,
      rendersOwnError: true,
      required: true,
    },
  ], [t, vendorOptions])
}

function useInvoiceGroups(t: ReturnType<typeof useT>): CrudFormGroup[] {
  return React.useMemo(() => [
    { id: 'header', title: t('financial.ap.invoices.form.groups.header', 'Invoice'), column: 1, fields: ['vendorId', 'internalNumber', 'vendorInvoiceNumber', 'issueDate', 'dueDate', 'currencyCode', 'withholdingCode', 'notes'] },
    { id: 'lines', title: t('financial.ap.invoices.form.groups.lines', 'Lines'), column: 1, fields: ['lines'] },
  ], [t])
}

export function VendorInvoiceCreateForm() {
  const t = useT()
  const { vendors } = useVendorOptions()
  const vendorOptions = React.useMemo(
    () => vendors.map((vendor) => ({ value: vendor.id, label: `${vendor.code} — ${vendor.name}` })),
    [vendors],
  )
  const fields = useInvoiceFields(t, vendorOptions)
  const groups = useInvoiceGroups(t)
  return (
    <CrudForm<VendorInvoiceFormValues>
      title={t('financial.ap.invoices.form.create.title', 'New vendor invoice')}
      titleHeadingLevel={1}
      backHref={LIST_HREF}
      entityId={ENTITY_ID}
      fields={fields}
      groups={groups}
      initialValues={emptyVendorInvoiceForm()}
      submitLabel={t('financial.ap.invoices.form.create.submit', 'Create draft')}
      cancelHref={LIST_HREF}
      successRedirect={withFlash(LIST_HREF, t('financial.ap.invoices.form.flash.saved', 'Vendor invoice saved.'), 'success')}
      onSubmit={async (values) => { await createCrud(RESOURCE, toVendorInvoicePayload(values)) }}
    />
  )
}

export function VendorInvoiceEditForm({ id }: { id: string }) {
  const t = useT()
  const { vendors } = useVendorOptions()
  const vendorOptions = React.useMemo(
    () => vendors.map((vendor) => ({ value: vendor.id, label: `${vendor.code} — ${vendor.name}` })),
    [vendors],
  )
  const fields = useInvoiceFields(t, vendorOptions)
  const groups = useInvoiceGroups(t)
  const [initial, setInitial] = React.useState<VendorInvoiceFormValues | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [notFound, setNotFound] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      try {
        const [invoices, lines] = await Promise.all([
          fetchCrudList<Record<string, unknown>>(RESOURCE, { ids: id, pageSize: 1 }),
          apiCall<{ items?: LineRow[] }>(`/api/financial/ap/invoices/lines?id=${id}`),
        ])
        const invoice = invoices?.items?.[0]
        if (!invoice) { if (!cancelled) setNotFound(true); return }
        const lineRows = lines.ok ? (lines.result?.items ?? []) : []
        if (!cancelled) {
          setInitial({
            id,
            vendorId: String(invoice.vendor_id ?? ''),
            internalNumber: String(invoice.internal_number ?? ''),
            vendorInvoiceNumber: String(invoice.vendor_invoice_number ?? ''),
            issueDate: String(invoice.issue_date ?? '').slice(0, 10),
            dueDate: String(invoice.due_date ?? '').slice(0, 10),
            currencyCode: String(invoice.currency_code ?? 'SAR'),
            withholdingCode: String(invoice.withholding_code ?? ''),
            notes: String(invoice.notes ?? ''),
            lines: lineRows.length > 0
              ? lineRows.map((line) => ({
                description: line.description,
                expenseAccountId: line.expense_account_id,
                quantity: line.quantity,
                unitPriceNet: line.unit_price_net,
                taxRate: line.tax_rate,
                taxCode: line.tax_code ?? '',
              }))
              : [emptyVendorInvoiceLine()],
            updatedAt: (invoice.updatedAt ?? invoice.updated_at ?? null) as string | null,
          })
        }
      } catch {
        if (!cancelled) setError(t('financial.ap.invoices.form.error.load', 'Could not load the vendor invoice.'))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [id, t])

  if (notFound) return <RecordNotFoundState label={t('financial.ap.invoices.form.error.notFound', 'Vendor invoice not found.')} backHref={LIST_HREF} backLabel={t('financial.ap.invoices.actions.back', 'Back to invoices')} />
  if (error) return <ErrorMessage label={error} />
  if (loading) return <LoadingMessage label={t('financial.ap.invoices.form.loading', 'Loading vendor invoice…')} />

  return (
    <CrudForm<VendorInvoiceFormValues>
      title={t('financial.ap.invoices.form.edit.title', 'Edit vendor invoice')}
      titleHeadingLevel={1}
      backHref={LIST_HREF}
      entityId={ENTITY_ID}
      fields={fields}
      groups={groups}
      initialValues={initial ?? { ...emptyVendorInvoiceForm(), id }}
      submitLabel={t('financial.ap.invoices.form.edit.submit', 'Save changes')}
      cancelHref={LIST_HREF}
      successRedirect={withFlash(LIST_HREF, t('financial.ap.invoices.form.flash.saved', 'Vendor invoice saved.'), 'success')}
      onSubmit={async (values) => { await updateCrud(RESOURCE, { id, ...toVendorInvoicePayload(values) }) }}
    />
  )
}
