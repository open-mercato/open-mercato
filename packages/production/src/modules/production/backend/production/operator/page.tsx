'use client'

import * as React from 'react'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Card, CardHeader, CardTitle, CardContent } from '@open-mercato/ui/primitives/card'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { apiCall, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { DictionaryEntrySelect } from '@open-mercato/core/modules/dictionaries/components/DictionaryEntrySelect'
import { fetchScrapReasonOptions, PRODUCTION_DICTIONARIES_MANAGE_HREF } from '../lib/scrapReasonOptions.js'
import { useInactivityLogout } from '../lib/useInactivityLogout.js'
import { extractServerErrorMessage } from '../../../lib/serverErrorMessage.js'

type WorkCenterTile = {
  id: string
  name: string
  kind: string
}

type QueueItem = {
  orderId: string
  orderNumber: number
  productId: string
  variantId: string | null
  qtyPlanned: string
  orderUpdatedAt: string
  operationId: string
  sequence: number
  name: string
  operationStatus: 'pending' | 'in_progress'
}

type Stage = 'centers' | 'queue' | 'report'

export default function OperatorPanelPage() {
  const t = useT()
  useInactivityLogout()

  const mutationContextId = 'production-operator-panel:mutation'
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: mutationContextId,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  const [stage, setStage] = React.useState<Stage>('centers')
  const [workCenters, setWorkCenters] = React.useState<WorkCenterTile[]>([])
  const [centersLoading, setCentersLoading] = React.useState(true)
  const [centersError, setCentersError] = React.useState<string | null>(null)

  const [selectedCenter, setSelectedCenter] = React.useState<WorkCenterTile | null>(null)
  const [queue, setQueue] = React.useState<QueueItem[]>([])
  const [queueLoading, setQueueLoading] = React.useState(false)
  const [queueError, setQueueError] = React.useState<string | null>(null)

  const [selectedItem, setSelectedItem] = React.useState<QueueItem | null>(null)
  const [qtyGood, setQtyGood] = React.useState('')
  const [qtyScrap, setQtyScrap] = React.useState('')
  const [scrapReasonEntryId, setScrapReasonEntryId] = React.useState<string | undefined>(undefined)
  const [reportType, setReportType] = React.useState<'partial' | 'final'>('partial')
  const [submitting, setSubmitting] = React.useState(false)

  const loadWorkCenters = React.useCallback(async () => {
    setCentersLoading(true)
    setCentersError(null)
    try {
      const call = await apiCall<{ items?: WorkCenterTile[] }>('/api/production/work-centers?isActive=true&pageSize=100')
      if (call.ok && call.result) {
        setWorkCenters(call.result.items ?? [])
      } else {
        setCentersError(t('production.operator.error.work_centers_failed', 'Failed to load work centers'))
      }
    } catch {
      setCentersError(t('production.operator.error.work_centers_failed', 'Failed to load work centers'))
    } finally {
      setCentersLoading(false)
    }
  }, [t])

  React.useEffect(() => {
    loadWorkCenters()
  }, [loadWorkCenters])

  const loadQueue = React.useCallback(
    async (workCenterId: string) => {
      setQueueLoading(true)
      setQueueError(null)
      try {
        const call = await apiCall<{ items?: QueueItem[] }>(
          `/api/production/operator/queue?workCenterId=${encodeURIComponent(workCenterId)}`,
        )
        if (call.ok && call.result) {
          setQueue(call.result.items ?? [])
        } else {
          setQueueError(t('production.operator.error.queue_failed', 'Failed to load the work queue'))
        }
      } catch {
        setQueueError(t('production.operator.error.queue_failed', 'Failed to load the work queue'))
      } finally {
        setQueueLoading(false)
      }
    },
    [t],
  )

  const handleSelectCenter = React.useCallback(
    (center: WorkCenterTile) => {
      setSelectedCenter(center)
      setStage('queue')
      loadQueue(center.id)
    },
    [loadQueue],
  )

  const handleBackToCenters = React.useCallback(() => {
    setStage('centers')
    setSelectedCenter(null)
    setQueue([])
  }, [])

  const handleSelectItem = React.useCallback((item: QueueItem) => {
    setSelectedItem(item)
    setQtyGood('')
    setQtyScrap('')
    setScrapReasonEntryId(undefined)
    setReportType('partial')
    setStage('report')
  }, [])

  const handleBackToQueue = React.useCallback(() => {
    setStage('queue')
    setSelectedItem(null)
    if (selectedCenter) loadQueue(selectedCenter.id)
  }, [selectedCenter, loadQueue])

  const handleSubmitReport = React.useCallback(async () => {
    if (!selectedItem) return
    const good = Number(qtyGood || 0)
    const scrap = Number(qtyScrap || 0)
    if (good <= 0 && scrap <= 0) {
      flash(t('production.operator.report.error.qty_required', 'Enter at least one of good/scrap quantity'), 'error')
      return
    }
    setSubmitting(true)
    try {
      await runMutation({
        operation: async () => {
          const result = await withScopedApiRequestHeaders(
            buildOptimisticLockHeader(selectedItem.orderUpdatedAt),
            () =>
              apiCall('/api/production/reports', {
                method: 'POST',
                body: JSON.stringify({
                  orderOperationId: selectedItem.operationId,
                  qtyGood: good,
                  qtyScrap: scrap,
                  scrapReasonEntryId: scrap > 0 ? scrapReasonEntryId ?? null : null,
                  reportType,
                }),
              }),
          )
          if (!result.ok) {
            throw Object.assign(new Error('[internal] production.operator.report_failed'), {
              status: result.status,
              ...((result.result as Record<string, unknown> | null) ?? {}),
            })
          }
          return result
        },
        context: {
          formId: mutationContextId,
          resourceKind: 'production.operator.report',
          resourceId: selectedItem.operationId,
          retryLastMutation,
        },
        mutationPayload: { orderOperationId: selectedItem.operationId },
      })
      flash(t('production.operator.report.success', 'Report recorded'), 'success')
      handleBackToQueue()
    } catch (err) {
      const serverMessage = extractServerErrorMessage(err)
      flash(serverMessage ?? t('production.operator.report.error.submit_failed', 'Failed to record the report'), 'error')
    } finally {
      setSubmitting(false)
    }
  }, [selectedItem, qtyGood, qtyScrap, scrapReasonEntryId, reportType, runMutation, retryLastMutation, t, handleBackToQueue])

  return (
    <Page>
      <PageBody>
        {stage === 'centers' && (
          <Card>
            <CardHeader>
              <CardTitle className="text-xl">{t('production.operator.work_centers.title', 'Pick a work center')}</CardTitle>
            </CardHeader>
            <CardContent>
              {centersLoading ? (
                <LoadingMessage label={t('production.operator.loading', 'Loading...')} />
              ) : centersError ? (
                <ErrorMessage label={centersError} />
              ) : workCenters.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t('production.operator.work_centers.empty', 'No active work centers configured.')}
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                  {workCenters.map((center) => (
                    <Button
                      key={center.id}
                      type="button"
                      size="lg"
                      variant="outline"
                      className="h-24 flex-col gap-2 text-lg"
                      onClick={() => handleSelectCenter(center)}
                    >
                      {center.name}
                    </Button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {stage === 'queue' && selectedCenter && (
          <Card>
            <CardHeader>
              <CardTitle className="text-xl">
                {t('production.operator.queue.title', 'Work queue: {center}', { center: selectedCenter.name })}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <Button type="button" variant="outline" size="lg" onClick={handleBackToCenters}>
                {t('production.operator.action.back_to_centers', 'Back to work centers')}
              </Button>
              {queueLoading ? (
                <LoadingMessage label={t('production.operator.loading', 'Loading...')} />
              ) : queueError ? (
                <ErrorMessage label={queueError} />
              ) : queue.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t('production.operator.queue.empty', 'No operations waiting for a report on this work center.')}
                </p>
              ) : (
                <div className="flex flex-col gap-3">
                  {queue.map((item) => (
                    <Button
                      key={item.operationId}
                      type="button"
                      variant="outline"
                      size="lg"
                      className="h-auto flex-col items-start gap-1 whitespace-normal p-6 text-left"
                      onClick={() => handleSelectItem(item)}
                    >
                      <span className="text-lg font-semibold">
                        {t('production.operator.queue.order_number', 'Order #{number}', { number: item.orderNumber })}
                      </span>
                      <span className="text-sm text-muted-foreground">
                        {t('production.operator.queue.item_summary', '{op} (seq. {sequence}) — qty {qty}', {
                          op: item.name,
                          sequence: item.sequence,
                          qty: item.qtyPlanned,
                        })}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {t(`production.operator.queue.status.${item.operationStatus}`, item.operationStatus)}
                      </span>
                    </Button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {stage === 'report' && selectedItem && (
          <Card>
            <CardHeader>
              <CardTitle className="text-xl">
                {t('production.operator.report.title', 'Report: Order #{number}', { number: selectedItem.orderNumber })}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <Button type="button" variant="outline" size="lg" onClick={handleBackToQueue}>
                {t('production.operator.action.back_to_queue', 'Back to queue')}
              </Button>

              <div className="flex flex-col gap-2">
                <Label className="text-base">{t('production.operator.report.field.qty_good', 'Good quantity')}</Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  size="lg"
                  value={qtyGood}
                  onChange={(event) => setQtyGood(event.target.value)}
                  disabled={submitting}
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label className="text-base">{t('production.operator.report.field.qty_scrap', 'Scrap quantity')}</Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  size="lg"
                  value={qtyScrap}
                  onChange={(event) => setQtyScrap(event.target.value)}
                  disabled={submitting}
                />
              </div>

              {Number(qtyScrap || 0) > 0 && (
                <div className="flex flex-col gap-2">
                  <Label className="text-base">{t('production.operator.report.field.scrap_reason', 'Scrap reason')}</Label>
                  <DictionaryEntrySelect
                    value={scrapReasonEntryId}
                    onChange={setScrapReasonEntryId}
                    fetchOptions={fetchScrapReasonOptions}
                    allowInlineCreate={false}
                    manageHref={PRODUCTION_DICTIONARIES_MANAGE_HREF}
                    disabled={submitting}
                    labels={{
                      placeholder: t('production.operator.report.scrap_reason.placeholder', 'Select a reason'),
                      addLabel: t('production.operator.report.scrap_reason.add', 'Add reason'),
                      dialogTitle: t('production.operator.report.scrap_reason.dialog_title', 'New scrap reason'),
                      valueLabel: t('production.operator.report.scrap_reason.value_label', 'Value'),
                      valuePlaceholder: t('production.operator.report.scrap_reason.value_placeholder', 'e.g. material_defect'),
                      labelLabel: t('production.operator.report.scrap_reason.label_label', 'Label'),
                      labelPlaceholder: t('production.operator.report.scrap_reason.label_placeholder', 'e.g. Material defect'),
                      emptyError: t('production.operator.report.scrap_reason.empty_error', 'Value is required'),
                      cancelLabel: t('production.operator.report.scrap_reason.cancel', 'Cancel'),
                      saveLabel: t('production.operator.report.scrap_reason.save', 'Save'),
                      errorLoad: t('production.operator.report.scrap_reason.error_load', 'Failed to load scrap reasons'),
                      errorSave: t('production.operator.report.scrap_reason.error_save', 'Failed to save scrap reason'),
                      loadingLabel: t('production.operator.report.scrap_reason.loading', 'Loading...'),
                      manageTitle: t('production.operator.report.scrap_reason.manage', 'Manage scrap reasons'),
                    }}
                  />
                </div>
              )}

              <div className="flex flex-col gap-2">
                <Label className="text-base">{t('production.operator.report.field.report_type', 'Report type')}</Label>
                <div className="flex gap-3">
                  <Button
                    type="button"
                    size="lg"
                    variant={reportType === 'partial' ? 'default' : 'outline'}
                    className="flex-1"
                    onClick={() => setReportType('partial')}
                    disabled={submitting}
                  >
                    {t('production.operator.report.type.partial', 'Partial')}
                  </Button>
                  <Button
                    type="button"
                    size="lg"
                    variant={reportType === 'final' ? 'default' : 'outline'}
                    className="flex-1"
                    onClick={() => setReportType('final')}
                    disabled={submitting}
                  >
                    {t('production.operator.report.type.final', 'Final')}
                  </Button>
                </div>
              </div>

              <Button type="button" size="lg" className="h-14 text-lg" onClick={handleSubmitReport} disabled={submitting}>
                {submitting
                  ? t('production.operator.report.action.submitting', 'Submitting...')
                  : t('production.operator.report.action.submit', 'Submit report')}
              </Button>
            </CardContent>
          </Card>
        )}
      </PageBody>
    </Page>
  )
}
