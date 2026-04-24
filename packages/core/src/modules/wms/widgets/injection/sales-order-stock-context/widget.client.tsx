'use client'

import Link from 'next/link'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  StatusBadge,
  type StatusMap,
} from '@open-mercato/ui/primitives/status-badge'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'

type ReservationStatus =
  | 'unreserved'
  | 'partially_reserved'
  | 'fully_reserved'

type SalesOrderWmsPayload = {
  assignedWarehouseId?: string | null
  stockSummary?: Array<{
    catalogVariantId?: string
    available?: string
    reserved?: string
  }>
  reservationSummary?: {
    status?: ReservationStatus
    reservationIds?: string[]
  }
}

export type SalesOrderRecord = Record<string, unknown> & {
  _wms?: SalesOrderWmsPayload
}

const reservationStatusMap: StatusMap<ReservationStatus> = {
  unreserved: 'neutral',
  partially_reserved: 'warning',
  fully_reserved: 'success',
}

function formatQuantity(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value.toString()
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    return value
  }
  return '0'
}

export default function SalesOrderStockContextWidget(
  props: InjectionWidgetComponentProps<unknown, SalesOrderRecord>,
) {
  const { data } = props
  const t = useT()
  const wms = data?._wms
  if (!wms) return null

  const reservationStatus =
    wms.reservationSummary?.status ?? 'unreserved'
  const reservationIds = Array.isArray(wms.reservationSummary?.reservationIds)
    ? wms.reservationSummary?.reservationIds
    : []
  const stockSummary = Array.isArray(wms.stockSummary)
    ? wms.stockSummary
    : []

  return (
    <div className="rounded-lg border bg-card px-4 py-3 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-sm font-medium">
            {t(
              'wms.widgets.sales.stockContext.title',
              'WMS stock context',
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            {t(
              'wms.widgets.sales.stockContext.description',
              'Live reservation and availability summary for this sales order.',
            )}
          </p>
        </div>
        <StatusBadge
          variant={reservationStatusMap[reservationStatus]}
          dot
        >
          {t(
            `wms.widgets.sales.stockContext.status.${reservationStatus}`,
            reservationStatus,
          )}
        </StatusBadge>
      </div>

      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <div className="space-y-1">
          <dt className="text-xs text-muted-foreground">
            {t(
              'wms.widgets.sales.stockContext.assignedWarehouse',
              'Assigned warehouse',
            )}
          </dt>
          <dd className="font-medium">
            {wms.assignedWarehouseId ||
              t(
                'wms.widgets.sales.stockContext.unassigned',
                'Not assigned',
              )}
          </dd>
        </div>
        <div className="space-y-1">
          <dt className="text-xs text-muted-foreground">
            {t(
              'wms.widgets.sales.stockContext.reservationCount',
              'Reservation records',
            )}
          </dt>
          <dd className="font-medium">{reservationIds.length}</dd>
        </div>
      </dl>

      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t(
            'wms.widgets.sales.stockContext.linesTitle',
            'Variant availability',
          )}
        </p>
        {stockSummary.length > 0 ? (
          <div className="space-y-2">
            {stockSummary.map((item) => (
              <div
                key={item.catalogVariantId ?? 'unknown'}
                className="rounded-md border border-border/70 bg-background px-3 py-2"
              >
                <p className="text-sm font-medium break-all">
                  {item.catalogVariantId}
                </p>
                <div className="mt-1 flex flex-wrap gap-4 text-xs text-muted-foreground">
                  <span>
                    {t(
                      'wms.widgets.sales.stockContext.available',
                      'Available',
                    )}
                    {': '}
                    {formatQuantity(item.available)}
                  </span>
                  <span>
                    {t(
                      'wms.widgets.sales.stockContext.reserved',
                      'Reserved',
                    )}
                    {': '}
                    {formatQuantity(item.reserved)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t(
              'wms.widgets.sales.stockContext.empty',
              'No WMS stock summary is available for this order yet.',
            )}
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline" size="sm">
          <Link href="/backend/wms/inventory">
            {t(
              'wms.widgets.sales.stockContext.actions.inventory',
              'Open inventory console',
            )}
          </Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link href="/backend/wms/reservations">
            {t(
              'wms.widgets.sales.stockContext.actions.reservations',
              'Open reservations',
            )}
          </Link>
        </Button>
      </div>
    </div>
  )
}
