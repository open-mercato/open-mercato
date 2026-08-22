"use client"

import * as React from 'react'
import type { TranslateFn } from '@open-mercato/shared/lib/i18n/context'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { AiIcon } from '@open-mercato/ui/ai/AiIcon'
import { Button } from '@open-mercato/ui/primitives/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { apiCall, readApiResultOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'

type AiAssessKind = 'damage' | 'proof'

type AiAssessLine = {
  id: string
  updatedAt: string | null
  assessmentPayload: Record<string, unknown> | null
}

type AttachmentItem = {
  id: string
  fileName: string
}

type AttachmentsResponse = {
  items?: AttachmentItem[]
}

type DamageAssessment = {
  damageType?: string | null
  severity?: string | null
  probableCause?: string | null
  misuseSuspected?: boolean | null
  confidence?: number | null
  summary?: string | null
}

type ProofExtraction = {
  purchaseDate?: string | null
  serialNumber?: string | null
  merchant?: string | null
  confidence?: number | null
}

type AiAssessResponse =
  | { status: 'ok'; assessment?: DamageAssessment; extraction?: ProofExtraction }
  | { status: 'notConfigured' }
  | { status: 'aiUnavailable' }

type MutationContext = {
  formId: string
  resourceKind: string
  resourceId?: string
  retryLastMutation: () => Promise<boolean>
}

type AiAssessButtonsProps = {
  claimId: string
  line: AiAssessLine
  canManage: boolean
  onRefresh: () => Promise<void>
}

const LINE_ATTACHMENT_ENTITY_ID = 'warranty_claims:warranty_claim_line'

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length ? value.trim() : null
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function readErrorKey(value: unknown): string | null {
  if (!isRecord(value)) return null
  return readString(value.error)
}

function toApiError(status: number, result: unknown, fallbackKey: string, t: TranslateFn): Error & { status?: number } {
  const key = readErrorKey(result) ?? fallbackKey
  return Object.assign(new Error(t(key, key)), { status })
}

function readDamageAssessment(value: unknown): DamageAssessment | null {
  if (!isRecord(value)) return null
  return {
    damageType: readString(value.damageType),
    severity: readString(value.severity),
    probableCause: readString(value.probableCause),
    misuseSuspected: readBoolean(value.misuseSuspected),
    confidence: readNumber(value.confidence),
    summary: readString(value.summary),
  }
}

function readProofExtraction(value: unknown): ProofExtraction | null {
  if (!isRecord(value)) return null
  return {
    purchaseDate: readString(value.purchaseDate),
    serialNumber: readString(value.serialNumber),
    merchant: readString(value.merchant),
    confidence: readNumber(value.confidence),
  }
}

function readPayloadDamage(payload: Record<string, unknown> | null): DamageAssessment | null {
  return payload ? readDamageAssessment(payload.damage) : null
}

function readPayloadProof(payload: Record<string, unknown> | null): ProofExtraction | null {
  return payload ? readProofExtraction(payload.proof) : null
}

function formatConfidence(value: number | null | undefined): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return `${Math.round(value * 100)}%`
}

function parseAiAssessResponse(value: unknown): AiAssessResponse | null {
  if (!isRecord(value)) return null
  if (value.status === 'notConfigured') return { status: 'notConfigured' }
  if (value.status === 'aiUnavailable') return { status: 'aiUnavailable' }
  if (value.status !== 'ok') return null
  return {
    status: 'ok',
    assessment: readDamageAssessment(value.assessment) ?? undefined,
    extraction: readProofExtraction(value.extraction) ?? undefined,
  }
}

function ResultCard({
  damage,
  proof,
  unavailable,
}: {
  damage: DamageAssessment | null
  proof: ProofExtraction | null
  unavailable: boolean
}) {
  const t = useT()
  if (unavailable) {
    return (
      <p className="text-xs text-muted-foreground">
        {t('warranty_claims.ai.assess.unavailable', 'AI not available.')}
      </p>
    )
  }
  if (!damage && !proof) return null
  return (
    <div className="rounded-md border border-border bg-muted/30 p-3 text-xs">
      {damage ? (
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge variant="info">{t('warranty_claims.ai.assess.damageResult', 'Damage assessment')}</StatusBadge>
            {damage.severity ? <StatusBadge variant="neutral">{damage.severity}</StatusBadge> : null}
            {formatConfidence(damage.confidence) ? (
              <span className="text-muted-foreground">
                {t('warranty_claims.ai.assess.confidence', 'Confidence: {confidence}', {
                  confidence: formatConfidence(damage.confidence) ?? '',
                })}
              </span>
            ) : null}
          </div>
          {damage.summary ? <p>{damage.summary}</p> : null}
          {damage.probableCause ? (
            <p className="text-muted-foreground">
              {t('warranty_claims.ai.assess.probableCause', 'Probable cause: {cause}', {
                cause: damage.probableCause,
              })}
            </p>
          ) : null}
          {damage.misuseSuspected !== null && damage.misuseSuspected !== undefined ? (
            <p className="text-muted-foreground">
              {damage.misuseSuspected
                ? t('warranty_claims.ai.assess.misuseSuspected', 'Misuse suspected')
                : t('warranty_claims.ai.assess.misuseNotSuspected', 'No misuse signal')}
            </p>
          ) : null}
        </div>
      ) : null}
      {proof ? (
        <div className={damage ? 'mt-3 space-y-1' : 'space-y-1'}>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge variant="info">{t('warranty_claims.ai.assess.proofResult', 'Proof extraction')}</StatusBadge>
            {formatConfidence(proof.confidence) ? (
              <span className="text-muted-foreground">
                {t('warranty_claims.ai.assess.confidence', 'Confidence: {confidence}', {
                  confidence: formatConfidence(proof.confidence) ?? '',
                })}
              </span>
            ) : null}
          </div>
          {proof.purchaseDate ? (
            <p>{t('warranty_claims.ai.assess.purchaseDate', 'Purchase date: {date}', { date: proof.purchaseDate })}</p>
          ) : null}
          {proof.serialNumber ? (
            <p>{t('warranty_claims.ai.assess.serialNumber', 'Serial: {serial}', { serial: proof.serialNumber })}</p>
          ) : null}
          {proof.merchant ? (
            <p className="text-muted-foreground">
              {t('warranty_claims.ai.assess.merchant', 'Merchant: {merchant}', { merchant: proof.merchant })}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export function AiAssessButtons({ claimId, line, canManage, onRefresh }: AiAssessButtonsProps) {
  const t = useT()
  const [attachments, setAttachments] = React.useState<AttachmentItem[]>([])
  const [selectedAttachmentId, setSelectedAttachmentId] = React.useState<string | null>(null)
  const [loadingAttachments, setLoadingAttachments] = React.useState(false)
  const [loadingKind, setLoadingKind] = React.useState<AiAssessKind | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [unavailable, setUnavailable] = React.useState(false)
  const [latestDamage, setLatestDamage] = React.useState<DamageAssessment | null>(null)
  const [latestProof, setLatestProof] = React.useState<ProofExtraction | null>(null)
  const { runMutation, retryLastMutation } = useGuardedMutation<MutationContext>({
    contextId: `warranty-claim-ai-assess:${line.id}`,
    blockedMessage: t('warranty_claims.common.saveBlocked', 'Save blocked by a mutation guard.'),
  })

  React.useEffect(() => {
    let cancelled = false
    setLoadingAttachments(true)
    setError(null)
    readApiResultOrThrow<AttachmentsResponse>(
      `/api/attachments?entityId=${encodeURIComponent(LINE_ATTACHMENT_ENTITY_ID)}&recordId=${encodeURIComponent(line.id)}`,
      undefined,
      {
        fallback: { items: [] },
        errorMessage: t('warranty_claims.ai.assess.attachmentsError', 'Failed to load line attachments.'),
      },
    )
      .then((payload) => {
        if (cancelled) return
        const nextItems = Array.isArray(payload.items) ? payload.items.filter((item) => item.id && item.fileName) : []
        setAttachments(nextItems)
        setSelectedAttachmentId((current) => current ?? nextItems[0]?.id ?? null)
      })
      .catch((err) => {
        if (cancelled) return
        const message = err instanceof Error && err.message
          ? err.message
          : t('warranty_claims.ai.assess.attachmentsError', 'Failed to load line attachments.')
        setError(message)
      })
      .finally(() => {
        if (!cancelled) setLoadingAttachments(false)
      })
    return () => {
      cancelled = true
    }
  }, [line.id, t])

  const payloadDamage = readPayloadDamage(line.assessmentPayload)
  const payloadProof = readPayloadProof(line.assessmentPayload)
  const damage = latestDamage ?? payloadDamage
  const proof = latestProof ?? payloadProof

  const runAssess = async (kind: AiAssessKind) => {
    if (!selectedAttachmentId) return
    setLoadingKind(kind)
    setError(null)
    setUnavailable(false)
    const body = {
      claimId,
      lineId: line.id,
      attachmentId: selectedAttachmentId,
      kind,
      updatedAt: line.updatedAt,
    }
    try {
      const result = await runMutation({
        operation: async () => {
          const call = await withScopedApiRequestHeaders(
            buildOptimisticLockHeader(line.updatedAt),
            () => apiCall<AiAssessResponse>('/api/warranty_claims/ai/assess', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(body),
            }),
          )
          if (!call.ok) throw toApiError(call.status, call.result, 'warranty_claims.ai.assess.error', t)
          const parsed = parseAiAssessResponse(call.result)
          if (!parsed) throw new Error(t('warranty_claims.ai.assess.error', 'AI assessment failed.'))
          return parsed
        },
        context: {
          formId: `warranty-claim-ai-assess:${line.id}`,
          resourceKind: 'warranty_claims.claim_line',
          resourceId: line.id,
          retryLastMutation,
        },
        mutationPayload: body,
      })
      if (result.status === 'notConfigured' || result.status === 'aiUnavailable') {
        setUnavailable(true)
        return
      }
      if (result.assessment) setLatestDamage(result.assessment)
      if (result.extraction) setLatestProof(result.extraction)
      flash(t('warranty_claims.ai.assess.flash.saved', 'AI assessment saved.'), 'success')
      await onRefresh()
    } catch (err) {
      if (surfaceRecordConflict(err, t, { onRefresh })) return
      const message = err instanceof Error && err.message
        ? err.message
        : t('warranty_claims.ai.assess.error', 'AI assessment failed.')
      setError(message)
      flash(message, 'error')
    } finally {
      setLoadingKind(null)
    }
  }

  if (!canManage && !damage && !proof) return null
  if (loadingAttachments && !damage && !proof) {
    return (
      <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
        <Spinner size="sm" />
        {t('warranty_claims.ai.assess.loadingAttachments', 'Loading attachments...')}
      </div>
    )
  }

  if (!attachments.length && !damage && !proof) return null

  return (
    <div className="mt-2 space-y-2">
      {error ? <ErrorMessage label={error} /> : null}
      {canManage && attachments.length ? (
        <div className="flex flex-wrap items-center gap-2">
          {attachments.length > 1 ? (
            <Select value={selectedAttachmentId ?? undefined} onValueChange={setSelectedAttachmentId}>
              <SelectTrigger className="w-44" aria-label={t('warranty_claims.ai.assess.attachment', 'Attachment')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {attachments.map((attachment) => (
                  <SelectItem key={attachment.id} value={attachment.id}>
                    {attachment.fileName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loadingKind !== null || !selectedAttachmentId}
            onClick={() => { void runAssess('damage') }}
          >
            {loadingKind === 'damage' ? <Spinner size="sm" /> : <AiIcon className="size-4" aria-hidden="true" />}
            {t('warranty_claims.ai.assess.damage', 'AI: assess damage')}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={loadingKind !== null || !selectedAttachmentId}
            onClick={() => { void runAssess('proof') }}
          >
            {loadingKind === 'proof' ? <Spinner size="sm" /> : <AiIcon className="size-4" aria-hidden="true" />}
            {t('warranty_claims.ai.assess.proof', 'AI: extract proof')}
          </Button>
        </div>
      ) : null}
      <ResultCard damage={damage} proof={proof} unavailable={unavailable} />
    </div>
  )
}
