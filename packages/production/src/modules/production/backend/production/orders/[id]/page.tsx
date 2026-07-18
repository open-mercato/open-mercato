'use client'

import * as React from 'react'
import type { z } from 'zod'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { updateCrud, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { apiCall, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { LoadingMessage, ErrorMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { Card, CardHeader, CardTitle, CardContent } from '@open-mercato/ui/primitives/card'
import { Button } from '@open-mercato/ui/primitives/button'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@open-mercato/ui/primitives/table'
import { orderUpdateSchema } from '../../../../data/validators.js'
import { OrderStatusBadge, type OrderStatus } from '../../components/OrderStatusBadge'
import { ShortagesTable, type ShortageLine } from '../../components/ShortagesTable'

const orderEditSchema = orderUpdateSchema.omit({ id: true })
type OrderEditValues = z.infer<typeof orderEditSchema>

type OrderOperation = {
  id: string
  sequence: number
  name: string
  workCenterId: string
  setupTimeMinutes: string
  runTimePerUnitSeconds: string
  isReportingPoint: boolean
  status: 'pending' | 'in_progress' | 'done'
  qtyGood: string
  qtyScrap: string
}

type OrderMaterial = {
  id: string
  operationSequence: number | null
  componentProductId: string
  componentVariantId: string | null
  qtyRequired: string
  uom: string
  scrapFactor: string
  qtyIssued: string
  reservedQty: number
}

type OrderDetail = {
  id: string
  number: number
  productId: string
  variantId: string | null
  qtyPlanned: string
  uom: string
  dueDate: string | null
  priority: number
  status: OrderStatus
  sourceType: 'sales_order' | 'mrp' | 'manual'
  sourceId: string | null
  releasedAt: string | null
  qtyCompleted: string
  qtyScrapped: string
  createdAt: string
  updatedAt: string
  operations: OrderOperation[]
  materials: OrderMaterial[]
}

const EDITABLE_STATUSES: OrderStatus[] = ['draft', 'planned']

/**
 * Extracts the server's already-translated business-rule message from an
 * action-route error (e.g. the cancel-blocked-with-partial-issue 409 body
 * `{ error: '...' }`, which is not an optimistic-lock conflict and is never
 * consumed by `surfaceRecordConflict`). `runOrderAction`/`handleDelete` throw
 * `Object.assign(new Error(...), { status, ...body })` on a non-ok response
 * (mirrors `mapCrudServerErrorToFormErrors`'s own `error`/`message` read
 * order), so the server's `error` string lands as a top-level property.
 * Falls back to `null` so callers can use their generic per-action message.
 */
function extractServerErrorMessage(err: unknown): string | null {
  if (!err || typeof err !== 'object') return null
  const candidate = err as { error?: unknown; message?: unknown }
  if (typeof candidate.error === 'string' && candidate.error.trim()) return candidate.error
  if (
    typeof candidate.message === 'string' &&
    candidate.message.trim() &&
    !candidate.message.startsWith('[internal]')
  ) {
    return candidate.message
  }
  return null
}

export default function ProductionOrderDetailPage({ params }: { params?: { id?: string } }) {
  const t = useT()
  const router = useRouter()
  const { confirm: confirmDialog, ConfirmDialogElement } = useConfirmDialog()

  const [record, setRecord] = React.useState<OrderDetail | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [isNotFound, setIsNotFound] = React.useState(false)

  const [releaseResult, setReleaseResult] = React.useState<{ reservations: number; shortages: ShortageLine[] } | null>(null)
  const [shortages, setShortages] = React.useState<ShortageLine[] | null>(null)
  const [shortagesLoading, setShortagesLoading] = React.useState(false)

  const mutationContextId = 'production-order-detail:mutation'
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: mutationContextId,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  const loadRecord = React.useCallback(async () => {
    if (!params?.id) return
    setLoading(true)
    try {
      const call = await apiCall<OrderDetail>(`/api/production/orders/${params.id}`)
      if (call.ok && call.result) {
        setRecord(call.result)
      } else if (call.status === 404) {
        setIsNotFound(true)
      } else {
        setError(t('production.orders.error.load_failed', 'Failed to load production order'))
      }
    } catch {
      setError(t('production.orders.error.load_failed', 'Failed to load production order'))
    } finally {
      setLoading(false)
    }
  }, [params?.id, t])

  React.useEffect(() => {
    loadRecord()
  }, [loadRecord])

  const loadShortages = React.useCallback(async () => {
    if (!record) return
    setShortagesLoading(true)
    try {
      const call = await apiCall<{ lines: ShortageLine[] }>(`/api/production/orders/${record.id}/shortages`)
      if (call.ok && call.result) {
        setShortages(call.result.lines)
      } else {
        flash(t('production.orders.error.shortages_failed', 'Failed to load material shortages'), 'error')
      }
    } catch {
      flash(t('production.orders.error.shortages_failed', 'Failed to load material shortages'), 'error')
    } finally {
      setShortagesLoading(false)
    }
  }, [record, t])

  const runOrderAction = React.useCallback(
    async (action: 'plan' | 'release' | 'cancel' | 'close') => {
      if (!record) return
      try {
        const call = await runMutation({
          operation: async () => {
            const result = await withScopedApiRequestHeaders(
              buildOptimisticLockHeader(record.updatedAt),
              () => apiCall(`/api/production/orders/${record.id}/${action}`, { method: 'POST' }),
            )
            if (!result.ok) {
              throw Object.assign(new Error(`[internal] production.orders.${action} failed`), {
                status: result.status,
                ...((result.result as Record<string, unknown> | null) ?? {}),
              })
            }
            return result
          },
          context: { formId: mutationContextId, resourceKind: 'production.order', resourceId: record.id, retryLastMutation },
          mutationPayload: { id: record.id },
        })
        if (action === 'release') {
          const payload = call.result as { reservations?: number; shortages?: ShortageLine[] } | null
          setReleaseResult({
            reservations: payload?.reservations ?? 0,
            shortages: payload?.shortages ?? [],
          })
        }
        flash(
          t(`production.orders.success.${action}`, `Production order ${action} succeeded`),
          'success',
        )
        await loadRecord()
      } catch (error) {
        if (surfaceRecordConflict(error, t, { onRefresh: () => loadRecord() })) return
        const serverMessage = extractServerErrorMessage(error)
        flash(serverMessage ?? t(`production.orders.error.${action}_failed`, `Failed to ${action} the production order`), 'error')
      }
    },
    [record, t, mutationContextId, retryLastMutation, runMutation, loadRecord],
  )

  const handleCancel = React.useCallback(async () => {
    const confirmed = await confirmDialog({
      title: t('production.orders.confirm.cancel', 'Are you sure you want to cancel this production order?'),
      variant: 'destructive',
    })
    if (!confirmed) return
    await runOrderAction('cancel')
  }, [confirmDialog, t, runOrderAction])

  const handleDelete = React.useCallback(async () => {
    if (!record) return
    const confirmed = await confirmDialog({
      title: t('production.orders.confirm.delete', 'Are you sure you want to delete this production order?'),
      variant: 'destructive',
    })
    if (!confirmed) return
    try {
      // CrudForm's own onDelete wraps with the optimistic-lock header via
      // `optimisticLockUpdatedAt`; this is a standalone delete button (not
      // rendered through CrudForm), so wrap manually to match the same
      // aggregate consistency check (parent order updated_at, spec §
      // Concurrency). Routed through `runMutation` (not a bare `deleteCrud`
      // call) so onBeforeSave/onAfterSave injection hooks fire for this
      // destructive action, matching AGENTS.md's non-CrudForm-write contract
      // and `runOrderAction`'s own pattern.
      await runMutation({
        operation: () =>
          withScopedApiRequestHeaders(
            buildOptimisticLockHeader(record.updatedAt),
            () => deleteCrud('production/orders', { id: record.id }),
          ),
        context: { formId: mutationContextId, resourceKind: 'production.order', resourceId: record.id, retryLastMutation },
        mutationPayload: { id: record.id },
      })
      flash(t('production.orders.success.deleted', 'Production order deleted successfully'), 'success')
      router.push('/backend/production/orders')
    } catch (err) {
      if (surfaceRecordConflict(err, t)) return
      const serverMessage = extractServerErrorMessage(err)
      flash(serverMessage ?? t('production.orders.error.delete_failed', 'Failed to delete production order'), 'error')
    }
  }, [record, t, confirmDialog, router, mutationContextId, retryLastMutation, runMutation])

  const editFields = React.useMemo<CrudField[]>(
    () => [
      { id: 'qtyPlanned', type: 'number', label: t('production.orders.field.qty_planned', 'Quantity planned'), layout: 'half' },
      { id: 'uom', type: 'text', label: t('production.orders.field.uom', 'UoM'), layout: 'half' },
      { id: 'dueDate', type: 'date', label: t('production.orders.field.due_date', 'Due date'), layout: 'half' },
      { id: 'priority', type: 'number', label: t('production.orders.field.priority', 'Priority'), layout: 'half' },
    ],
    [t],
  )

  if (loading) {
    return (
      <Page>
        <PageBody>
          <LoadingMessage label={t('production.orders.loading', 'Loading production order...')} />
        </PageBody>
      </Page>
    )
  }

  if (isNotFound) {
    return (
      <Page>
        <PageBody>
          <RecordNotFoundState
            label={t('production.orders.error.not_found', 'Production order not found')}
            backHref="/backend/production/orders"
            backLabel={t('production.orders.title', 'Production Orders')}
          />
        </PageBody>
      </Page>
    )
  }

  if (error || !record) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage label={error ?? t('production.orders.error.not_found', 'Production order not found')} />
        </PageBody>
      </Page>
    )
  }

  const isEditable = EDITABLE_STATUSES.includes(record.status)

  return (
    <Page>
      <PageBody>
        <Card>
          <CardHeader>
            <CardTitle>
              {t('production.orders.detail.number', 'Order #{number}', { number: record.number })}
              {' '}
              <OrderStatusBadge status={record.status} t={t} />
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
              <div>
                <div className="text-muted-foreground">{t('production.orders.field.due_date', 'Due date')}</div>
                <div className="font-semibold">{record.dueDate ? new Date(record.dueDate).toLocaleDateString() : '—'}</div>
              </div>
              <div>
                <div className="text-muted-foreground">{t('production.orders.field.priority', 'Priority')}</div>
                <div className="font-semibold">{record.priority}</div>
              </div>
              <div>
                <div className="text-muted-foreground">{t('production.orders.field.qty', 'Qty (planned / completed)')}</div>
                <div className="font-semibold">{record.qtyPlanned} / {record.qtyCompleted} {record.uom}</div>
              </div>
              <div>
                <div className="text-muted-foreground">{t('production.orders.field.source_type', 'Source')}</div>
                <div className="font-semibold">{t(`production.orders.source_type.${record.sourceType}`, record.sourceType)}</div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {record.status === 'draft' && (
                <>
                  <Button onClick={() => runOrderAction('plan')}>{t('production.orders.action.plan', 'Plan')}</Button>
                  <Button variant="outline" onClick={handleDelete}>{t('production.orders.action.delete', 'Delete')}</Button>
                </>
              )}
              {record.status === 'planned' && (
                <Button onClick={() => runOrderAction('release')}>{t('production.orders.action.release', 'Release')}</Button>
              )}
              {record.status === 'released' && (
                <Button variant="outline" onClick={handleCancel}>{t('production.orders.action.cancel', 'Cancel')}</Button>
              )}
              {record.status === 'completed' && (
                <Button onClick={() => runOrderAction('close')}>{t('production.orders.action.close', 'Close')}</Button>
              )}
            </div>

            {releaseResult && (
              <div className="flex flex-col gap-2 rounded-md border border-border p-3">
                <div className="text-sm font-medium">
                  {t('production.orders.release_result.reservations', '{count} material reservations created', {
                    count: releaseResult.reservations,
                  })}
                </div>
                <ShortagesTable lines={releaseResult.shortages} t={t} />
              </div>
            )}
          </CardContent>
        </Card>

        {isEditable && (
          <CrudForm<OrderEditValues>
            title={t('production.orders.edit.title', 'Edit production order')}
            fields={editFields}
            schema={orderEditSchema}
            optimisticLockUpdatedAt={record.updatedAt}
            initialValues={{
              qtyPlanned: Number(record.qtyPlanned),
              uom: record.uom,
              dueDate: record.dueDate ?? undefined,
              priority: record.priority,
            } as unknown as Partial<OrderEditValues>}
            submitLabel={t('production.orders.form.save', 'Save changes')}
            onSubmit={async (values) => {
              try {
                await updateCrud('production/orders', { id: record.id, ...values })
              } catch (err) {
                if (surfaceRecordConflict(err, t)) return
                throw err
              }
              flash(t('production.orders.success.updated', 'Production order updated successfully'), 'success')
              await loadRecord()
            }}
          />
        )}

        <Card>
          <CardHeader>
            <CardTitle>{t('production.orders.operations.title', 'Operations')}</CardTitle>
          </CardHeader>
          <CardContent>
            {record.operations.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('production.orders.operations.empty', 'No operations yet.')}</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('production.orders.operations.field.sequence', 'Seq.')}</TableHead>
                    <TableHead>{t('production.orders.operations.field.name', 'Name')}</TableHead>
                    <TableHead>{t('production.orders.operations.field.work_center_id', 'Work center')}</TableHead>
                    <TableHead>{t('production.orders.operations.field.setup_time_minutes', 'Setup time (min)')}</TableHead>
                    <TableHead>{t('production.orders.operations.field.run_time_per_unit_seconds', 'Run time per unit (s)')}</TableHead>
                    <TableHead>{t('production.orders.operations.field.is_reporting_point', 'Reporting point')}</TableHead>
                    <TableHead>{t('production.orders.operations.field.status', 'Status')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {record.operations.map((operation) => (
                    <TableRow key={operation.id}>
                      <TableCell>{operation.sequence}</TableCell>
                      <TableCell>{operation.name}</TableCell>
                      <TableCell>{operation.workCenterId}</TableCell>
                      <TableCell>{operation.setupTimeMinutes}</TableCell>
                      <TableCell>{operation.runTimePerUnitSeconds}</TableCell>
                      <TableCell>
                        {operation.isReportingPoint
                          ? t('production.orders.operations.value.yes', 'Yes')
                          : t('production.orders.operations.value.no', 'No')}
                      </TableCell>
                      <TableCell>{t(`production.orders.operations.status.${operation.status}`, operation.status)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('production.orders.materials.title', 'Materials')}</CardTitle>
          </CardHeader>
          <CardContent>
            {record.materials.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('production.orders.materials.empty', 'No materials yet.')}</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('production.orders.materials.field.component_product_id', 'Component')}</TableHead>
                    <TableHead>{t('production.orders.materials.field.qty_required', 'Required')}</TableHead>
                    <TableHead>{t('production.orders.materials.field.qty_issued', 'Issued')}</TableHead>
                    <TableHead>{t('production.orders.materials.field.reserved_qty', 'Reserved')}</TableHead>
                    <TableHead>{t('production.orders.materials.field.uom', 'UoM')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {record.materials.map((material) => (
                    <TableRow key={material.id}>
                      <TableCell>{material.componentProductId}</TableCell>
                      <TableCell>{material.qtyRequired}</TableCell>
                      <TableCell>{material.qtyIssued}</TableCell>
                      <TableCell>{material.reservedQty}</TableCell>
                      <TableCell>{material.uom}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('production.orders.shortages.title', 'Shortages')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Button variant="outline" size="sm" onClick={loadShortages} disabled={shortagesLoading}>
              {shortagesLoading
                ? t('production.orders.shortages.loading', 'Loading...')
                : t('production.orders.shortages.refresh', 'Refresh shortages')}
            </Button>
            {shortages && <ShortagesTable lines={shortages} t={t} />}
          </CardContent>
        </Card>

        {ConfirmDialogElement}
      </PageBody>
    </Page>
  )
}
