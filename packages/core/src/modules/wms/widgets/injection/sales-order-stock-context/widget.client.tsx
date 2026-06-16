'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  StatusBadge,
  type StatusMap,
} from '@open-mercato/ui/primitives/status-badge'
import { ComboboxInput } from '@open-mercato/ui/backend/inputs/ComboboxInput'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { raiseCrudError } from '@open-mercato/ui/backend/utils/serverErrors'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeDetail } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { useWmsInventoryMutationAccess } from '../../../components/backend/useWmsInventoryMutationAccess'
import { loadWarehouseOptions } from '../../../components/backend/wmsLookupLoaders'

type ReservationStatus =
  | 'unreserved'
  | 'partially_reserved'
  | 'fully_reserved'

type SalesOrderWmsPayload = {
  assignedWarehouseId?: string | null
  assignedWarehouseName?: string | null
  isExplicitlyAssigned?: boolean
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
  id?: string
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

function resolveOrderId(data: SalesOrderRecord | undefined): string | null {
  return typeof data?.id === 'string' && data.id.length > 0 ? data.id : null
}

export default function SalesOrderStockContextWidget(
  props: InjectionWidgetComponentProps<unknown, SalesOrderRecord>,
) {
  const { data } = props
  const t = useT()
  const router = useRouter()
  const { organizationId, tenantId } = useOrganizationScopeDetail()
  const access = useWmsInventoryMutationAccess()
  const orderId = resolveOrderId(data)
  const wms = data?._wms
  const [selectedWarehouseId, setSelectedWarehouseId] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)

  const { runMutation, retryLastMutation } = useGuardedMutation({
    contextId: 'wms-sales-order-warehouse-assignment',
  })
  const mutationContext = React.useMemo(
    () => ({ retryLastMutation }),
    [retryLastMutation],
  )

  React.useEffect(() => {
    if (wms?.isExplicitlyAssigned && wms.assignedWarehouseId) {
      setSelectedWarehouseId(wms.assignedWarehouseId)
      return
    }
    setSelectedWarehouseId(null)
  }, [wms?.assignedWarehouseId, wms?.isExplicitlyAssigned])

  const canManageAssignment = access.canRelease
  const assignedLabel =
    wms?.assignedWarehouseName ||
    (wms?.isExplicitlyAssigned ? wms.assignedWarehouseId : null) ||
    t('wms.widgets.sales.stockContext.unassigned', 'Not assigned')

  const persistAssignment = React.useCallback(
    async (warehouseId: string | null) => {
      if (!orderId || !organizationId || !tenantId) return
      setSaving(true)
      try {
        const mutationPayload = {
          organizationId,
          tenantId,
          warehouseId,
        }
        await runMutation({
          operation: async () => {
            if (warehouseId) {
              const response = await apiCall<{ ok?: boolean }>(
                `/api/wms/sales-orders/${orderId}/warehouse-assignment`,
                {
                  method: 'PUT',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify(mutationPayload),
                },
              )
              if (!response.ok) await raiseCrudError(response.response)
            } else {
              const response = await apiCall<{ ok?: boolean }>(
                `/api/wms/sales-orders/${orderId}/warehouse-assignment`,
                {
                  method: 'DELETE',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({
                    organizationId,
                    tenantId,
                  }),
                },
              )
              if (!response.ok) await raiseCrudError(response.response)
            }
          },
          context: mutationContext,
          mutationPayload,
        })

        router.refresh()
        flash(
          warehouseId
            ? t(
                'wms.widgets.sales.stockContext.assignSuccess',
                'Warehouse assignment saved.',
              )
            : t(
                'wms.widgets.sales.stockContext.unassignSuccess',
                'Warehouse assignment cleared.',
              ),
          'success',
        )
      } catch {
        flash(
          t(
            'wms.widgets.sales.stockContext.assignError',
            'Could not update warehouse assignment.',
          ),
          'error',
        )
      } finally {
        setSaving(false)
      }
    },
    [mutationContext, orderId, organizationId, router, runMutation, t, tenantId],
  )

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
        <div className="space-y-2 sm:col-span-2">
          <dt className="text-xs text-muted-foreground">
            {t(
              'wms.widgets.sales.stockContext.assignedWarehouse',
              'Assigned warehouse',
            )}
          </dt>
          <dd>
            {canManageAssignment && orderId ? (
              <ComboboxInput
                value={selectedWarehouseId ?? ''}
                onChange={(value) => {
                  const nextValue = value.trim().length > 0 ? value : null
                  setSelectedWarehouseId(nextValue)
                  void persistAssignment(nextValue)
                }}
                loadSuggestions={async (query) => {
                  const options = await loadWarehouseOptions(query)
                  return options.map((option) => ({
                    value: option.value,
                    label: option.label,
                  }))
                }}
                placeholder={t(
                  'wms.widgets.sales.stockContext.warehousePlaceholder',
                  'Select a warehouse',
                )}
                allowCustomValues={false}
                disabled={saving}
              />
            ) : (
              <span className="font-medium">{assignedLabel}</span>
            )}
          </dd>
          {wms.isExplicitlyAssigned ? (
            <p className="text-xs text-muted-foreground">
              {t(
                'wms.widgets.sales.stockContext.explicitAssignmentHint',
                'Explicit assignment overrides reservation-derived warehouse context.',
              )}
            </p>
          ) : null}
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
