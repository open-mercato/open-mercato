"use client"

import * as React from 'react'
import { Check } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { formatDisplayDateTime } from '@open-mercato/ui/primitives/date-format'
import type { RunnerActiveFormResponse, RunnerSubmission } from '../types'

export type CompletionScreenProps = {
  submission: RunnerSubmission
  schemaResponse: RunnerActiveFormResponse
  pdfDownloadEnabled?: boolean
  onDownloadPdf?: () => void
  onReturnHome?: () => void
  /** Per-distribution custom heading; falls back to the default "Thank you!". */
  completionTitle?: string | null
  /** Per-distribution custom body; falls back to the default subtitle. */
  completionMessage?: string | null
  /** Surfaced when a PDF download attempt fails. */
  pdfError?: string | null
}

function formatTime(iso: string | null, locale: string): string {
  return formatDisplayDateTime(iso, locale) ?? ''
}

export function CompletionScreen({
  submission,
  schemaResponse,
  pdfDownloadEnabled = false,
  onDownloadPdf,
  onReturnHome,
  completionTitle,
  completionMessage,
  pdfError,
}: CompletionScreenProps) {
  const t = useT()
  const locale = useLocale()
  const submittedAt = submission.submittedAt ?? submission.updatedAt ?? null
  const submittedLabel = formatTime(submittedAt, locale)

  const title = completionTitle?.trim()
    ? completionTitle
    : t('forms.runner.completion.title', { fallback: 'Thank you!' })
  const message = completionMessage?.trim()
    ? completionMessage
    : t('forms.runner.completion.subtitle', { fallback: 'Your submission has been recorded.' })

  return (
    <section className="mx-auto flex w-full max-w-md flex-col items-center gap-5 py-12 text-center">
      <span
        aria-hidden="true"
        className="flex h-14 w-14 items-center justify-center rounded-full bg-status-success-bg text-status-success-icon"
      >
        <Check className="h-7 w-7" />
      </span>

      <div className="flex flex-col gap-2">
        <h2 className="text-2xl font-semibold text-foreground">{title}</h2>
        <p className="text-base text-muted-foreground whitespace-pre-line">{message}</p>
      </div>

      {submittedLabel ? (
        <p className="text-xs text-muted-foreground">
          {t('forms.runner.completion.submitted_at', {
            fallback: 'Submitted {time}',
            time: submittedLabel,
          })}
        </p>
      ) : null}

      {(pdfDownloadEnabled || onReturnHome) ? (
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          {pdfDownloadEnabled ? (
            <Button type="button" onClick={onDownloadPdf}>
              {t('forms.runner.completion.download_pdf', { fallback: 'Download PDF copy' })}
            </Button>
          ) : null}
          {onReturnHome ? (
            <Button type="button" variant="outline" onClick={onReturnHome}>
              {t('forms.runner.completion.return_home', { fallback: 'Back to home' })}
            </Button>
          ) : null}
        </div>
      ) : null}

      {pdfError ? (
        <Alert status="error" style="light" className="text-left">
          <AlertDescription>{pdfError}</AlertDescription>
        </Alert>
      ) : null}
    </section>
  )
}
