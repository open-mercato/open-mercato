"use client"

import * as React from 'react'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { apiCall, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'

type ReturnLabelClaim = {
  id: string
  status: string | null
  updatedAt: string | null
  returnLabelUrl: string | null
  returnTrackingNumber: string | null
  returnCarrier: string | null
}

type ReturnLabelResponse =
  | {
    status: 'created'
    labelUrl: string | null
    trackingNumber: string | null
    carrier: string | null
  }
  | { status: 'notConfigured' }

type MutationContext = {
  formId: string
  resourceKind: string
  resourceId?: string
  retryLastMutation: () => Promise<boolean>
}

type ReturnLabelPanelProps = {
  claim: ReturnLabelClaim
  canManage: boolean
  onRefresh: () => Promise<void>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function readErrorKey(value: unknown): string | null {
  if (!isRecord(value)) return null
  return typeof value.error === 'string' && value.error.trim().length ? value.error.trim() : null
}

function toApiError(status: number, result: unknown, fallbackKey: string, t: TranslateFn): Error & { status?: number } {
  const key = readErrorKey(result) ?? fallbackKey
  return Object.assign(new Error(t(key, key)), { status })
}

function isReturnLabelStatus(value: unknown): value is ReturnLabelResponse {
  return isRecord(value) && (value.status === 'created' || value.status === 'notConfigured')
}

function cleanText(value: string): string | undefined {
  const trimmed = value.trim()
  return trimmed.length ? trimmed : undefined
}

export function ReturnLabelPanel({ claim, canManage, onRefresh }: ReturnLabelPanelProps) {
  const t = useT()
  const [manualVisible, setManualVisible] = React.useState(false)
  const [autoHidden, setAutoHidden] = React.useState(false)
  const [labelUrl, setLabelUrl] = React.useState(claim.returnLabelUrl ?? '')
  const [trackingNumber, setTrackingNumber] = React.useState(claim.returnTrackingNumber ?? '')
  const [carrier, setCarrier] = React.useState(claim.returnCarrier ?? '')
  const [busy, setBusy] = React.useState<'generate' | 'manual' | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const { runMutation, retryLastMutation } = useGuardedMutation<MutationContext>({
    contextId: `warranty-claim-return-label:${claim.id}`,
    blockedMessage: t('warranty_claims.common.saveBlocked', 'Save blocked by a mutation guard.'),
  })

  React.useEffect(() => {
    setLabelUrl(claim.returnLabelUrl ?? '')
    setTrackingNumber(claim.returnTrackingNumber ?? '')
    setCarrier(claim.returnCarrier ?? '')
  }, [claim.returnCarrier, claim.returnLabelUrl, claim.returnTrackingNumber])

  if (claim.status !== 'approved' && claim.status !== 'awaiting_return') return null

  const hasLabel = Boolean(claim.returnLabelUrl || claim.returnTrackingNumber || claim.returnCarrier)

  const runReturnLabelMutation = async (
    payload: Record<string, unknown>,
    mode: 'generate' | 'manual',
  ): Promise<ReturnLabelResponse | null> => {
    setBusy(mode)
    setError(null)
    try {
      const result = await runMutation({
        operation: async () => {
          const call = await withScopedApiRequestHeaders(
            buildOptimisticLockHeader(claim.updatedAt),
            () => apiCall<ReturnLabelResponse>('/api/warranty_claims/return-label', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ ...payload, updatedAt: claim.updatedAt }),
            }),
          )
          if (!call.ok) throw toApiError(call.status, call.result, 'warranty_claims.returnLabel.error.save', t)
          if (!isReturnLabelStatus(call.result)) {
            throw new Error(t('warranty_claims.returnLabel.error.save', 'Failed to save return label.'))
          }
          return call.result
        },
        context: {
          formId: `warranty-claim-return-label:${claim.id}`,
          resourceKind: 'warranty_claims.claim',
          resourceId: claim.id,
          retryLastMutation,
        },
        mutationPayload: payload,
      })
      return result
    } catch (err) {
      if (surfaceRecordConflict(err, t, { onRefresh })) return null
      const message = err instanceof Error && err.message
        ? err.message
        : t('warranty_claims.returnLabel.error.save', 'Failed to save return label.')
      setError(message)
      flash(message, 'error')
      return null
    } finally {
      setBusy(null)
    }
  }

  const generateLabel = async () => {
    const result = await runReturnLabelMutation({ claimId: claim.id }, 'generate')
    if (!result) return
    if (result.status === 'notConfigured') {
      setAutoHidden(true)
      setManualVisible(true)
      flash(t('warranty_claims.returnLabel.flash.notConfigured', 'No return label provider is configured. Enter label details manually.'), 'info')
      return
    }
    flash(t('warranty_claims.returnLabel.flash.created', 'Return label created.'), 'success')
    await onRefresh()
  }

  const submitManual = async () => {
    const payload = {
      claimId: claim.id,
      manual: true,
      labelUrl: cleanText(labelUrl),
      trackingNumber: cleanText(trackingNumber),
      carrier: cleanText(carrier),
    }
    if (!payload.labelUrl && !payload.trackingNumber && !payload.carrier) {
      const message = t('warranty_claims.returnLabel.error.manualRequired', 'Enter at least one return label detail.')
      setError(message)
      flash(message, 'error')
      return
    }
    const result = await runReturnLabelMutation(payload, 'manual')
    if (!result || result.status !== 'created') return
    setManualVisible(false)
    flash(t('warranty_claims.returnLabel.flash.saved', 'Return label details saved.'), 'success')
    await onRefresh()
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{t('warranty_claims.returnLabel.title', 'Return label')}</h3>
          <p className="text-xs text-muted-foreground">
            {t('warranty_claims.returnLabel.description', 'Generate or record customer return shipping details.')}
          </p>
        </div>
        {hasLabel ? (
          <StatusBadge variant="success">{t('warranty_claims.returnLabel.status.created', 'Label recorded')}</StatusBadge>
        ) : (
          <StatusBadge variant="neutral">{t('warranty_claims.returnLabel.status.missing', 'No label')}</StatusBadge>
        )}
      </div>

      {error ? (
        <div className="mt-3">
          <ErrorMessage label={error} />
        </div>
      ) : null}

      {hasLabel ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div className="rounded-md border border-border p-3">
            <div className="text-xs text-muted-foreground">{t('warranty_claims.returnLabel.fields.carrier', 'Carrier')}</div>
            <div className="text-sm font-medium">{claim.returnCarrier ?? t('warranty_claims.common.noValue', 'No value')}</div>
          </div>
          <div className="rounded-md border border-border p-3">
            <div className="text-xs text-muted-foreground">{t('warranty_claims.returnLabel.fields.trackingNumber', 'Tracking number')}</div>
            <div className="text-sm font-medium">{claim.returnTrackingNumber ?? t('warranty_claims.common.noValue', 'No value')}</div>
          </div>
          <div className="rounded-md border border-border p-3">
            <div className="text-xs text-muted-foreground">{t('warranty_claims.returnLabel.fields.labelUrl', 'Label')}</div>
            {claim.returnLabelUrl ? (
              <a
                href={claim.returnLabelUrl}
                target="_blank"
                rel="noreferrer"
                className="text-sm font-medium text-foreground underline-offset-4 hover:underline"
              >
                {t('warranty_claims.returnLabel.actions.openLabel', 'Open label')}
              </a>
            ) : (
              <div className="text-sm font-medium">{t('warranty_claims.common.noValue', 'No value')}</div>
            )}
          </div>
        </div>
      ) : null}

      {canManage ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {!autoHidden ? (
            <Button type="button" variant="outline" disabled={busy !== null} onClick={() => { void generateLabel() }}>
              {busy === 'generate' ? <Spinner size="sm" /> : null}
              {t('warranty_claims.returnLabel.actions.generate', 'Generate return label')}
            </Button>
          ) : null}
          <Button type="button" variant="outline" disabled={busy !== null} onClick={() => setManualVisible((value) => !value)}>
            {manualVisible
              ? t('warranty_claims.returnLabel.actions.hideManual', 'Hide manual entry')
              : t('warranty_claims.returnLabel.actions.manual', 'Enter manually')}
          </Button>
        </div>
      ) : null}

      {canManage && manualVisible ? (
        <div
          className="mt-4 grid gap-3 sm:grid-cols-3"
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault()
              void submitManual()
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              setManualVisible(false)
            }
          }}
        >
          <div className="space-y-2">
            <Label htmlFor="warranty-return-label-url">{t('warranty_claims.returnLabel.fields.labelUrl', 'Label URL')}</Label>
            <Input
              id="warranty-return-label-url"
              value={labelUrl}
              onChange={(event) => setLabelUrl(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="warranty-return-tracking-number">{t('warranty_claims.returnLabel.fields.trackingNumber', 'Tracking number')}</Label>
            <Input
              id="warranty-return-tracking-number"
              value={trackingNumber}
              onChange={(event) => setTrackingNumber(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="warranty-return-carrier">{t('warranty_claims.returnLabel.fields.carrier', 'Carrier')}</Label>
            <Input
              id="warranty-return-carrier"
              value={carrier}
              onChange={(event) => setCarrier(event.target.value)}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:col-span-3">
            <Button type="button" disabled={busy !== null} onClick={() => { void submitManual() }}>
              {busy === 'manual' ? <Spinner size="sm" /> : null}
              {t('warranty_claims.returnLabel.actions.saveManual', 'Save return label')}
            </Button>
            <Button type="button" variant="outline" onClick={() => setManualVisible(false)}>
              {t('common.cancel', 'Cancel')}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
