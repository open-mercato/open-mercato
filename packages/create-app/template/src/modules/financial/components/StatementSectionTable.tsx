'use client'

import * as React from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@open-mercato/ui/primitives/card'
import { useT } from '@open-mercato/shared/lib/i18n/context'

/**
 * One side of a statement.
 *
 * A row's amount is whichever column the builder put it in — it presents a
 * negative balance on the opposite side rather than as a negative figure, which is
 * how an accountant reads a contra account. So the screen renders the non-zero
 * column and does **no arithmetic of its own**: every figure it shows, including
 * the section total, is a decimal string the builder produced.
 */
export type StatementRow = {
  accountId: string
  code: string
  name: string
  debit: string
  credit: string
}

export type StatementSectionData = {
  rows: StatementRow[]
  total: string
}

const ZERO = /^0(?:\.0+)?$/

function rowAmount(row: StatementRow): string {
  return ZERO.test(row.debit) ? row.credit : row.debit
}

export default function StatementSectionTable({
  title,
  section,
  currencyCode,
  emptyLabel,
}: {
  title: string
  section: StatementSectionData
  currencyCode: string | null
  emptyLabel: string
}) {
  const t = useT()

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {section.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{emptyLabel}</p>
        ) : (
          <table className="w-full text-sm">
            <tbody>
              {section.rows.map((row) => (
                <tr key={row.accountId} className="border-b border-border/50 last:border-0">
                  <td className="py-1.5 pe-3 font-mono text-xs text-muted-foreground">{row.code}</td>
                  <td className="py-1.5 pe-3">{row.name}</td>
                  <td className="py-1.5 text-end tabular-nums">{rowAmount(row)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border font-medium">
                <td className="py-2" colSpan={2}>
                  {t('financial.statements.columns.total', 'Total')}
                </td>
                <td className="py-2 text-end tabular-nums">
                  {section.total}
                  {currencyCode ? ` ${currencyCode}` : ''}
                </td>
              </tr>
            </tfoot>
          </table>
        )}
      </CardContent>
    </Card>
  )
}
