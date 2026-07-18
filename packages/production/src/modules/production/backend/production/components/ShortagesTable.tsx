'use client'

import * as React from 'react'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@open-mercato/ui/primitives/table'
import type { useT } from '@open-mercato/shared/lib/i18n/context'

export type ShortageLine = {
  componentProductId: string
  variantId: string | null
  qtyRequired: number
  qtyAvailable: number
  qtyShort: number
  uom: string
  reason: 'no_stock_item' | 'uom_mismatch' | 'insufficient_stock'
}

/**
 * Material shortage list (release-time snapshot or on-demand recompute via
 * `GET /api/production/orders/[id]/shortages`, task 3.4).
 */
export function ShortagesTable({ lines, t }: { lines: ShortageLine[]; t: ReturnType<typeof useT> }) {
  if (lines.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {t('production.orders.shortages.empty', 'No material shortages.')}
      </p>
    )
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('production.orders.shortages.field.product_id', 'Product')}</TableHead>
          <TableHead>{t('production.orders.shortages.field.required', 'Required')}</TableHead>
          <TableHead>{t('production.orders.shortages.field.available', 'Available')}</TableHead>
          <TableHead>{t('production.orders.shortages.field.short', 'Short')}</TableHead>
          <TableHead>{t('production.orders.shortages.field.uom', 'UoM')}</TableHead>
          <TableHead>{t('production.orders.shortages.field.reason', 'Reason')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {lines.map((line, index) => (
          <TableRow key={`${line.componentProductId}-${line.variantId ?? 'none'}-${index}`}>
            <TableCell>{line.componentProductId}</TableCell>
            <TableCell>{line.qtyRequired}</TableCell>
            <TableCell>{line.qtyAvailable}</TableCell>
            <TableCell>{line.qtyShort}</TableCell>
            <TableCell>{line.uom}</TableCell>
            <TableCell>{t(`production.shortages.reason.${line.reason}`, line.reason)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
