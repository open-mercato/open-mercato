"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Plus, Send, Trash2 } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { FormField } from '@open-mercato/ui/primitives/form-field'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { usePortalContext } from '@open-mercato/ui/portal/PortalContext'
import { PortalPageHeader } from '@open-mercato/ui/portal/components/PortalPageHeader'
import { PortalCard, PortalCardHeader } from '@open-mercato/ui/portal/components/PortalCard'

type Props = { params: { orgSlug: string } }

type LineDraft = {
  localId: string
  sku: string
  serialNumber: string
  faultCode: string
  faultDescription: string
  qtyClaimed: string
}

type PortalClaimLineInput = {
  sku?: string
  serialNumber?: string
  faultCode?: string
  faultDescription: string
  qtyClaimed: number
}

type PortalIntakePayload = {
  orderId?: string
  reasonCode: string
  notes?: string
  lines: PortalClaimLineInput[]
}

type PortalCreateResponse = {
  ok: boolean
  claimId?: string
  error?: string
}

let lineId = 0

function createLineDraft(): LineDraft {
  lineId += 1
  return {
    localId: `claim-line-${lineId}`,
    sku: '',
    serialNumber: '',
    faultCode: '',
    faultDescription: '',
    qtyClaimed: '1',
  }
}

function optionalText(value: string): string | undefined {
  const trimmed = value.trim()
  return trimmed.length ? trimmed : undefined
}

export default function WarrantyClaimPortalNewPage({ params }: Props) {
  const t = useT()
  const router = useRouter()
  const { auth } = usePortalContext()
  const { user, loading } = auth
  const guardedMutation = useGuardedMutation<Record<string, unknown>>({
    contextId: 'warranty_claims.portal.claim.create',
    blockedMessage: t('warranty_claims.portal.new.blocked'),
  })
  const [orderReference, setOrderReference] = React.useState('')
  const [reasonCode, setReasonCode] = React.useState('')
  const [notes, setNotes] = React.useState('')
  const [lines, setLines] = React.useState<LineDraft[]>(() => [createLineDraft()])
  const [error, setError] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)

  React.useEffect(() => {
    if (!loading && !user) {
      router.replace(`/${params.orgSlug}/portal/login`)
    }
  }, [loading, user, router, params.orgSlug])

  const updateLine = React.useCallback((localId: string, patch: Partial<LineDraft>) => {
    setLines((current) => current.map((line) => (line.localId === localId ? { ...line, ...patch } : line)))
  }, [])

  const addLine = React.useCallback(() => {
    setLines((current) => [...current, createLineDraft()])
  }, [])

  const removeLine = React.useCallback((localId: string) => {
    setLines((current) => (current.length > 1 ? current.filter((line) => line.localId !== localId) : current))
  }, [])

  const buildPayload = React.useCallback((): PortalIntakePayload | null => {
    const normalizedReason = reasonCode.trim()
    if (!normalizedReason) {
      setError(t('warranty_claims.portal.validation.reasonRequired'))
      return null
    }
    if (lines.length < 1) {
      setError(t('warranty_claims.portal.validation.lineRequired'))
      return null
    }

    const normalizedLines: PortalClaimLineInput[] = []
    for (const line of lines) {
      const faultDescription = line.faultDescription.trim()
      if (!faultDescription) {
        setError(t('warranty_claims.portal.validation.faultDescriptionRequired'))
        return null
      }
      const qtyClaimed = Number(line.qtyClaimed)
      if (!Number.isFinite(qtyClaimed) || qtyClaimed <= 0) {
        setError(t('warranty_claims.portal.validation.qtyPositive'))
        return null
      }
      normalizedLines.push({
        sku: optionalText(line.sku),
        serialNumber: optionalText(line.serialNumber),
        faultCode: optionalText(line.faultCode),
        faultDescription,
        qtyClaimed,
      })
    }

    return {
      orderId: optionalText(orderReference),
      reasonCode: normalizedReason,
      notes: optionalText(notes),
      lines: normalizedLines,
    }
  }, [lines, notes, orderReference, reasonCode, t])

  const submitClaim = React.useCallback(async () => {
    if (submitting) return
    setError(null)
    const payload = buildPayload()
    if (!payload) return

    setSubmitting(true)
    try {
      const mutationPayload: Record<string, unknown> = { ...payload }
      const result = await guardedMutation.runMutation({
        operation: () => apiCall<PortalCreateResponse>('/api/warranty_claims/portal/claims', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(payload),
        }),
        context: {
          moduleId: 'warranty_claims',
          entityId: 'warranty_claims.claim',
          operation: 'portal_create',
        },
        mutationPayload,
      })

      if (!result.ok || !result.result?.claimId) {
        setError(result.status === 404
          ? t('warranty_claims.errors.orderNotOwned')
          : t('warranty_claims.portal.new.error'))
        return
      }

      flash(t('warranty_claims.portal.new.success'), 'success')
      router.push(`/${params.orgSlug}/portal/claims/${result.result.claimId}`)
    } catch {
      setError(t('warranty_claims.portal.new.error'))
    } finally {
      setSubmitting(false)
    }
  }, [buildPayload, guardedMutation, params.orgSlug, router, submitting, t])

  const handleSubmit = React.useCallback((event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void submitClaim()
  }, [submitClaim])

  const handleKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLFormElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault()
      void submitClaim()
    }
  }, [submitClaim])

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Spinner /></div>
  }

  if (!user) return null

  return (
    <form className="flex flex-col gap-8" onSubmit={handleSubmit} onKeyDown={handleKeyDown}>
      <PortalPageHeader
        label={t('warranty_claims.portal.nav')}
        title={t('warranty_claims.portal.new.title')}
        description={t('warranty_claims.portal.new.description')}
        action={
          <Button asChild variant="outline">
            <Link href={`/${params.orgSlug}/portal/claims`}>
              <ArrowLeft className="size-4" aria-hidden="true" />
              {t('warranty_claims.portal.new.back')}
            </Link>
          </Button>
        }
      />

      {error ? (
        <ErrorMessage label={error} />
      ) : null}

      <div className="grid gap-3 md:grid-cols-3">
        {[
          t('warranty_claims.portal.wizard.order'),
          t('warranty_claims.portal.wizard.fault'),
          t('warranty_claims.portal.wizard.review'),
        ].map((label, index) => (
          <div key={label} className="rounded-lg border border-border bg-card p-4">
            <div className="mb-2 flex size-8 items-center justify-center rounded-full bg-muted text-sm font-medium text-foreground">
              {index + 1}
            </div>
            <p className="text-sm font-semibold">{label}</p>
          </div>
        ))}
      </div>

      <PortalCard>
        <PortalCardHeader
          label={t('warranty_claims.portal.wizard.order')}
          title={t('warranty_claims.portal.new.orderTitle')}
          description={t('warranty_claims.portal.new.orderDescription')}
        />
        <div className="grid gap-4 md:grid-cols-2">
          <FormField
            label={t('warranty_claims.portal.new.orderReference')}
            description={t('warranty_claims.portal.new.orderReferenceHelp')}
          >
            <Input
              value={orderReference}
              onChange={(event) => setOrderReference(event.target.value)}
              disabled={submitting}
            />
          </FormField>
          <FormField label={t('warranty_claims.form.reasonCode')} required>
            <Input
              value={reasonCode}
              onChange={(event) => setReasonCode(event.target.value)}
              disabled={submitting}
              required
            />
          </FormField>
        </div>
      </PortalCard>

      <PortalCard>
        <PortalCardHeader
          label={t('warranty_claims.portal.wizard.fault')}
          title={t('warranty_claims.portal.new.linesTitle')}
          description={t('warranty_claims.portal.new.linesDescription')}
          action={
            <Button type="button" variant="outline" onClick={addLine} disabled={submitting}>
              <Plus className="size-4" aria-hidden="true" />
              {t('warranty_claims.portal.new.addLine')}
            </Button>
          }
        />
        <div className="flex flex-col gap-4">
          {lines.map((line, index) => (
            <div key={line.localId} className="rounded-lg border border-border bg-background p-4">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold">
                  {t('warranty_claims.portal.new.lineLabel', { number: index + 1 })}
                </h3>
                <IconButton
                  type="button"
                  variant="ghost"
                  aria-label={t('warranty_claims.portal.new.removeLine')}
                  onClick={() => removeLine(line.localId)}
                  disabled={submitting || lines.length === 1}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </IconButton>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <FormField label={t('warranty_claims.portal.new.productOrSku')}>
                  <Input
                    value={line.sku}
                    onChange={(event) => updateLine(line.localId, { sku: event.target.value })}
                    disabled={submitting}
                  />
                </FormField>
                <FormField label={t('warranty_claims.form.serialNumber')}>
                  <Input
                    value={line.serialNumber}
                    onChange={(event) => updateLine(line.localId, { serialNumber: event.target.value })}
                    disabled={submitting}
                  />
                </FormField>
                <FormField label={t('warranty_claims.form.faultCode')}>
                  <Input
                    value={line.faultCode}
                    onChange={(event) => updateLine(line.localId, { faultCode: event.target.value })}
                    disabled={submitting}
                  />
                </FormField>
                <FormField label={t('warranty_claims.form.qtyClaimed')} required>
                  <Input
                    type="number"
                    min="1"
                    step="1"
                    value={line.qtyClaimed}
                    onChange={(event) => updateLine(line.localId, { qtyClaimed: event.target.value })}
                    disabled={submitting}
                    required
                  />
                </FormField>
                <FormField className="md:col-span-2" label={t('warranty_claims.form.faultDescription')} required>
                  <Textarea
                    value={line.faultDescription}
                    onChange={(event) => updateLine(line.localId, { faultDescription: event.target.value })}
                    disabled={submitting}
                    required
                    maxLength={4000}
                    showCount
                  />
                </FormField>
              </div>
            </div>
          ))}
        </div>
      </PortalCard>

      <PortalCard>
        <PortalCardHeader
          label={t('warranty_claims.portal.wizard.review')}
          title={t('warranty_claims.portal.new.reviewTitle')}
          description={t('warranty_claims.portal.new.reviewDescription')}
        />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <FormField label={t('warranty_claims.form.notes')}>
            <Textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              disabled={submitting}
              maxLength={8000}
              showCount
            />
          </FormField>
          <div className="rounded-lg border border-border bg-muted/30 p-4">
            <h3 className="mb-3 text-sm font-semibold">{t('warranty_claims.portal.new.summaryTitle')}</h3>
            <dl className="space-y-3 text-sm">
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">{t('warranty_claims.portal.new.reviewOrder')}</dt>
                <dd className="font-medium">{orderReference.trim() || t('warranty_claims.portal.value.notAvailable')}</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">{t('warranty_claims.portal.new.reviewLines')}</dt>
                <dd className="font-medium">{lines.length}</dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-muted-foreground">{t('warranty_claims.portal.new.reviewNotes')}</dt>
                <dd className="font-medium">
                  {notes.trim() ? t('warranty_claims.portal.value.yes') : t('warranty_claims.portal.value.no')}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </PortalCard>

      <Alert status="information" style="lighter">
        <AlertDescription>{t('warranty_claims.portal.new.submitHint')}</AlertDescription>
      </Alert>

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Button asChild variant="outline">
          <Link href={`/${params.orgSlug}/portal/claims`}>
            {t('warranty_claims.portal.new.cancel')}
          </Link>
        </Button>
        <Button type="submit" disabled={submitting}>
          <Send className="size-4" aria-hidden="true" />
          {submitting ? t('warranty_claims.portal.new.submitting') : t('warranty_claims.portal.submit')}
        </Button>
      </div>
    </form>
  )
}
