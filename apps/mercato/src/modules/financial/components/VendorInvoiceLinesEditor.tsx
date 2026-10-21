'use client'

import * as React from 'react'
import type { CrudCustomFieldRenderProps } from '@open-mercato/ui/backend/CrudForm'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@open-mercato/ui/primitives/select'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useExpenseAccountOptions } from './apOptions'

export type VendorInvoiceLineValue = {
  description: string
  expenseAccountId: string
  quantity: string
  unitPriceNet: string
  taxRate: string
  taxCode: string
}

export function emptyVendorInvoiceLine(): VendorInvoiceLineValue {
  return { description: '', expenseAccountId: '', quantity: '1', unitPriceNet: '0', taxRate: '15', taxCode: 'SA-VAT-S' }
}

function computeLine(line: VendorInvoiceLineValue) {
  const quantity = Number(line.quantity) || 0
  const unitPrice = Number(line.unitPriceNet) || 0
  const net = quantity * unitPrice
  const tax = net * ((Number(line.taxRate) || 0) / 100)
  return { net, tax, gross: net + tax }
}

export default function VendorInvoiceLinesEditor({ value, setValue, error }: CrudCustomFieldRenderProps) {
  const t = useT()
  const { accounts } = useExpenseAccountOptions()
  const lines = React.useMemo<VendorInvoiceLineValue[]>(
    () => (Array.isArray(value) ? (value as VendorInvoiceLineValue[]) : []),
    [value],
  )

  const update = (index: number, patch: Partial<VendorInvoiceLineValue>) => {
    setValue(lines.map((line, current) => (current === index ? { ...line, ...patch } : line)))
  }
  const add = () => setValue([...lines, emptyVendorInvoiceLine()])
  const remove = (index: number) => setValue(lines.filter((_line, current) => current !== index))

  const totals = lines.reduce(
    (total, line) => {
      const computed = computeLine(line)
      return { net: total.net + computed.net, tax: total.tax + computed.tax, gross: total.gross + computed.gross }
    },
    { net: 0, tax: 0, gross: 0 },
  )

  return (
    <div className="space-y-3">
      {lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('financial.ap.invoices.form.lines.empty', 'Add at least one line.')}</p>
      ) : null}
      {lines.map((line, index) => {
        const computed = computeLine(line)
        return (
          <div key={index} className="grid gap-2 rounded-md border border-border p-3 md:grid-cols-12">
            <div className="md:col-span-4">
              <label className="text-xs text-muted-foreground">{t('financial.ap.invoices.form.lines.description', 'Description')}</label>
              <Input value={line.description} onChange={(event) => update(index, { description: event.target.value })} />
            </div>
            <div className="md:col-span-4">
              <label className="text-xs text-muted-foreground">{t('financial.ap.invoices.form.lines.account', 'Expense account')}</label>
              <Select
                value={line.expenseAccountId}
                onValueChange={(value) => update(index, { expenseAccountId: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('financial.ap.invoices.form.lines.accountNone', 'Select an account')} />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((account) => (
                    <SelectItem key={account.id} value={account.id}>{account.code} — {account.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-1">
              <label className="text-xs text-muted-foreground">{t('financial.ap.invoices.form.lines.quantity', 'Qty')}</label>
              <Input value={line.quantity} onChange={(event) => update(index, { quantity: event.target.value })} />
            </div>
            <div className="md:col-span-1">
              <label className="text-xs text-muted-foreground">{t('financial.ap.invoices.form.lines.unitPrice', 'Unit price')}</label>
              <Input value={line.unitPriceNet} onChange={(event) => update(index, { unitPriceNet: event.target.value })} />
            </div>
            <div className="md:col-span-1">
              <label className="text-xs text-muted-foreground">{t('financial.ap.invoices.form.lines.taxRate', 'Tax %')}</label>
              <Input value={line.taxRate} onChange={(event) => update(index, { taxRate: event.target.value })} />
            </div>
            <div className="md:col-span-1">
              <label className="text-xs text-muted-foreground">{t('financial.ap.invoices.form.lines.taxCode', 'Tax code')}</label>
              <Input value={line.taxCode} onChange={(event) => update(index, { taxCode: event.target.value })} />
            </div>
            <div className="flex items-end justify-end md:col-span-1">
              <Button type="button" variant="outline" size="sm" onClick={() => remove(index)}>
                {t('financial.ap.invoices.form.lines.remove', 'Remove')}
              </Button>
            </div>
            <div className="text-xs text-muted-foreground md:col-span-12">
              {t('financial.ap.invoices.form.lines.computed', 'Net {net} · Tax {tax} · Gross {gross}', {
                net: computed.net.toFixed(2),
                tax: computed.tax.toFixed(2),
                gross: computed.gross.toFixed(2),
              })}
            </div>
          </div>
        )
      })}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button type="button" variant="outline" onClick={add}>
          {t('financial.ap.invoices.form.lines.add', 'Add line')}
        </Button>
        <p className="text-sm font-medium">
          {t('financial.ap.invoices.form.lines.totals', 'Net {net} · Tax {tax} · Gross {gross}', {
            net: totals.net.toFixed(2),
            tax: totals.tax.toFixed(2),
            gross: totals.gross.toFixed(2),
          })}
        </p>
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  )
}
