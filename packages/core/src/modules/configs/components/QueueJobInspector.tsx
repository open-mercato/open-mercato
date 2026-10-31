"use client"

import * as React from 'react'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@open-mercato/ui/primitives/sheet'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { JobInspectorResponse, InspectedJobDto } from '../lib/queue-status.types'

const API_PATH = '/api/configs/queues-status/jobs'

function isJobInspectorResponse(payload: unknown): payload is JobInspectorResponse {
  if (!payload || typeof payload !== 'object') return false
  return Array.isArray((payload as { jobs?: unknown }).jobs)
}

type FetchState = {
  loading: boolean
  error: string | null
  job: InspectedJobDto | null
  crossTenant: boolean
}

/**
 * Tier 2 (#3105) — rendered ONLY when the caller (QueueStatusPanel) has already
 * confirmed the session holds `configs.queues_status.inspect_payloads`. That is
 * advisory, not the enforcement boundary: the API route re-checks the feature
 * server-side via `requireFeatures`, so a stale/forged client state cannot grant
 * payload access by itself.
 */
export function QueueJobInspector({
  queue,
  jobId,
  onClose,
  returnFocusRef,
}: {
  queue: string
  jobId: string
  onClose: () => void
  /** The element that opened the inspector; focus returns to it when the sheet closes (Escape, overlay, X). */
  returnFocusRef?: React.RefObject<HTMLElement | null>
}) {
  const t = useT()
  const [state, setState] = React.useState<FetchState>({ loading: true, error: null, job: null, crossTenant: false })

  React.useEffect(() => {
    let cancelled = false
    setState({ loading: true, error: null, job: null, crossTenant: false })
    const params = new URLSearchParams({ queue, id: jobId })
    readApiResultOrThrow<unknown>(`${API_PATH}?${params.toString()}`, undefined, {
      errorMessage: t('configs.queuesStatus.inspector.error', 'Failed to load job'),
    })
      .then((payload) => {
        if (cancelled) return
        if (!isJobInspectorResponse(payload)) {
          setState({ loading: false, error: t('configs.queuesStatus.inspector.invalidResponse', 'Unexpected response'), job: null, crossTenant: false })
          return
        }
        const job = payload.jobs[0] ?? null
        setState({
          loading: false,
          error: job ? null : t('configs.queuesStatus.inspector.notFound', 'Job not found, or it belongs to another tenant.'),
          job,
          crossTenant: payload.crossTenant,
        })
      })
      .catch((error: unknown) => {
        if (cancelled) return
        const message = error instanceof Error && error.message ? error.message : t('configs.queuesStatus.inspector.error', 'Failed to load job')
        setState({ loading: false, error: message, job: null, crossTenant: false })
      })
    return () => { cancelled = true }
  }, [queue, jobId, t])

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose() }}>
      <SheetContent
        side="right"
        className="w-full max-w-xl space-y-4 overflow-y-auto"
        onCloseAutoFocus={(event) => {
          // The sheet is opened programmatically (no Radix trigger), so Radix has nowhere to
          // restore focus to and it would be lost to <body>.
          const opener = returnFocusRef?.current
          if (opener && opener.isConnected) {
            event.preventDefault()
            opener.focus()
          }
        }}
      >
        <SheetHeader>
          <SheetTitle>{t('configs.queuesStatus.inspector.title', 'Job Inspector')}</SheetTitle>
          <SheetDescription>
            {t('configs.queuesStatus.inspector.notice', 'Job payloads may contain sensitive data. Every access here is audited.')}
          </SheetDescription>
        </SheetHeader>

        {state.loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner className="h-4 w-4" />
            {t('configs.queuesStatus.inspector.loading', 'Loading job…')}
          </div>
        ) : state.error ? (
          <ErrorMessage label={state.error} />
        ) : state.job ? (
          <div className="space-y-3">
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  {t('configs.queuesStatus.inspector.fields.id', 'Job id')}
                </dt>
                <dd className="font-mono text-xs">{state.job.id}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  {t('configs.queuesStatus.inspector.fields.queue', 'Queue')}
                </dt>
                <dd>{state.job.queue}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  {t('configs.queuesStatus.inspector.fields.state', 'State')}
                </dt>
                <dd>{state.job.state ?? '—'}</dd>
              </div>
              {state.job.failedReason ? (
                <div className="col-span-2">
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                    {t('configs.queuesStatus.inspector.fields.failedReason', 'Failure reason (redacted)')}
                  </dt>
                  <dd className="break-words font-mono text-xs">{state.job.failedReason}</dd>
                </div>
              ) : null}
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  {t('configs.queuesStatus.inspector.fields.tenant', 'Tenant')}
                </dt>
                <dd className="flex items-center gap-2">
                  {state.job.tenantId ?? t('configs.queuesStatus.inspector.unknownTenant', 'unknown')}
                  {state.crossTenant ? (
                    <StatusBadge variant="warning">
                      {t('configs.queuesStatus.inspector.crossTenantBadge', 'Cross-tenant view')}
                    </StatusBadge>
                  ) : null}
                </dd>
              </div>
            </dl>
            {!state.crossTenant ? (
              <p className="text-xs text-muted-foreground">
                {t('configs.queuesStatus.inspector.ownTenantNotice', "Showing only your tenant's jobs.")}
              </p>
            ) : null}
            <div>
              <h4 className="text-sm font-semibold">
                {t('configs.queuesStatus.inspector.payload', 'Payload (redacted)')}
              </h4>
              <pre className="mt-1 max-h-96 overflow-auto rounded border bg-muted p-3 text-xs">
                {JSON.stringify(state.job.data, null, 2)}
              </pre>
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

export default QueueJobInspector
