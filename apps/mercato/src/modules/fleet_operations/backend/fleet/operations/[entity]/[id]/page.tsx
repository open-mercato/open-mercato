"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import { CrudForm } from '@open-mercato/ui/backend/CrudForm'
import { ErrorMessage, LoadingMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { apiCall, apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { deleteCrud, updateCrud } from '@open-mercato/ui/backend/utils/crud'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { createLogger } from '@open-mercato/shared/lib/logger'
import {
  buildOperationsEntityConfigs,
  isOperationsEntityKey,
  toFormValues,
  toPayload,
  type OperationsEntityKey,
} from '../../../../../lib/entityConfig'

const logger = createLogger('fleet_operations')

type RecordRow = Record<string, unknown> & { id: string; updatedAt?: string | null }
type PartRow = { id: string; description: string; quantity: string; unit_cost: string; total_cost: string }
type LaborRow = { id: string; description: string; hours: string; rate: string; total_cost: string }

export default function OperationsRecordPage({ params }: { params?: { entity?: string; id?: string } }) {
  const t = useT()
  const entityKey = params?.entity ?? ''
  const id = params?.id ?? ''
  if (!isOperationsEntityKey(entityKey) || !id) {
    return (
      <Page>
        <PageBody>
          <RecordNotFoundState label={t('fleet_operations.errors.unknownEntity', 'Unknown operations record type.')} backHref="/backend/fleet/operations" />
        </PageBody>
      </Page>
    )
  }
  return <OperationsRecordEditor entityKey={entityKey} id={id} />
}

function OperationsRecordEditor({ entityKey, id }: { entityKey: OperationsEntityKey; id: string }) {
  const t = useT()
  const configs = buildOperationsEntityConfigs(t)
  const config = configs[entityKey]
  const [record, setRecord] = React.useState<RecordRow | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [reloadToken, setReloadToken] = React.useState(0)
  const router = useRouter()

  React.useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    apiCall<{ items?: RecordRow[] }>(`${config.apiPath}?id=${encodeURIComponent(id)}`)
      .then((response) => {
        if (cancelled) return
        if (!response.ok || !response.result) {
          setError(t('fleet_operations.detail.loadError', 'Failed to load the record.'))
          return
        }
        const found = (response.result.items ?? []).find((item) => item.id === id) ?? null
        if (!found) {
          setError(t('fleet_operations.detail.notFound', 'Record not found.'))
          return
        }
        setRecord(found)
      })
      .catch((err) => {
        logger.warn('Fleet operations record load failed', { err })
        if (!cancelled) setError(t('fleet_operations.detail.loadError', 'Failed to load the record.'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [config.apiPath, id, reloadToken, t])

  if (loading && !record) {
    return (
      <Page>
        <PageBody>
          <LoadingMessage label={t('fleet_operations.loading', 'Loading…')} />
        </PageBody>
      </Page>
    )
  }
  if (error || !record) {
    return (
      <Page>
        <PageBody>
          <ErrorMessage label={error ?? t('fleet_operations.detail.loadError', 'Failed to load the record.')} />
        </PageBody>
      </Page>
    )
  }

  const path = config.apiPath.replace(/^\/api\//, '')

  return (
    <Page>
      <PageBody>
        <CrudForm
          title={`${config.title} — ${String(record.work_order_number ?? record.name ?? record.policy_number ?? record.violation_number ?? record.id.slice(0, 8))}`}
          titleHeadingLevel={1}
          backHref={`/backend/fleet/operations?tab=${config.key}`}
          fields={config.fields}
          initialValues={toFormValues(record)}
          submitLabel={t('fleet_operations.form.save', 'Save')}
          cancelHref={`/backend/fleet/operations?tab=${config.key}`}
          onSubmit={async (values) => {
            await updateCrud(path, { id, ...toPayload(values as Record<string, unknown>) })
            flash(t('fleet_operations.form.saved', 'Record saved.'), 'success')
            setReloadToken((token) => token + 1)
          }}
          onDelete={async () => {
            await deleteCrud(path, id)
            flash(t('fleet_operations.form.deleted', 'Record deleted.'), 'success')
            router.push(`/backend/fleet/operations?tab=${config.key}`)
          }}
        />
        {config.key === 'work-orders' ? (
          <WorkOrderExtras record={record} onChanged={() => setReloadToken((token) => token + 1)} />
        ) : null}
      </PageBody>
    </Page>
  )
}

function WorkOrderExtras({ record, onChanged }: { record: RecordRow; onChanged: () => void }) {
  const t = useT()
  const [parts, setParts] = React.useState<PartRow[]>([])
  const [labor, setLabor] = React.useState<LaborRow[]>([])
  const [partDescription, setPartDescription] = React.useState('')
  const [partQuantity, setPartQuantity] = React.useState('1')
  const [partUnitCost, setPartUnitCost] = React.useState('0')
  const [laborDescription, setLaborDescription] = React.useState('')
  const [laborHours, setLaborHours] = React.useState('0')
  const [laborRate, setLaborRate] = React.useState('0')
  const [busy, setBusy] = React.useState(false)
  const [reloadToken, setReloadToken] = React.useState(0)
  const workOrderId = record.id
  const completed = record.status === 'completed'

  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: `fleet-work-order:${workOrderId}`,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  React.useEffect(() => {
    let cancelled = false
    Promise.all([
      apiCall<{ items?: PartRow[] }>(`/api/fleet_operations/work-order-parts?workOrderId=${encodeURIComponent(workOrderId)}&pageSize=100`),
      apiCall<{ items?: LaborRow[] }>(`/api/fleet_operations/work-order-labor?workOrderId=${encodeURIComponent(workOrderId)}&pageSize=100`),
    ])
      .then(([partCall, laborCall]) => {
        if (cancelled) return
        setParts(Array.isArray(partCall.result?.items) ? partCall.result.items : [])
        setLabor(Array.isArray(laborCall.result?.items) ? laborCall.result.items : [])
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [workOrderId, reloadToken])

  const complete = async () => {
    setBusy(true)
    try {
      await runMutation({
        operation: () => withScopedApiRequestHeaders(
          buildOptimisticLockHeader(record.updatedAt ?? null),
          () => apiCallOrThrow('/api/fleet_operations/work-orders/complete', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: workOrderId }),
          }),
        ),
        mutationPayload: { operation: 'completeWorkOrder', workOrderId },
        context: {
          formId: `fleet-work-order:${workOrderId}`,
          resourceKind: 'fleet_operations:fleet_work_order',
          resourceId: workOrderId,
          retryLastMutation,
        },
      })
      flash(t('fleet_operations.workOrder.completed', 'Work order completed and posted.'), 'success')
      onChanged()
    } catch {
      flash(t('fleet_operations.workOrder.completeError', 'Failed to complete the work order.'), 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-6 space-y-4">
      <section className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">{t('fleet_operations.workOrder.parts', 'Parts')}</h2>
          <p className="text-xs text-muted-foreground">{t('fleet_operations.workOrder.totalCost', 'Total')}: {String(record.total_cost ?? '0')}</p>
        </div>
        <ul className="mt-3 space-y-2">
          {parts.map((part) => (
            <li key={part.id} className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
              <span className="font-medium">{part.description}</span>
              <span className="text-xs text-muted-foreground">{part.quantity} × {part.unit_cost} = {part.total_cost}</span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="ms-auto"
                disabled={busy || completed}
                onClick={() => {
                  void runMutation({
                    operation: () => apiCallOrThrow(`/api/fleet_operations/work-order-parts?id=${encodeURIComponent(part.id)}`, { method: 'DELETE' }),
                    mutationPayload: { operation: 'work_order_parts.delete', id: part.id },
                    context: {
                      formId: `fleet-work-order:${workOrderId}`,
                      resourceKind: 'fleet_operations:work_order_part',
                      resourceId: part.id,
                      retryLastMutation,
                    },
                  }).then(() => {
                    setReloadToken((token) => token + 1)
                  }).catch(() => {
                    flash(t('fleet_operations.workOrder.partError', 'Failed to add the part.'), 'error')
                  })
                }}
              >
                {t('fleet_operations.list.delete', 'Delete')}
              </Button>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex flex-wrap gap-2">
          <Input value={partDescription} onChange={(event) => setPartDescription(event.target.value)} placeholder={t('fleet_operations.workOrder.partDescription', 'Part description')} />
          <Input value={partQuantity} onChange={(event) => setPartQuantity(event.target.value)} placeholder={t('fleet_operations.fields.quantity', 'Quantity')} />
          <Input value={partUnitCost} onChange={(event) => setPartUnitCost(event.target.value)} placeholder={t('fleet_operations.fields.unitCost', 'Unit cost')} />
          <Button
            type="button"
            disabled={busy || completed || !partDescription.trim()}
            onClick={() => {
              setBusy(true)
              void runMutation({
                operation: () => apiCallOrThrow('/api/fleet_operations/work-order-parts', {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({
                    workOrderId,
                    description: partDescription,
                    quantity: Number(partQuantity) || 0,
                    unitCost: Number(partUnitCost) || 0,
                  }),
                }),
                mutationPayload: { operation: 'work_order_parts.create', workOrderId },
                context: {
                  formId: `fleet-work-order:${workOrderId}`,
                  resourceKind: 'fleet_operations:work_order_part',
                  resourceId: workOrderId,
                  retryLastMutation,
                },
              }).then(() => {
                setPartDescription('')
                setPartQuantity('1')
                setPartUnitCost('0')
                setReloadToken((token) => token + 1)
              }).catch(() => {
                flash(t('fleet_operations.workOrder.partError', 'Failed to add the part.'), 'error')
              }).finally(() => setBusy(false))
            }}
          >
            {t('fleet_operations.workOrder.addPart', 'Add part')}
          </Button>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-semibold">{t('fleet_operations.workOrder.labor', 'Labor')}</h2>
        <ul className="mt-3 space-y-2">
          {labor.map((entry) => (
            <li key={entry.id} className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
              <span className="font-medium">{entry.description}</span>
              <span className="text-xs text-muted-foreground">{entry.hours} h × {entry.rate} = {entry.total_cost}</span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="ms-auto"
                disabled={busy || completed}
                onClick={() => {
                  void runMutation({
                    operation: () => apiCallOrThrow(`/api/fleet_operations/work-order-labor?id=${encodeURIComponent(entry.id)}`, { method: 'DELETE' }),
                    mutationPayload: { operation: 'work_order_labor.delete', id: entry.id },
                    context: {
                      formId: `fleet-work-order:${workOrderId}`,
                      resourceKind: 'fleet_operations:work_order_labor',
                      resourceId: entry.id,
                      retryLastMutation,
                    },
                  }).then(() => {
                    setReloadToken((token) => token + 1)
                  }).catch(() => {
                    flash(t('fleet_operations.workOrder.laborError', 'Failed to add the labor entry.'), 'error')
                  })
                }}
              >
                {t('fleet_operations.list.delete', 'Delete')}
              </Button>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex flex-wrap gap-2">
          <Input value={laborDescription} onChange={(event) => setLaborDescription(event.target.value)} placeholder={t('fleet_operations.workOrder.laborDescription', 'Labor description')} />
          <Input value={laborHours} onChange={(event) => setLaborHours(event.target.value)} placeholder={t('fleet_operations.fields.hours', 'Hours')} />
          <Input value={laborRate} onChange={(event) => setLaborRate(event.target.value)} placeholder={t('fleet_operations.fields.rate', 'Rate')} />
          <Button
            type="button"
            disabled={busy || completed || !laborDescription.trim()}
            onClick={() => {
              setBusy(true)
              void runMutation({
                operation: () => apiCallOrThrow('/api/fleet_operations/work-order-labor', {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({
                    workOrderId,
                    description: laborDescription,
                    hours: Number(laborHours) || 0,
                    rate: Number(laborRate) || 0,
                  }),
                }),
                mutationPayload: { operation: 'work_order_labor.create', workOrderId },
                context: {
                  formId: `fleet-work-order:${workOrderId}`,
                  resourceKind: 'fleet_operations:work_order_labor',
                  resourceId: workOrderId,
                  retryLastMutation,
                },
              }).then(() => {
                setLaborDescription('')
                setLaborHours('0')
                setLaborRate('0')
                setReloadToken((token) => token + 1)
              }).catch(() => {
                flash(t('fleet_operations.workOrder.laborError', 'Failed to add the labor entry.'), 'error')
              }).finally(() => setBusy(false))
            }}
          >
            {t('fleet_operations.workOrder.addLabor', 'Add labor')}
          </Button>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold">{t('fleet_operations.workOrder.close', 'Close work order')}</h2>
            <p className="text-xs text-muted-foreground">
              {t('fleet_operations.workOrder.closeHint', 'Completing recomputes parts and labor totals, rolls the schedule and posts the cost to the ledger.')}
            </p>
          </div>
          <Button type="button" disabled={busy || completed} onClick={() => { void complete() }}>
            {completed
              ? t('fleet_operations.workOrder.alreadyCompleted', 'Completed')
              : t('fleet_operations.workOrder.complete', 'Complete work order')}
          </Button>
        </div>
      </section>
    </div>
  )
}
