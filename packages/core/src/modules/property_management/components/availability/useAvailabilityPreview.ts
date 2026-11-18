"use client"

import * as React from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { applyPreviewCrmAccess, type AvailabilitySubject, type UnavailabilityPreview } from './availabilityModel'

const PREVIEW_DELAY_MS = 300
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

export type AvailabilityReason = { id: string; label: string }
export type PreviewFieldErrors = Partial<Record<'startsAt' | 'endsAt', string>>
type ErrorBody = { error?: string; code?: string; fieldErrors?: unknown }
type PreviewRange = { startsAt: string; endsAt: string | null }

const RANGE_FIELDS = ['startsAt', 'endsAt'] as const

type Translate = (key: string, fallback: string) => string

export function rangeFieldErrors(value: unknown, translate: Translate): PreviewFieldErrors | null {
  if (!value || typeof value !== 'object') return null
  const errors: PreviewFieldErrors = {}
  for (const field of RANGE_FIELDS) {
    const raw = (value as Record<string, unknown>)[field]
    const message = typeof raw === 'string' ? raw.trim() : ''
    if (message) errors[field] = translate(message, message)
  }
  return Object.keys(errors).length ? errors : null
}

export function useAvailabilityPreview(subject: AvailabilitySubject | null, range: PreviewRange) {
  const t = useT()
  const [reasons, setReasons] = React.useState<AvailabilityReason[]>([])
  const [reasonsFailed, setReasonsFailed] = React.useState(false)
  const [reasonsLoading, setReasonsLoading] = React.useState(false)
  const [reasonsToken, setReasonsToken] = React.useState(0)
  const [today, setToday] = React.useState<string | null>(null)
  const [preview, setPreview] = React.useState<UnavailabilityPreview | null>(null)
  const [previewing, setPreviewing] = React.useState(false)
  const [previewError, setPreviewError] = React.useState<string | null>(null)
  const [previewFieldErrors, setPreviewFieldErrors] = React.useState<PreviewFieldErrors | null>(null)
  const [previewToken, setPreviewToken] = React.useState(0)
  const reasonTriggerRef = React.useRef<HTMLButtonElement>(null)
  const reasonsRetryRef = React.useRef<HTMLButtonElement>(null)
  const previewRetryRef = React.useRef<HTMLButtonElement>(null)
  const previewRef = React.useRef<HTMLDivElement>(null)
  const focusPreviewRef = React.useRef(false)

  const subjectKey = subject ? `${subject.type}:${subject.id}` : null

  React.useEffect(() => {
    if (!subjectKey) return
    setReasonsFailed(false)
  }, [subjectKey])

  React.useEffect(() => {
    if (!subjectKey) return
    let cancelled = false
    setReasonsLoading(true)
    void apiCall<{ items?: AvailabilityReason[]; today?: string }>('/api/property_management/unavailability-reasons', undefined, { fallback: {} })
      .then((call) => {
        if (cancelled) return
        if (!call.ok) {
          setReasonsFailed(true)
          return
        }
        if (reasonsRetryRef.current && document.activeElement === reasonsRetryRef.current) reasonTriggerRef.current?.focus()
        setReasons(Array.isArray(call.result?.items) ? call.result.items : [])
        if (typeof call.result?.today === 'string' && ISO_DAY.test(call.result.today)) setToday(call.result.today)
        setReasonsFailed(false)
      })
      .catch(() => {
        if (!cancelled) setReasonsFailed(true)
      })
      .finally(() => {
        if (!cancelled) setReasonsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [subjectKey, reasonsToken])

  React.useEffect(() => {
    setPreviewError(null)
    setPreviewFieldErrors(null)
  }, [subject, range])

  React.useEffect(() => {
    setPreview(null)
    if (!subject) {
      setPreviewing(false)
      return
    }
    let cancelled = false
    setPreviewing(true)
    const failPreview = (message?: string) => {
      setPreviewError(message ?? t('property_management.availability.dialog.previewError', 'Could not preview the change.'))
    }
    const timer = setTimeout(() => {
      void apiCall<UnavailabilityPreview & ErrorBody>('/api/property_management/unavailabilities?dryRun=true', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ subjectType: subject.type, subjectId: subject.id, ...range }),
      })
        .then((call) => {
          if (cancelled) return
          if (!call.ok || !call.result) {
            const fieldErrors = rangeFieldErrors(call.result?.fieldErrors, t)
            if (fieldErrors) setPreviewFieldErrors(fieldErrors)
            else failPreview(call.result?.error)
            return
          }
          focusPreviewRef.current = Boolean(previewRetryRef.current && document.activeElement === previewRetryRef.current)
          setPreview(applyPreviewCrmAccess(call.result))
          setPreviewError(null)
          setPreviewFieldErrors(null)
        })
        .catch(() => {
          if (!cancelled) failPreview()
        })
        .finally(() => {
          if (!cancelled) setPreviewing(false)
        })
    }, PREVIEW_DELAY_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [subject, range, previewToken, t])

  React.useEffect(() => {
    if (!preview || !focusPreviewRef.current) return
    focusPreviewRef.current = false
    previewRef.current?.focus()
  }, [preview])

  const retryReasons = React.useCallback(() => {
    if (reasonsLoading) return
    setReasonsToken((value) => value + 1)
  }, [reasonsLoading])

  const refreshPreview = React.useCallback(() => setPreviewToken((value) => value + 1), [])

  const retryPreview = React.useCallback(() => {
    if (previewing) return
    refreshPreview()
  }, [previewing, refreshPreview])

  return {
    today,
    reasons,
    reasonsFailed,
    reasonsLoading,
    retryReasons,
    preview,
    previewing,
    previewError,
    previewFieldErrors,
    retryPreview,
    refreshPreview,
    refs: { reasonTriggerRef, reasonsRetryRef, previewRetryRef, previewRef },
  }
}
