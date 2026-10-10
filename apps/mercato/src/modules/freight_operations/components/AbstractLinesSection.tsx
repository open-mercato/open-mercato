"use client"

import * as React from 'react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { formatFreightAmount, formatFreightDate } from './freightOptions'
import { ABSTRACT_DISPUTE_STATUS_FALLBACKS, ABSTRACT_LINE_RESOLUTION_FALLBACKS } from '../lib/freightEnums'

export type AbstractLineRow = {
  id: string
  line_number: number
  trip_id: string
  execution_date?: string | null
  route_code_snapshot?: string | null
  origin: string
  destination: string
  quantity?: string | null
  unit_price_net?: string | null
  base_amount_net?: string | null
  charges_total_net?: string | null
  total_net_amount: string
  tax_amount: string
  total_gross_amount: string
  currency_code: string
  description?: string | null
  is_billable: boolean
  dispute_status: string
  dispute_note?: string | null
  dispute_origin?: string | null
  resolution?: string | null
  resolution_note?: string | null
  adjusted_amount_net?: string | null
}

export function AbstractLinesSection({
  lines,
  currencyCode,
  isLoading,
  isError,
  canRespond,
  canResolve,
  onRespond,
  onResolve,
}: {
  lines: AbstractLineRow[]
  currencyCode: string
  isLoading: boolean
  isError: boolean
  canRespond: boolean
  canResolve: boolean
  onRespond: () => void
  onResolve: () => void
}) {
  const t = useT()

  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">
          {t('freight_operations.abstracts.lines.title', 'Trips on this abstract')}
          <span className="ms-2 text-xs font-normal text-muted-foreground">
            {t('freight_operations.abstracts.lines.count', '{count} lines', { count: lines.length })}
          </span>
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          {canRespond ? (
            <Button type="button" size="sm" onClick={onRespond}>
              {t('freight_operations.abstracts.respond.open', 'Record customer response')}
            </Button>
          ) : null}
          {canResolve ? (
            <Button type="button" size="sm" onClick={onResolve}>
              {t('freight_operations.abstracts.resolve.open', 'Resolve disputes')}
            </Button>
          ) : null}
        </div>
      </div>

      {isLoading ? (
        <LoadingMessage label={t('freight_operations.abstracts.lines.loading', 'Loading lines…')} />
      ) : isError ? (
        <p className="text-sm text-destructive">{t('freight_operations.errors.abstract_lines_load_failed', 'Failed to load abstract lines.')}</p>
      ) : lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('freight_operations.abstracts.lines.empty', 'No trips on this abstract.')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-start text-muted-foreground">
                <th className="py-2 text-start font-medium">{t('freight_operations.abstracts.lines.line', '#')}</th>
                <th className="py-2 text-start font-medium">{t('freight_operations.abstracts.lines.trip', 'Trip')}</th>
                <th className="py-2 text-start font-medium">{t('freight_operations.abstracts.lines.date', 'Executed')}</th>
                <th className="py-2 text-start font-medium">{t('freight_operations.abstracts.lines.lane', 'Lane')}</th>
                <th className="py-2 text-start font-medium">{t('freight_operations.abstracts.lines.net', 'Net')}</th>
                <th className="py-2 text-start font-medium">{t('freight_operations.abstracts.lines.tax', 'VAT')}</th>
                <th className="py-2 text-start font-medium">{t('freight_operations.abstracts.lines.gross', 'Gross')}</th>
                <th className="py-2 text-start font-medium">{t('freight_operations.abstracts.lines.dispute', 'Dispute')}</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.id} className="border-b border-border/60">
                  <td className="py-2">{line.line_number}</td>
                  <td className="py-2">{line.description ?? line.route_code_snapshot ?? '—'}</td>
                  <td className="py-2">{formatFreightDate(line.execution_date)}</td>
                  <td className="py-2">{`${line.origin} → ${line.destination}`}</td>
                  <td className="py-2">
                    <span className="flex min-w-0 flex-col">
                      <span className={line.is_billable ? 'font-medium' : 'text-muted-foreground line-through'}>
                        {formatFreightAmount(line.total_net_amount, currencyCode)}
                      </span>
                      {line.adjusted_amount_net ? (
                        <span className="text-xs text-muted-foreground">
                          {t('freight_operations.abstracts.lines.adjusted', 'adjusted to {amount}', {
                            amount: formatFreightAmount(line.adjusted_amount_net, currencyCode),
                          })}
                        </span>
                      ) : null}
                    </span>
                  </td>
                  <td className="py-2">{formatFreightAmount(line.tax_amount, currencyCode)}</td>
                  <td className="py-2 font-medium">{formatFreightAmount(line.total_gross_amount, currencyCode)}</td>
                  <td className="py-2">
                    <span className="flex min-w-0 flex-col gap-1">
                      <Badge variant="secondary">
                        {t(`freight_operations.abstracts.dispute_status.${line.dispute_status}`, ABSTRACT_DISPUTE_STATUS_FALLBACKS[line.dispute_status] ?? line.dispute_status)}
                      </Badge>
                      {line.dispute_note ? (
                        <span className="text-xs text-muted-foreground">{line.dispute_note}</span>
                      ) : null}
                      {line.resolution ? (
                        <span className="text-xs text-muted-foreground">
                          {t(`freight_operations.abstracts.line_resolution.${line.resolution}`, ABSTRACT_LINE_RESOLUTION_FALLBACKS[line.resolution] ?? line.resolution)}
                          {line.resolution_note ? ` — ${line.resolution_note}` : ''}
                        </span>
                      ) : null}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
