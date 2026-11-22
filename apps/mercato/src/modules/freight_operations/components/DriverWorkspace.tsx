"use client"

import * as React from 'react'
import { AlertTriangle, Coffee, MapPin, Play, Square, Truck } from 'lucide-react'
import { Page, PageBody, PageHeader } from '@open-mercato/ui/backend/Page'
import { Badge } from '@open-mercato/ui/primitives/badge'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@open-mercato/ui/primitives/dialog'
import { useDialogKeyHandler } from '@open-mercato/ui/hooks/useDialogKeyHandler'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall, apiCallOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { formatFreightDate } from './freightOptions'

const ACTIONS_API = '/api/freight_operations/driver/actions'
const WORK_API = '/api/freight_operations/driver/work'
const CONTEXT_ID = 'freight_operations.driver.workspace'

type DriverOrder = {
  id: string
  orderNumber: string
  status: 'assigned' | 'in_transit' | 'delivered'
  cargoDescription: string
  pickupLocation: string
  dropoffLocation: string
  requestedPickupAt?: string | null
  requestedDeliveryAt?: string | null
  podReference?: string | null
  updatedAt?: string | null
}

type DriverTrip = {
  id: string
  tripNumber: string
  executionStatus: 'planned' | 'dispatched' | 'in_transit' | 'delivered'
  origin: string
  destination: string
  executionDate?: string | null
  podReference?: string | null
  updatedAt?: string | null
}

type DriverWork = {
  driver: { id: string; fullName: string; phone: string; status: string }
  orders: DriverOrder[]
  trips: DriverTrip[]
  openRestBreak: { id: string; tripId: string | null; startedAt: string } | null
}

type DeliverTarget = {
  kind: 'order' | 'trip'
  id: string
  label: string
  updatedAt?: string | null
}

function DriverPwaBootstrap() {
  React.useEffect(() => {
    const link = document.createElement('link')
    link.rel = 'manifest'
    link.href = '/driver.webmanifest'
    document.head.appendChild(link)
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/driver-sw.js').catch(() => undefined)
    }
    return () => { link.remove() }
  }, [])
  return null
}

export default function DriverWorkspace() {
  const t = useT()
  const locale = useLocale()
  const [work, setWork] = React.useState<DriverWork | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [deliverTarget, setDeliverTarget] = React.useState<DeliverTarget | null>(null)
  const [sosOpen, setSosOpen] = React.useState(false)

  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId?: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: CONTEXT_ID,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    const call = await apiCall<DriverWork>(WORK_API)
    if (call.ok && call.result) {
      setWork(call.result)
    } else if (call.response.status === 403) {
      setError(t('freight_operations.driver.notLinked', 'Your user is not linked to a driver record yet.'))
    } else {
      setError(t('freight_operations.driver.loadError', 'Unable to load your work.'))
    }
    setLoading(false)
  }, [t])

  React.useEffect(() => {
    void load()
  }, [load])

  const runAction = React.useCallback(async (
    payload: Record<string, unknown>,
    context: { resourceKind: string; resourceId: string; updatedAt?: string | null },
  ) => {
    try {
      await runMutation<Awaited<ReturnType<typeof apiCallOrThrow>>>({
        operation: () => withScopedApiRequestHeaders(
          buildOptimisticLockHeader(context.updatedAt ?? null),
          () => apiCallOrThrow(ACTIONS_API, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          }, {
            errorMessage: t('freight_operations.driver.actionError', 'Unable to update the workflow.'),
          }),
        ),
        mutationPayload: { operation: 'driver.action', ...payload },
        context: {
          formId: CONTEXT_ID,
          resourceKind: context.resourceKind,
          resourceId: context.resourceId,
          retryLastMutation,
        },
      })
      flash(t('freight_operations.driver.actionSuccess', 'Updated.'), 'success')
      await load()
    } catch (caught) {
      flash(
        caught instanceof Error && caught.message
          ? caught.message
          : t('freight_operations.driver.actionError', 'Unable to update the workflow.'),
        'error',
      )
    }
  }, [load, retryLastMutation, runMutation, t])

  const startBreak = React.useCallback(() => {
    const activeTrip = work?.trips.find((trip) => trip.executionStatus === 'in_transit') ?? work?.trips[0] ?? null
    void runAction(
      { type: 'rest_start', tripId: activeTrip?.id ?? null },
      { resourceKind: 'freight_operations:freight_driver_rest_break', resourceId: work?.driver.id ?? '' },
    )
  }, [runAction, work])

  const endBreak = React.useCallback(() => {
    if (!work?.openRestBreak) return
    void runAction(
      { type: 'rest_end', breakId: work.openRestBreak.id },
      { resourceKind: 'freight_operations:freight_driver_rest_break', resourceId: work.openRestBreak.id },
    )
  }, [runAction, work])

  return (
    <Page className="mx-auto w-full max-w-lg">
      <DriverPwaBootstrap />
      <PageBody>
        <PageHeader
          title={t('freight_operations.driver.title', 'Driver workspace')}
          description={work ? t('freight_operations.driver.greeting', 'Welcome, {name}', { name: work.driver.fullName }) : undefined}
          actions={work ? (
            <Button type="button" variant="outline" onClick={() => { void load() }}>
              {t('common.refresh', 'Refresh')}
            </Button>
          ) : null}
        />

        {loading ? (
          <p className="text-sm text-muted-foreground">{t('common.loading', 'Loading…')}</p>
        ) : error ? (
          <div className="rounded-lg border border-border bg-card p-4 text-sm text-status-error-text">{error}</div>
        ) : work ? (
          <div className="flex flex-col gap-4 pb-28">
            <section className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold text-foreground">{t('freight_operations.driver.orders', 'Assigned orders')}</h2>
              {work.orders.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('freight_operations.driver.noOrders', 'No assigned orders.')}</p>
              ) : work.orders.map((order) => (
                <article key={order.id} className="rounded-lg border border-border bg-card p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Truck aria-hidden className="size-4 text-muted-foreground" />
                      <span className="text-sm font-semibold text-foreground">{order.orderNumber}</span>
                    </div>
                    <Badge variant="secondary">{order.status.replaceAll('_', ' ')}</Badge>
                  </div>
                  <p className="mt-2 text-sm text-foreground">{order.cargoDescription}</p>
                  <p className="text-xs text-muted-foreground">
                    {order.pickupLocation} → {order.dropoffLocation}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t('freight_operations.driver.pickup', 'Pickup')}: {formatFreightDate(order.requestedPickupAt, locale)}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {order.status === 'assigned' ? (
                      <Button
                        type="button"
                        onClick={() => { void runAction(
                          { type: 'order_dispatch', orderId: order.id },
                          { resourceKind: 'freight_operations:freight_order', resourceId: order.id, updatedAt: order.updatedAt },
                        ) }}
                      >
                        <Play aria-hidden className="me-2 size-4" />
                        {t('freight_operations.driver.start', 'Start')}
                      </Button>
                    ) : null}
                    {order.status === 'in_transit' ? (
                      <Button
                        type="button"
                        onClick={() => setDeliverTarget({
                          kind: 'order',
                          id: order.id,
                          label: order.orderNumber,
                          updatedAt: order.updatedAt,
                        })}
                      >
                        {t('freight_operations.driver.deliver', 'Deliver')}
                      </Button>
                    ) : null}
                  </div>
                </article>
              ))}
            </section>

            <section className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold text-foreground">{t('freight_operations.driver.trips', 'Assigned trips')}</h2>
              {work.trips.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('freight_operations.driver.noTrips', 'No assigned trips.')}</p>
              ) : work.trips.map((trip) => (
                <article key={trip.id} className="rounded-lg border border-border bg-card p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <MapPin aria-hidden className="size-4 text-muted-foreground" />
                      <span className="text-sm font-semibold text-foreground">{trip.tripNumber}</span>
                    </div>
                    <Badge variant="secondary">{trip.executionStatus.replaceAll('_', ' ')}</Badge>
                  </div>
                  <p className="mt-2 text-sm text-foreground">{trip.origin} → {trip.destination}</p>
                  <p className="text-xs text-muted-foreground">
                    {t('freight_operations.driver.executionDate', 'Execution date')}: {formatFreightDate(trip.executionDate, locale)}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {trip.executionStatus === 'planned' || trip.executionStatus === 'dispatched' ? (
                      <Button
                        type="button"
                        onClick={() => { void runAction(
                          { type: 'trip_start', tripId: trip.id },
                          { resourceKind: 'freight_operations:freight_trip', resourceId: trip.id, updatedAt: trip.updatedAt },
                        ) }}
                      >
                        <Play aria-hidden className="me-2 size-4" />
                        {t('freight_operations.driver.start', 'Start')}
                      </Button>
                    ) : null}
                    {trip.executionStatus === 'in_transit' ? (
                      <Button
                        type="button"
                        onClick={() => setDeliverTarget({
                          kind: 'trip',
                          id: trip.id,
                          label: trip.tripNumber,
                          updatedAt: trip.updatedAt,
                        })}
                      >
                        {t('freight_operations.driver.deliver', 'Deliver')}
                      </Button>
                    ) : null}
                  </div>
                </article>
              ))}
            </section>

            <section className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Coffee aria-hidden className="size-4 text-muted-foreground" />
                {t('freight_operations.driver.rest', 'Rest break')}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {work.openRestBreak
                  ? t('freight_operations.driver.restOpen', 'Break started at {time}.', {
                      time: formatFreightDate(work.openRestBreak.startedAt, locale),
                    })
                  : t('freight_operations.driver.restClosed', 'No break is open.')}
              </p>
              <Button
                type="button"
                variant={work.openRestBreak ? 'default' : 'outline'}
                className="mt-3"
                onClick={() => (work.openRestBreak ? endBreak() : startBreak())}
              >
                {work.openRestBreak
                  ? t('freight_operations.driver.endRest', 'End break')
                  : t('freight_operations.driver.startRest', 'Start break')}
              </Button>
            </section>
          </div>
        ) : null}
      </PageBody>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/95 p-3 backdrop-blur">
        <Button
          type="button"
          variant="outline"
          className="w-full border-status-error-border text-status-error-text"
          onClick={() => setSosOpen(true)}
        >
          <AlertTriangle aria-hidden className="me-2 size-4" />
          {t('freight_operations.driver.sos', 'SOS')}
        </Button>
      </div>

      <DriverDeliverDialog
        target={deliverTarget}
        onOpenChange={(open) => { if (!open) setDeliverTarget(null) }}
        onSubmit={(target, values) => {
          setDeliverTarget(null)
          void runAction(
            target.kind === 'order'
              ? { type: 'order_deliver', orderId: target.id, ...values }
              : { type: 'trip_deliver', tripId: target.id, ...values },
            {
              resourceKind: target.kind === 'order' ? 'freight_operations:freight_order' : 'freight_operations:freight_trip',
              resourceId: target.id,
              updatedAt: target.updatedAt,
            },
          )
        }}
      />

      <DriverSosDialog
        open={sosOpen}
        onOpenChange={setSosOpen}
        onSubmit={(values) => {
          setSosOpen(false)
          void runAction(
            { type: 'sos', ...values },
            { resourceKind: 'freight_operations:freight_driver_alert', resourceId: work?.driver.id ?? '' },
          )
        }}
      />
    </Page>
  )
}

function DriverDeliverDialog({
  target,
  onOpenChange,
  onSubmit,
}: {
  target: DeliverTarget | null
  onOpenChange: (open: boolean) => void
  onSubmit: (target: DeliverTarget, values: { podReference: string; podReceivedByName?: string }) => void
}) {
  const t = useT()
  const [podReference, setPodReference] = React.useState('')
  const [receivedBy, setReceivedBy] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const open = target !== null

  React.useEffect(() => {
    if (!open) return
    setPodReference('')
    setReceivedBy('')
    setError(null)
  }, [open])

  const submit = React.useCallback(() => {
    if (!target) return
    if (!podReference.trim()) {
      setError(t('freight_operations.driver.podRequired', 'Enter the proof of delivery reference.'))
      return
    }
    onSubmit(target, {
      podReference: podReference.trim(),
      ...(receivedBy.trim() ? { podReceivedByName: receivedBy.trim() } : {}),
    })
  }, [onSubmit, podReference, receivedBy, t, target])

  const handleKeyDown = useDialogKeyHandler({
    onConfirm: submit,
    onCancel: () => onOpenChange(false),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>{t('freight_operations.driver.deliverTitle', 'Record delivery')}</DialogTitle>
          <DialogDescription>
            {target
              ? t('freight_operations.driver.deliverDescription', 'Deliver {label} and record the proof of delivery.', { label: target.label })
              : ''}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-foreground">{t('freight_operations.driver.podReference', 'POD reference')}</span>
            <Input value={podReference} onChange={(event) => setPodReference(event.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-foreground">{t('freight_operations.driver.receivedBy', 'Received by')}</span>
            <Input value={receivedBy} onChange={(event) => setReceivedBy(event.target.value)} />
          </label>
          {error ? <p className="text-sm text-status-error-text">{error}</p> : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button type="button" onClick={submit}>
            {t('freight_operations.driver.deliver', 'Deliver')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DriverSosDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (values: { note?: string; latitude?: number; longitude?: number }) => void
}) {
  const t = useT()
  const [note, setNote] = React.useState('')
  const [coords, setCoords] = React.useState<{ latitude: number; longitude: number } | null>(null)
  const [locating, setLocating] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    setNote('')
    setCoords(null)
    setLocating(false)
    if (!('geolocation' in navigator)) return
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setCoords({ latitude: position.coords.latitude, longitude: position.coords.longitude })
        setLocating(false)
      },
      () => setLocating(false),
      { timeout: 5000 },
    )
  }, [open])

  const submit = React.useCallback(() => {
    onSubmit({
      ...(note.trim() ? { note: note.trim() } : {}),
      ...(coords ?? {}),
    })
  }, [coords, note, onSubmit])

  const handleKeyDown = useDialogKeyHandler({
    onConfirm: submit,
    onCancel: () => onOpenChange(false),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>{t('freight_operations.driver.sosTitle', 'Send SOS')}</DialogTitle>
          <DialogDescription>
            {t('freight_operations.driver.sosDescription', 'Your dispatcher will receive an emergency alert with your location when available.')}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-foreground">{t('freight_operations.driver.sosNote', 'What is happening?')}</span>
            <Textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} />
          </label>
          <p className="text-xs text-muted-foreground">
            {locating
              ? t('freight_operations.driver.locating', 'Getting your location…')
              : coords
                ? t('freight_operations.driver.locationReady', 'Location will be included.')
                : t('freight_operations.driver.locationUnavailable', 'Location is unavailable; the alert will still be sent.')}
          </p>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button type="button" onClick={submit}>
            {t('freight_operations.driver.sosSend', 'Send SOS')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
