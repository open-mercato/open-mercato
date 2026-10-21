"use client"

import * as React from 'react'
import Link from 'next/link'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { PortalPageHeader } from '@open-mercato/ui/portal/components/PortalPageHeader'
import { PortalCard } from '@open-mercato/ui/portal/components/PortalCard'
import { PortalEmptyState } from '@open-mercato/ui/portal/components/PortalEmptyState'
import { formatDateTime } from '@open-mercato/shared/lib/time'

type Props = { params: { orgSlug: string; id: string } }

type AbstractLine = {
  id: string
  lineNumber: number
  executionDate: string
  origin: string
  destination: string
  description: string | null
  quantity: string
  totalNetAmount: string
  taxAmount: string
  totalGrossAmount: string
  disputeStatus: string
  disputeNote: string | null
}

type Abstract = {
  id: string
  abstractNumber: string
  periodFrom: string
  periodTo: string
  status: string
  currencyCode: string
  tripCount: number
  subtotalNetAmount: string
  taxTotalAmount: string
  grandTotalGrossAmount: string
  submittedAt: string | null
  lines?: AbstractLine[]
}

export default function PortalFreightAbstractDetailPage({ params }: Props) {
  const t = useT()
  const [abstract, setAbstract] = React.useState<Abstract | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [notes, setNotes] = React.useState<Record<string, string>>({})
  const listHref = `/${params.orgSlug}/portal/freight/abstracts`

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await apiCall<{ items?: Abstract[] }>(`/api/portal/freight/abstracts?id=${encodeURIComponent(params.id)}`)
      if (!response.ok || !response.result) {
        setError(t('freight_operations.portal.abstracts.loadError', 'Failed to load your trip abstracts.'))
        return
      }
      setAbstract((response.result.items ?? [])[0] ?? null)
    } catch {
      setError(t('freight_operations.portal.abstracts.loadError', 'Failed to load your trip abstracts.'))
    } finally {
      setLoading(false)
    }
  }, [params.id, t])

  React.useEffect(() => {
    void load()
  }, [load])

  const respond = async (payload: { acceptedLineIds?: string[]; disputedLines?: Array<{ lineId: string; note: string }> }) => {
    if (!abstract) return
    setBusy(true)
    try {
      await apiCallOrThrow('/api/portal/freight/abstracts/respond', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: abstract.id, ...payload }),
      })
      flash(t('freight_operations.portal.abstracts.responded', 'Your response has been recorded.'), 'success')
      await load()
    } catch (err) {
      flash(
        err instanceof Error && err.message
          ? err.message
          : t('freight_operations.portal.abstracts.respondError', 'Failed to record your response.'),
        'error',
      )
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <LoadingMessage label={t('freight_operations.portal.abstracts.loading', 'Loading…')} />
  if (error) return <ErrorMessage label={error} />
  if (!abstract) {
    return <PortalEmptyState title={t('freight_operations.portal.abstracts.notFound', 'Abstract not found.')} />
  }

  const actionable = abstract.status === 'submitted'
  const lines = abstract.lines ?? []

  return (
    <div className="flex flex-col gap-6">
      <PortalPageHeader
        label={abstract.abstractNumber}
        title={`${abstract.periodFrom?.slice(0, 10)} – ${abstract.periodTo?.slice(0, 10)}`}
        action={(
          <Button asChild variant="outline">
            <Link href={listHref}>{t('freight_operations.portal.abstracts.back', 'Back to abstracts')}</Link>
          </Button>
        )}
      />
      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge variant={actionable ? 'info' : abstract.status === 'disputed' ? 'warning' : 'success'} dot>
          {t(`freight_operations.abstracts.status.${abstract.status}`, abstract.status)}
        </StatusBadge>
        <span className="text-sm text-muted-foreground">
          {abstract.tripCount} {t('freight_operations.portal.abstracts.trips', 'trips')}
          {' · '}
          {formatDateTime(abstract.submittedAt) ?? ''}
        </span>
        <span className="ms-auto text-lg font-semibold">
          {abstract.grandTotalGrossAmount} {abstract.currencyCode}
        </span>
      </div>

      <PortalCard>
        <div className="divide-y divide-border">
          {lines.length === 0 ? (
            <PortalEmptyState title={t('freight_operations.portal.abstracts.noLines', 'No billable lines.')} />
          ) : lines.map((line) => (
            <div key={line.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">
                  {line.origin} → {line.destination}
                </p>
                <p className="text-xs text-muted-foreground">
                  {line.executionDate?.slice(0, 10)} · {line.description ?? ''} · {line.quantity}
                </p>
              </div>
              <div className="text-sm font-medium">
                {line.totalGrossAmount} {abstract.currencyCode}
              </div>
              {line.disputeStatus === 'disputed' ? (
                <StatusBadge variant="warning" dot>
                  {line.disputeNote ?? t('freight_operations.portal.abstracts.disputed', 'Disputed')}
                </StatusBadge>
              ) : actionable ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    value={notes[line.id] ?? ''}
                    onChange={(event) => setNotes((prev) => ({ ...prev, [line.id]: event.target.value }))}
                    placeholder={t('freight_operations.portal.abstracts.disputeNote', 'Reason')}
                    className="h-8 w-40"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      void respond({
                        disputedLines: [{
                          lineId: line.id,
                          note: notes[line.id]?.trim() || t('freight_operations.portal.abstracts.disputedDefault', 'Disputed by customer'),
                        }],
                      })
                    }}
                  >
                    {t('freight_operations.portal.abstracts.dispute', 'Dispute')}
                  </Button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </PortalCard>

      {actionable ? (
        <div className="flex justify-end">
          <Button
            type="button"
            disabled={busy || lines.length === 0}
            onClick={() => {
              void respond({ acceptedLineIds: lines.map((line) => line.id) })
            }}
          >
            {t('freight_operations.portal.abstracts.acceptAll', 'Accept all lines')}
          </Button>
        </div>
      ) : null}
    </div>
  )
}
